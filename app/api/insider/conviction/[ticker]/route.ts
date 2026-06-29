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
      'total_value, price_per_share, shares, shares_owned_after, is_local'
    )
    .eq('ticker', TK)
    .eq('transaction_direction', 'buy')
    .eq('transaction_code', 'P')
    .neq('is_issuer_buyback', true)
    .order('transaction_date', { ascending: false })
    .limit(10)

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  console.log(`[conviction/${TK}] raw query: found ${txRows?.length ?? 0} row(s)`)
  if (!txRows || txRows.length === 0) {
    // Retry without transaction_code filter to check if the code is the blocker
    const { data: relaxedRows } = await supabase
      .from('insider_transactions')
      .select('id, insider_name, insider_cik, transaction_code, transaction_direction, total_value, transaction_date')
      .eq('ticker', TK)
      .eq('transaction_direction', 'buy')
      .order('transaction_date', { ascending: false })
      .limit(5)
    console.log(`[conviction/${TK}] relaxed query (no code filter): ${relaxedRows?.length ?? 0} row(s)`)
    for (const r of relaxedRows ?? []) {
      console.log(`[conviction/${TK}]   ${(r as any).insider_name} | code="${(r as any).transaction_code}" | dir="${(r as any).transaction_direction}" | val=${(r as any).total_value} | date=${(r as any).transaction_date} | cik=${(r as any).insider_cik}`)
    }
    return NextResponse.json({ data: null })
  }

  for (const r of txRows as any[]) {
    console.log(`[conviction/${TK}] tx: ${r.insider_name} | code="${r.transaction_code}" | val=${r.total_value} | date=${r.transaction_date} | cik=${r.insider_cik ?? 'NULL'}`)
  }

  // ── 2. Classification flags ────────────────────────────────────────────────
  // Fetch ALL classification rows for these CIKs (not just OPPORTUNISTIC) so we can
  // distinguish "classified ROUTINE/UNCLASSIFIABLE" from "not in table yet".
  const ciks = [...new Set((txRows as any[]).map(r => r.insider_cik).filter(Boolean))]
  const opportunisticCiks = new Set<string>()  // confirmed by classify job
  const classifiedCiks    = new Set<string>()  // any classification — present in table
  const routineCiks       = new Set<string>()  // explicitly ROUTINE — never scored
  if (ciks.length > 0) {
    const { data: cls } = await supabase
      .from('insider_classifications')
      .select('insider_cik, classification')
      .in('insider_cik', ciks)
    for (const c of cls ?? []) {
      classifiedCiks.add((c as any).insider_cik)
      if ((c as any).classification === 'OPPORTUNISTIC')
        opportunisticCiks.add((c as any).insider_cik)
      if ((c as any).classification === 'ROUTINE')
        routineCiks.add((c as any).insider_cik)
    }
  }
  console.log(`[conviction/${TK}] ciks found: [${ciks.join(', ')}]`)
  console.log(`[conviction/${TK}] opportunistic ciks: [${[...opportunisticCiks].join(', ')}]`)
  console.log(`[conviction/${TK}] classified (any): [${[...classifiedCiks].join(', ')}]`)

  // ── 3. Sector for this ticker ──────────────────────────────────────────────
  let sector: string | null = null
  let market_cap: number | null = null
  const { data: tikMeta } = await supabase
    .from('tickers')
    .select('sector, market_cap')
    .eq('symbol', TK)
    .maybeSingle()
  sector     = (tikMeta as any)?.sector     ?? null
  market_cap = (tikMeta as any)?.market_cap ?? null

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

  // Infer opportunistic status for insiders who have a CIK but have never been
  // run through the annual classify job. Criteria: ≥$1M trade AND CEO/President role.
  // Insiders classified as ROUTINE or UNCLASSIFIABLE are never inferred — they had their
  // chance and lost. Only truly unclassified (absent from the table) qualify.
  function isEligibleForInference(tx: any): boolean {
    const val  = (tx.total_value ?? 0) as number
    const text = ((tx.role ?? '') + ' ' + (tx.officer_title ?? '')).toLowerCase()
    return (
      val >= 1_000_000 &&
      (text.includes('ceo') || text.includes('chief executive') || text.includes('president'))
    )
  }

  let bestScore   = -1
  let bestResult: ReturnType<typeof computeConvictionScore> | null = null
  let bestTx:     any   = null
  let bestInferred = false

  for (const tx of txRows as any[]) {
    const txCik = tx.insider_cik as string | null
    if (txCik && routineCiks.has(txCik)) {
      console.log(`[conviction/${TK}] skipping ${tx.insider_name} — classified ROUTINE`)
      continue
    }

    const monthKey = (tx.transaction_date as string).slice(0, 7)

    const monthTx = (recentTikTx ?? []).filter(r =>
      (r as any).transaction_date.startsWith(monthKey)
    )
    const clusterCount      = new Set(monthTx.map(r => (r as any).insider_name)).size
    const clusterTotalValue = monthTx.reduce((s, r) => s + ((r as any).total_value ?? 0), 0)

    const insiderData = insiderHistoryMap.get(tx.insider_cik) ??
      { outcomes: [], medianValue: null }

    // Determine opportunistic status, with inference fallback
    const cik              = tx.insider_cik as string | null
    const isConfirmed      = cik ? opportunisticCiks.has(cik) : false
    const isKnownNonOpport = cik ? (classifiedCiks.has(cik) && !opportunisticCiks.has(cik)) : false
    const isInferred       = !isConfirmed && !isKnownNonOpport && !!cik && isEligibleForInference(tx)
    const isOpportunistic  = isConfirmed || isInferred

    const inferTag = isInferred ? ' [INFERRED]' : isConfirmed ? ' [CONFIRMED]' : ' [NOT_OPPORTUNISTIC]'
    console.log(
      `[conviction/${TK}] scored ${tx.insider_name}${inferTag}: ` +
      `val=${tx.total_value} | sector="${sector}" | ` +
      `cluster=${clusterCount} ($${(clusterTotalValue / 1e6).toFixed(1)}M) | ` +
      `history=${insiderData.outcomes.length} trades`
    )

    // Resolve three-way CMP classification for the new scoring engine.
    // Prefer confirmed classification; fall back to inferred-opportunistic; else null.
    const txCls: 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null =
      cik && opportunisticCiks.has(cik) ? 'OPPORTUNISTIC'
      : isInferred                       ? 'OPPORTUNISTIC'
      : cik && routineCiks.has(cik)      ? 'ROUTINE'
      : cik && classifiedCiks.has(cik)   ? 'UNCLASSIFIABLE'
      : null

    const convTrade: ConvictionTrade = {
      ticker:               tx.ticker,
      insider_name:         tx.insider_name,
      officer_title:        tx.officer_title ?? null,
      role:                 tx.role ?? null,
      total_value:          tx.total_value ?? null,
      price_per_share:      tx.price_per_share ?? null,
      transaction_date:     tx.transaction_date,
      is_opportunistic:     isOpportunistic,
      is_local:             tx.is_local ?? null,
      sector,
      cluster_count:        clusterCount,
      cluster_total_value:  clusterTotalValue,
      insider_median_value: insiderData.medianValue,
      // New validated-factor inputs
      classification:       txCls,
      shares:               tx.shares ?? null,
      shares_owned_after:   tx.shares_owned_after ?? null,
      market_cap,
      momentum_90d:         null,  // not fetched at this stage; graceful neutral
    }

    const result = computeConvictionScore(convTrade, insiderData.outcomes, tickerHistory)

    console.log(
      `[conviction/${TK}]   → score=${result.score} (${result.classification}) | ` +
      `factors=[${result.factors.join(' · ')}]`
    )

    if (result.score > bestScore) {
      bestScore    = result.score
      bestResult   = result
      bestTx       = tx
      bestInferred = isInferred
    }
  }

  console.log(`[conviction/${TK}] best score: ${bestScore}`)
  if (!bestResult || !bestTx) return NextResponse.json({ data: null })

  return NextResponse.json({
    data: {
      score:              bestResult.score,
      color:              bestResult.color,       // 'green' | 'yellow' | 'red' | 'gray'
      breakdown:          bestResult.breakdown,   // [{factor, points, maxPoints, reason}]
      classification:     bestResult.classification,
      role:               bestResult.role,
      factors:            bestResult.factors,
      holdDays:           bestResult.holdDays,
      positionMultiplier: bestResult.positionMultiplier,
      exitRules:          bestResult.exitRules,
      trade: {
        insider_name:              bestTx.insider_name,
        officer_title:             bestTx.officer_title ?? null,
        transaction_date:          bestTx.transaction_date,
        total_value:               bestTx.total_value ?? null,
        price_per_share:           bestTx.price_per_share ?? null,
        shares:                    bestTx.shares ?? null,
        is_opportunistic:          opportunisticCiks.has(bestTx.insider_cik ?? '') || bestInferred,
        is_inferred_opportunistic: bestInferred,
      },
    },
  })
}
