import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

// Cohen, Malloy & Pomorski (2012) Table V signal formula.
// buy_signal  =  0.66 × ln(1 + opportunistic_buy_count)
// sell_signal = -0.31 × ln(1 + opportunistic_sell_count)
// local_boost =  0.03 × local_opportunistic_count  (zero until HQ state data available)
function computeExpectedMove(buys: number, sells: number, local: number): number {
  const buySignal   =  0.66 * Math.log(1 + buys)
  const sellSignal  = -0.31 * Math.log(1 + sells)
  const localBoost  =  0.03 * local
  return Math.round((buySignal + sellSignal + localBoost) * 10000) / 10000
}

function clusterStrength(maxCount: number): 'LOW' | 'MEDIUM' | 'HIGH' | null {
  if (maxCount >= 3) return 'HIGH'
  if (maxCount === 2) return 'MEDIUM'
  if (maxCount === 1) return 'LOW'
  return null
}

function signalDirection(expectedMove: number): 'bullish' | 'bearish' | 'neutral' {
  if (expectedMove > 0.05)  return 'bullish'
  if (expectedMove < -0.05) return 'bearish'
  return 'neutral'
}

// ─── Route handler ────────────────────────────────────────────────────────────
// Runs on the 2nd of each month at 12:00 UTC (vercel.json cron).
// Also supports ?top=N query param for reading top signals (GET without cron auth).

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const topParam = searchParams.get('top')

  // ── Read path: /api/insider/signals-monthly?top=10 ────────────────────────
  if (topParam) {
    const n = Math.min(parseInt(topParam, 10), 50)
    const currentMonth = new Date()
    currentMonth.setUTCDate(1)
    currentMonth.setUTCHours(0, 0, 0, 0)
    const monthStr = currentMonth.toISOString().split('T')[0]

    const { data, error } = await supabase
      .from('insider_signals_monthly')
      .select('ticker, signal_direction, expected_move_pct, opportunistic_buy_count, opportunistic_sell_count, cluster_strength, routine_trades_filtered, signal_month')
      .eq('signal_month', monthStr)
      .order('expected_move_pct', { ascending: false })
      .limit(n)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  }

  // ── Write path: cron-protected ────────────────────────────────────────────
  const deny = authorizeCron(req)
  if (deny) return deny

  // Compute the prior calendar month's date range
  const now = new Date()
  const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const firstOfLastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const signalMonth = firstOfLastMonth.toISOString().split('T')[0]  // e.g. "2026-03-01"
  const rangeFrom   = firstOfLastMonth.toISOString().split('T')[0]
  const rangeTo     = new Date(firstOfThisMonth.getTime() - 1).toISOString().split('T')[0]
  const classifiedYear = now.getUTCFullYear()

  // Fetch all tickers
  const { data: tickerRows, error: tickerErr } = await supabase
    .from('tickers')
    .select('symbol')

  if (tickerErr) return NextResponse.json({ error: tickerErr.message }, { status: 500 })
  const tickers = (tickerRows ?? []).map((r: any) => r.symbol as string)

  // Bulk-fetch classifications for current year AND prior year in one query.
  // Prior year acts as fallback when the annual classify job hasn't run yet (Jan/Feb gap).
  const { data: classifications } = await supabase
    .from('insider_classifications')
    .select('insider_cik, classification, classified_year')
    .in('classified_year', [classifiedYear, classifiedYear - 1])

  // Build classMap preferring current year; fall back to prior year per insider_cik.
  const classMap: Record<string, string> = {}
  const priorYearMap: Record<string, string> = {}
  for (const c of classifications ?? []) {
    const cik  = (c as any).insider_cik as string
    const year = (c as any).classified_year as number
    const cls  = (c as any).classification as string
    if (year === classifiedYear) {
      classMap[cik] = cls
    } else {
      priorYearMap[cik] = cls
    }
  }

  let fallbackCount = 0
  for (const [cik, cls] of Object.entries(priorYearMap)) {
    if (!classMap[cik]) {
      classMap[cik] = cls
      fallbackCount++
    }
  }

  if (fallbackCount > 0) {
    console.log(`[classify] ${fallbackCount} insider(s) using prior-year (${classifiedYear - 1}) classification as fallback`)
  }

  // Set of every CIK that appears in the classification table under any result.
  // An absent CIK means the insider has never been run through the classify job —
  // distinct from being classified ROUTINE or UNCLASSIFIABLE and failing.
  const classifiedCikSet = new Set(Object.keys(classMap))

  // Returns true when a transaction should be treated as inferred-opportunistic.
  // Mirrors the same criteria used in app/api/insider/conviction/[ticker]/route.ts.
  function inferredOpportunistic(tx: any): boolean {
    const cik  = tx.insider_cik as string | null
    const val  = (tx.total_value ?? 0) as number
    const text = ((tx.officer_title ?? '') + ' ' + (tx.role ?? '')).toLowerCase()
    return (
      !!cik &&
      (!classifiedCikSet.has(cik) || classMap[cik] === 'UNCLASSIFIABLE') &&
      tx.transaction_direction === 'buy' &&
      val >= 1_000_000 &&
      (text.includes('ceo') || text.includes('chief executive') ||
       text.includes('president') || text.includes('10%'))
    )
  }

  // Fetch last month's transactions for all tracked tickers in one query.
  // officer_title and role are needed for inferred-opportunistic detection.
  const { data: allTx, error: txErr } = await supabase
    .from('insider_transactions')
    .select('ticker, insider_cik, insider_name, officer_title, role, transaction_direction, total_value, is_local')
    .in('ticker', tickers)
    .gte('transaction_date', rangeFrom)
    .lte('transaction_date', rangeTo)
    .not('transaction_direction', 'is', null)
    .neq('is_plan_sale', true)

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  // Diagnostic: log TTD-specific transaction counts to reveal is_plan_sale / classification gaps
  const ttdAll = (allTx ?? []).filter((r: any) => r.ticker === 'TTD')
  if (ttdAll.length > 0) {
    console.log(`[signals-monthly] TTD: ${ttdAll.length} tx passed is_plan_sale=false filter`)
    for (const r of ttdAll) {
      const cik = (r as any).insider_cik
      const cls = cik ? (classMap[cik] ?? 'NOT IN classMap') : 'NULL cik'
      console.log(`[signals-monthly] TTD tx: ${(r as any).insider_name} | dir=${(r as any).transaction_direction} | val=${(r as any).total_value} | cik=${cik} | classification=${cls}`)
    }
  } else {
    // Check if TTD trades exist at all but were blocked by is_plan_sale filter
    const { data: ttdUnfiltered } = await supabase
      .from('insider_transactions')
      .select('insider_name, transaction_direction, total_value, is_plan_sale, transaction_date')
      .eq('ticker', 'TTD')
      .gte('transaction_date', rangeFrom)
      .lte('transaction_date', rangeTo)
    if ((ttdUnfiltered?.length ?? 0) > 0) {
      console.log(`[signals-monthly] TTD: 0 rows passed filter BUT ${ttdUnfiltered!.length} exist unfiltered — is_plan_sale values:`)
      for (const r of ttdUnfiltered!) {
        console.log(`[signals-monthly] TTD unfiltered: ${(r as any).insider_name} | is_plan_sale=${(r as any).is_plan_sale} | val=${(r as any).total_value} | date=${(r as any).transaction_date}`)
      }
    } else {
      console.log(`[signals-monthly] TTD: no transactions found in range ${rangeFrom}–${rangeTo}`)
    }
  }

  // Group transactions by ticker
  const txByTicker = new Map<string, typeof allTx>()
  for (const tx of allTx ?? []) {
    const t = (tx as any).ticker as string
    if (!txByTicker.has(t)) txByTicker.set(t, [])
    txByTicker.get(t)!.push(tx)
  }

  const upserts: any[] = []
  let computed = 0

  for (const ticker of tickers) {
    const txList = txByTicker.get(ticker) ?? []
    if (txList.length === 0) continue

    let opportunisticBuys  = 0
    let opportunisticSells = 0
    let localOpportunistic = 0
    let buyValue           = 0
    let sellValue          = 0
    let routineFiltered    = 0
    let hasInferred        = false

    for (const tx of txList) {
      const cik            = (tx as any).insider_cik as string | null
      const direction      = (tx as any).transaction_direction as string
      const value          = (tx as any).total_value as number | null
      const isLocal        = (tx as any).is_local as boolean | null
      const classification = cik ? (classMap[cik] ?? null) : null

      const confirmed = classification === 'OPPORTUNISTIC'
      const inferred  = !confirmed && inferredOpportunistic(tx)

      if (!confirmed && !inferred) {
        routineFiltered++
        continue
      }

      if (inferred) hasInferred = true

      if (direction === 'buy') {
        opportunisticBuys++
        buyValue += value ?? 0
      } else if (direction === 'sell') {
        opportunisticSells++
        sellValue += value ?? 0
      }

      if (isLocal) localOpportunistic++
    }

    if (opportunisticBuys === 0 && opportunisticSells === 0) continue

    const maxCount     = Math.max(opportunisticBuys, opportunisticSells)
    const strength     = clusterStrength(maxCount)
    const expectedMove = computeExpectedMove(opportunisticBuys, opportunisticSells, localOpportunistic)
    const direction    = signalDirection(expectedMove)

    upserts.push({
      ticker,
      signal_month:                signalMonth,
      opportunistic_buy_count:     opportunisticBuys,
      opportunistic_sell_count:    opportunisticSells,
      opportunistic_buy_value:     buyValue > 0 ? Math.round(buyValue) : null,
      opportunistic_sell_value:    sellValue > 0 ? Math.round(sellValue) : null,
      local_opportunistic_count:   localOpportunistic,
      cluster_strength:            strength,
      expected_move_pct:           expectedMove,
      signal_direction:            direction,
      routine_trades_filtered:     routineFiltered,
      is_inferred_opportunistic:   hasInferred,
      computed_at:                 new Date().toISOString(),
    })

    computed++
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from('insider_signals_monthly')
      .upsert(upserts, { onConflict: 'ticker,signal_month' })

    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    signal_month: signalMonth,
    tickers_checked: tickers.length,
    signals_computed: computed,
    signals_upserted: upserts.length,
  })
}
