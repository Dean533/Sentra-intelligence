import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'
import { placeOrder, getPositions, getLatestPrices, getOrders, placeStopOrder } from '@/lib/alpaca'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const TIER1_BUDGET     = 10_000  // split equally across all tier-1 signals
const TIER2_ALLOCATION =    500  // flat per tier-2 signal
const STOP_LOSS_PCT    =  0.10
const TAKE_PROFIT_PCT  =  0.25

type SignalRow = { ticker: string; conviction_score: number; signal_direction: string }
type OrderResult = {
  ticker:           string
  tier:             number
  skipped?:         true
  reason?:          string
  qty?:             number
  entry_price?:     number
  stop_loss?:       number
  take_profit?:     number
  conviction_score?: number
  alpaca_order_id?: string
}

async function processSignals(
  signals:    SignalRow[],
  prices:     Record<string, number>,
  allocation: number,
  tier:       number,
  signalMonth: string,
): Promise<OrderResult[]> {
  const results: OrderResult[] = []

  for (const signal of signals) {
    const ticker     = signal.ticker
    const price      = prices[ticker]
    if (price == null) {
      results.push({ ticker, tier, skipped: true, reason: 'no price data' })
      continue
    }

    const qty        = Math.floor(allocation / price)
    const stopLoss   = Math.round(price * (1 - STOP_LOSS_PCT) * 100) / 100
    const takeProfit = Math.round(price * (1 + TAKE_PROFIT_PCT) * 100) / 100

    if (qty <= 0) {
      results.push({ ticker, tier, skipped: true, reason: `price too high for allocation ($${price} > $${allocation.toFixed(0)})` })
      continue
    }

    let order: any
    try {
      order = await placeOrder(ticker, qty, 'buy', price, stopLoss, takeProfit)
    } catch (e: any) {
      results.push({ ticker, tier, skipped: true, reason: e.message })
      continue
    }

    const { error: insertErr } = await supabase
      .from('paper_trades')
      .insert({
        ticker,
        entry_price:      price,
        shares:           qty,
        conviction_score: signal.conviction_score,
        signal_month:     signalMonth,
        alpaca_order_id:  order.id,
        tier,
        status:           'open',
      })

    if (insertErr) {
      console.error(`[execute] paper_trades insert failed for ${ticker} (tier ${tier}):`, insertErr.message)
    }

    results.push({ ticker, tier, qty, entry_price: price, stop_loss: stopLoss, take_profit: takeProfit, conviction_score: signal.conviction_score, alpaca_order_id: order.id })
  }

  return results
}

