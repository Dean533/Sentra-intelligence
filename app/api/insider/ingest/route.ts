import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'
import {
  runDailyIngest,
  ingestTickerInsiders,
  loadTickerMeta,
  loadCikMap,
} from '@/lib/insider/ingestCore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  const { searchParams } = new URL(req.url)
  const singleTicker = searchParams.get('ticker')?.toUpperCase() ?? null

  // ── single-ticker mode (?ticker=AAPL) ────────────────────────────────────
  if (singleTicker) {
    const tickerMeta = await loadTickerMeta(supabase)
    const meta       = tickerMeta.find((t) => t.symbol === singleTicker)
    if (!meta) {
      return NextResponse.json({ error: `Ticker ${singleTicker} not in tickers table` }, { status: 404 })
    }

    const symbolSet         = new Set(tickerMeta.map((t) => t.symbol))
    const { tickerToCik }   = await loadCikMap(symbolSet)
    const cikStr            = tickerToCik[singleTicker]
    if (!cikStr) {
      return NextResponse.json({ error: `Ticker ${singleTicker} not found in SEC CIK map` }, { status: 404 })
    }

    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const { inserted, skipped, insertFailed } = await ingestTickerInsiders(
      singleTicker, cikStr, cutoffDate, meta.hqState, meta.companyName, supabase
    )
    return NextResponse.json({ ticker: singleTicker, inserted, skipped, insertFailed })
  }

  // ── batch param: restricts to a quarter-slice of CIKs (manual / testing) ─
  const batchParam = searchParams.get('batch')
  const batch      = batchParam !== null ? Math.max(0, Math.min(3, parseInt(batchParam, 10))) : undefined

  // ── date range mode (?start_date=&end_date=) ──────────────────────────────
  const startDateParam = searchParams.get('start_date')
  const endDateParam   = searchParams.get('end_date')

  if (startDateParam && endDateParam) {
    const start = new Date(startDateParam)
    const end   = new Date(endDateParam)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return NextResponse.json({ error: 'Invalid start_date or end_date' }, { status: 400 })
    }
    const { days, totals, healthOk } = await runDailyIngest(supabase, {
      startDate:  startDateParam,
      endDate:    endDateParam,
      batch,
      batchCount: batch !== undefined ? 4 : undefined,
    })
    return NextResponse.json({ batch: batch ?? null, healthOk, days, totals }, { status: healthOk ? 200 : 500 })
  }

  // ── single-date mode (?date=YYYY-MM-DD) ───────────────────────────────────
  const explicitDate = searchParams.get('date')
  if (explicitDate) {
    const { days, totals, healthOk } = await runDailyIngest(supabase, {
      date:       explicitDate,
      batch,
      batchCount: batch !== undefined ? 4 : undefined,
    })
    const result = days[0]
    if (result?.error) return NextResponse.json({ error: result.error }, { status: 502 })
    return NextResponse.json({ batch: batch ?? null, healthOk, ...result, totals }, { status: healthOk ? 200 : 500 })
  }

  // ── daily rolling-window mode (no date param) ─────────────────────────────
  const { days, totals, healthOk } = await runDailyIngest(supabase, {
    batch,
    batchCount: batch !== undefined ? 4 : undefined,
  })

  const todayStr    = new Date().toISOString().split('T')[0]
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  return NextResponse.json({
    batch:  batch ?? null,
    window: `${fiveDaysAgo}..${todayStr}`,
    healthOk,
    days,
    totals,
  }, { status: healthOk ? 200 : 500 })
}
