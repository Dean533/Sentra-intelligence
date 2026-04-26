import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  computeConvictionScore,
  ConvictionTrade,
  TradeOutcome,
} from '@/lib/scoring/convictionScore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function median(vals: number[]): number | null {
  if (!vals.length) return null
  const s = vals.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params
  const TK = ticker.toUpperCase()

  // ── 1. Fetch 10 most recent open-market buy transactions ───────────────────
  const { data: txRows, error: txErr } = await supabase
    .from('insider_transactions')
    .select(
      'id, ticker, insider_name, insider_cik, officer_title, role, ' +
      'transaction_date, transaction_code, transaction_direction, ' +
      'total_value, price_per_share, shares, is_local'
    )
    .eq('ticker', TK)
    .eq('transaction_direction', 'buy')
    .eq('transaction_code', 'P')
    .order('transaction_date', { ascending: false })
    .limit(10)

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })
  if (!txRows || txRows.length === 0) return NextResponse.json({ data: null })

  // ── 2. Opportunistic classification flags ──────────────────────────────────
  const ciks = [...new Set((txRows as any[]).map(r => r.insider_cik).filter(Boolean))]
  const opportunisticCiks = new Set<string>()
  if (ciks.length > 0) {
    const { data: cls } = await supabase
      .from('insider_classifications')
      .select('insider_cik')
      .eq('classification', 'OPPORTUNISTIC')
      .in('insider_cik', ciks)
    for (const c of cls ?? []) opportunisticCiks.add((c as any).insider_cik)
  }

  // ── 3. Sector for this ticker ──────────────────────────────────────────────
  let sector: string | null = null
  const { data: tikMeta } = await supabase
    .from('tickers')
    .select('sector')
    .eq('symbol', TK)
    .maybeSingle()
  sector = (tikMeta as any)?.sector ?? null

  // ── 4. All opportunistic buys for this ticker in the past 6 months ─────────
  // Used to compute per-month cluster counts and ticker signal history.
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6)
  const since = sixMonthsAgo.toISOString().split('T')[0]

  const { data: recentTikTx } = await supabase
    .from('insider_transactions')
    .select('insider_name, total_value, transaction_date')
    .eq('ticker', TK)
    .eq('transaction_direction', 'buy')
    .gte('transaction_date', since)

  // ── 5. Ticker signal history (bullish = isPositive) ────────────────────────
  const { data: tikSignals } = await supabase
    .from('insider_signals_monthly')
    .select('signal_direction')
    .eq('ticker', TK)
    .order('signal_month', { ascending: false })
    .limit(12)

  const tickerHistory: TradeOutcome[] = (tikSignals ?? []).map(s => ({
    isPositive: (s as any).signal_direction === 'bullish',
  }))

  // ── 6. Per-insider history (batched) ───────────────────────────────────────
  // Fetch past trades with price outcomes for all unique insiders at once.
  const insiderHistoryMap = new Map<string, { outcomes: TradeOutcome[]; medianValue: number | null }>()

  for (const cik of ciks) {
    const { data: pastTrades } = await supabase
      .from('insider_transactions')
      .select('adjusted_return_5d, total_value')
      .eq('insider_cik', cik)
      .eq('transaction_direction', 'buy')
      .not('adjusted_return_5d', 'is', null)
      .order('transaction_date', { ascending: false })
      .limit(20)

    const outcomes: TradeOutcome[] = (pastTrades ?? []).map(r => ({
      isPositive: ((r as any).adjusted_return_5d ?? 0) > 0,
    }))

    const vals = (pastTrades ?? [])
      .map(r => (r as any).total_value)
      .filter((v): v is number => v != null)

    insiderHistoryMap.set(cik, { outcomes, medianValue: median(vals) })
  }

  // ── 7. Score every transaction, keep the best ──────────────────────────────
  let bestScore  = -1
  let bestResult: ReturnType<typeof computeConvictionScore> | null = null
  let bestTx:     any = null

  for (const tx of txRows as any[]) {
    const monthKey = (tx.transaction_date as string).slice(0, 7)

    // Cluster for this trade's month
    const monthTx = (recentTikTx ?? []).filter(r =>
      (r as any).transaction_date.startsWith(monthKey)
    )
    const clusterCount      = new Set(monthTx.map(r => (r as any).insider_name)).size
    const clusterTotalValue = monthTx.reduce((s, r) => s + ((r as any).total_value ?? 0), 0)

    const insiderData = insiderHistoryMap.get(tx.insider_cik) ??
      { outcomes: [], medianValue: null }

    const convTrade: ConvictionTrade = {
      ticker:               tx.ticker,
      insider_name:         tx.insider_name,
      officer_title:        tx.officer_title ?? null,
      role:                 tx.role ?? null,
      total_value:          tx.total_value ?? null,
      price_per_share:      tx.price_per_share ?? null,
      transaction_date:     tx.transaction_date,
      is_opportunistic:     tx.insider_cik ? opportunisticCiks.has(tx.insider_cik) : false,
      is_local:             tx.is_local ?? null,
      sector,
      cluster_count:        clusterCount,
      cluster_total_value:  clusterTotalValue,
      insider_median_value: insiderData.medianValue,
    }

    const result = computeConvictionScore(convTrade, insiderData.outcomes, tickerHistory)

    if (result.score > bestScore) {
      bestScore  = result.score
      bestResult = result
      bestTx     = tx
    }
  }

  if (!bestResult || !bestTx) return NextResponse.json({ data: null })

  return NextResponse.json({
    data: {
      score:              bestResult.score,
      classification:     bestResult.classification,
      role:               bestResult.role,
      factors:            bestResult.factors,
      holdDays:           bestResult.holdDays,
      positionMultiplier: bestResult.positionMultiplier,
      exitRules:          bestResult.exitRules,
      trade: {
        insider_name:     bestTx.insider_name,
        officer_title:    bestTx.officer_title ?? null,
        transaction_date: bestTx.transaction_date,
        total_value:      bestTx.total_value ?? null,
        price_per_share:  bestTx.price_per_share ?? null,
        shares:           bestTx.shares ?? null,
        is_opportunistic: opportunisticCiks.has(bestTx.insider_cik ?? ''),
      },
    },
  })
}
