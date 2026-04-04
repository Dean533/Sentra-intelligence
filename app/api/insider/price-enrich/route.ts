import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function offsetDate(base: Date, days: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

type HistRow = { date: Date; close: number }

async function fetchHistory(symbol: string, from: Date, to: Date): Promise<HistRow[]> {
  console.log(`[fetchHistory] ${symbol} period1=${from.toISOString()} period2=${to.toISOString()}`)
  try {
    const rows = await yahooFinance.historical(symbol, {
      period1:  new Date(from),
      period2:  new Date(to),
      interval: '1d',
    }) as any[]
    console.log(`[fetchHistory] ${symbol} returned ${rows.length} rows`)
    return rows
      .map((r) => ({ date: new Date(r.date), close: r.adjClose ?? r.close }))
      .filter((r) => r.close != null)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  } catch (err: any) {
    console.error(`[fetchHistory] ${symbol} ERROR:`, err?.message ?? err)
    return []
  }
}

// Returns the Nth trading-day price at or after baseDate (0 = same day, 1 = next, etc.)
function nthTradingDay(history: HistRow[], baseDate: Date, n: number): number | null {
  const ts = baseDate.getTime()
  const future = history.filter((r) => r.date.getTime() >= ts)
  return future[n]?.close ?? null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // Hardcoded sanity check — confirms Yahoo Finance is reachable
  const testHistory = await yahooFinance.historical('AAPL', {
    period1:  new Date('2026-01-02'),
    period2:  new Date('2026-01-15'),
    interval: '1d',
  }) as any[]
  console.log('AAPL test rows:', testHistory.length)

  // 1. Fetch unenriched insider transactions
  const { data: rows, error } = await supabase
    .from('insider_transactions')
    .select('id, ticker, transaction_date, total_value')
    .not('transaction_date', 'is', null)
    .is('price_on_day', null)
    .order('transaction_date', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ total: 0, enriched: 0, failed: 0 })

  console.log(`[price-enrich] fetched ${rows.length} rows. First: ${rows[0].ticker} ${rows[0].transaction_date}`)

  // 2. Load market caps for all tickers in this batch
  const tickerSet = [...new Set(rows.map((r: any) => r.ticker as string))]
  const { data: tickerMeta } = await supabase
    .from('tickers')
    .select('symbol, market_cap')
    .in('symbol', tickerSet)

  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerMeta ?? []) {
    marketCapMap[t.symbol] = t.market_cap ?? null
  }

  // 3. Fetch SPY window per unique date (cached)
  const spyCache = new Map<string, HistRow[]>()

  async function getSpyHistory(dateStr: string): Promise<HistRow[]> {
    if (spyCache.has(dateStr)) return spyCache.get(dateStr)!
    const base = new Date(dateStr)
    const hist = await fetchHistory('SPY', offsetDate(base, -10), offsetDate(base, 16))
    spyCache.set(dateStr, hist)
    return hist
  }

  let enriched = 0
  let failed   = 0

  for (const row of rows) {
    try {
      const txDate   = new Date(row.transaction_date)
      const dateStr  = row.transaction_date as string
      const from     = offsetDate(txDate, -10)
      const to       = offsetDate(txDate, 16)

      // Fetch ticker history
      console.log(`[price-enrich] fetching ${row.ticker} ${from.toISOString().split('T')[0]} → ${to.toISOString().split('T')[0]}`)
      const history = await fetchHistory(row.ticker, from, to)
      console.log(`[price-enrich] ${row.ticker} got ${history.length} price rows`)
      if (history.length === 0) { console.log(`[price-enrich] ${row.ticker} SKIP: no history returned`); failed++; continue }

      const price0   = nthTradingDay(history, txDate, 0)
      console.log(`[price-enrich] ${row.ticker} price_on_day =`, price0)
      if (price0 == null) { console.log(`[price-enrich] ${row.ticker} SKIP: price_on_day is null`); failed++; continue }

      const price1d  = nthTradingDay(history, txDate, 1)
      const price3d  = nthTradingDay(history, txDate, 3)
      const price5d  = nthTradingDay(history, txDate, 5)
      const price10d = nthTradingDay(history, txDate, 10)

      // SPY for the same window
      await sleep(50)
      const spyHistory = await getSpyHistory(dateStr)
      const spy0   = nthTradingDay(spyHistory, txDate, 0)
      const spy5d  = nthTradingDay(spyHistory, txDate, 5)

      // Returns
      const actualReturn5d = price5d != null ? round2((price5d - price0) / price0 * 100) : null
      const spyReturn5d    = (spy0 != null && spy5d != null)
        ? round2((spy5d - spy0) / spy0 * 100) : null
      const adjustedReturn5d = (actualReturn5d != null && spyReturn5d != null)
        ? round2(actualReturn5d - spyReturn5d) : null

      // Purchase as % of market cap
      const marketCap = marketCapMap[row.ticker] ?? null
      const purchasePctMarketCap = (marketCap && row.total_value)
        ? round2(row.total_value / marketCap * 100) : null

      const update: Record<string, any> = {
        price_on_day:           price0,
        price_1d:               price1d,
        price_3d:               price3d,
        price_5d:               price5d,
        price_10d:              price10d,
        actual_return_5d:       actualReturn5d,
        spy_return_5d:          spyReturn5d,
        adjusted_return_5d:     adjustedReturn5d,
        purchase_pct_market_cap: purchasePctMarketCap,
      }

      const { error: updateErr } = await supabase
        .from('insider_transactions')
        .update(update)
        .eq('id', row.id)

      if (updateErr) { console.log(`[price-enrich] ${row.ticker} SKIP: supabase update error:`, updateErr.message); failed++; continue }

      enriched++
    } catch (err: any) {
      console.error('ENRICH ERROR:', row.ticker, err)
      failed++
    }

    await sleep(200)
  }

  return NextResponse.json({ total: rows.length, enriched, failed })
}