async function runExecute(req: Request): Promise<NextResponse> {
  const deny = authorizeCron(req)
  if (deny) return deny

  // ── 1. Fetch all bullish signals with conviction_score >= 60 ─────────────
  // Use the most recent signal_month that has at least one qualifying signal,
  // rather than the current calendar month (signals are computed on the 2nd of each month).
  const { data: latestMonthRow, error: monthErr } = await supabase
    .from('insider_signals_monthly')
    .select('signal_month')
    .gte('conviction_score', 60)
    .order('signal_month', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (monthErr) return NextResponse.json({ error: monthErr.message }, { status: 500 })
  if (!latestMonthRow) {
    return NextResponse.json({ message: 'No signals with conviction_score >= 60 found in any month' })
  }

  const signalMonth = latestMonthRow.signal_month as string

  const { data: allSignals, error: sigErr } = await supabase
    .from('insider_signals_monthly')
    .select('ticker, conviction_score, signal_direction')
    .eq('signal_month', signalMonth)
    .gte('conviction_score', 60)
    .eq('signal_direction', 'bullish')
    .order('conviction_score', { ascending: false })

  if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })
  if (!allSignals || allSignals.length === 0) {
    return NextResponse.json({ message: 'No qualifying bullish signals', signal_month: signalMonth })
  }

  // ── 2. Skip tickers already held on Alpaca ────────────────────────────────
  let positions: Awaited<ReturnType<typeof getPositions>>
  try {
    positions = await getPositions()
  } catch (e: any) {
    return NextResponse.json({ error: `Alpaca getPositions failed: ${e.message}` }, { status: 502 })
  }
  const heldTickers = new Set(positions.map(p => p.symbol.toUpperCase()))

  const eligible = (allSignals as SignalRow[]).filter(
    s => !heldTickers.has(s.ticker.toUpperCase())
  )

  const alreadyHeld = allSignals.length - eligible.length

  // ── 3. Reattach stops for already-held signal positions ───────────────────
  type StopReattachResult = { ticker: string; action: string; stop_price?: number; order_id?: string; error?: string }
  const stopReattachResults: StopReattachResult[] = []

  const heldSignalTickers = (allSignals as SignalRow[])
    .filter(s => heldTickers.has(s.ticker.toUpperCase()))
    .map(s => s.ticker.toUpperCase())

  if (heldSignalTickers.length > 0) {
    let openOrders: Awaited<ReturnType<typeof getOrders>>
    try {
      openOrders = await getOrders()
    } catch (e: any) {
      return NextResponse.json({ error: `Alpaca getOrders failed: ${e.message}` }, { status: 502 })
    }

    const tickersWithStop = new Set(
      openOrders
        .filter(o => o.side === 'sell' && (o.type === 'stop' || o.type === 'stop_limit'))
        .map(o => o.symbol.toUpperCase())
    )

    for (const ticker of heldSignalTickers) {
      if (tickersWithStop.has(ticker)) {
        console.log(`[execute] ${ticker}: GTC stop already exists`)
        stopReattachResults.push({ ticker, action: 'already_exists' })
        continue
      }

      const { data: tradeRow } = await supabase
        .from('paper_trades')
        .select('entry_price, shares')
        .eq('ticker', ticker)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!tradeRow) {
        console.log(`[execute] ${ticker}: no open paper_trade row found, skipping stop reattach`)
        stopReattachResults.push({ ticker, action: 'skipped', error: 'no open trade record' })
        continue
      }

      const stopPrice = Math.round(tradeRow.entry_price * (1 - STOP_LOSS_PCT) * 100) / 100
      const position  = positions.find(p => p.symbol.toUpperCase() === ticker)
      const qty       = position ? Math.abs(parseInt(position.qty)) : (tradeRow.shares as number)

      try {
        const stopOrder = await placeStopOrder(ticker, qty, stopPrice)
        console.log(`[execute] ${ticker}: stop reattached at $${stopPrice} (order ${stopOrder.id})`)
        stopReattachResults.push({ ticker, action: 'reattached', stop_price: stopPrice, order_id: stopOrder.id })
      } catch (e: any) {
        console.error(`[execute] ${ticker}: stop reattach failed:`, e.message)
        stopReattachResults.push({ ticker, action: 'failed', error: e.message })
      }
    }
  }

  // ── 4. Split into tiers ───────────────────────────────────────────────────
  const tier1 = eligible.filter(s => s.conviction_score >= 70)
  const tier2 = eligible.filter(s => s.conviction_score >= 60 && s.conviction_score < 70)

  if (eligible.length === 0) {
    return NextResponse.json({
      message:        'All qualifying signals already have open positions',
      signal_month:   signalMonth,
      already_held:   alreadyHeld,
      stop_reattach:  stopReattachResults,
    })
  }

  // ── 5. Fetch prices for all eligible tickers in one call ─────────────────
  const allTickers = eligible.map(s => s.ticker)
  let prices: Record<string, number>
  try {
    prices = await getLatestPrices(allTickers)
  } catch (e: any) {
    return NextResponse.json({ error: `Alpaca getLatestPrices failed: ${e.message}` }, { status: 502 })
  }

  // ── 6. Process both tiers ─────────────────────────────────────────────────
  const tier1Allocation = tier1.length > 0 ? TIER1_BUDGET / tier1.length : 0

  const [tier1Results, tier2Results] = await Promise.all([
    processSignals(tier1, prices, tier1Allocation, 1, signalMonth),
    processSignals(tier2, prices, TIER2_ALLOCATION, 2, signalMonth),
  ])

  const allResults = [...tier1Results, ...tier2Results]

  return NextResponse.json({
    signal_month:  signalMonth,
    already_held:  alreadyHeld,
    stop_reattach: stopReattachResults,
    tier1: {
      signals:       tier1.length,
      allocation_each: tier1Allocation,
      orders_placed: tier1Results.filter(r => !r.skipped).length,
      skipped:       tier1Results.filter(r => r.skipped).length,
    },
    tier2: {
      signals:       tier2.length,
      allocation_each: TIER2_ALLOCATION,
      orders_placed: tier2Results.filter(r => !r.skipped).length,
      skipped:       tier2Results.filter(r => r.skipped).length,
    },
    results: allResults,
  })
}

export function GET(req: Request)  { return runExecute(req) }
export function POST(req: Request) { return runExecute(req) }
