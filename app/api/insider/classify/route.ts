import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function calendarMonth(dateStr: string): number {
  return new Date(dateStr).getUTCMonth() + 1  // 1-12
}

function calendarYear(dateStr: string): number {
  return new Date(dateStr).getUTCFullYear()
}

type TradeRecord = { insider_cik: string; insider_name: string | null; transaction_date: string }

type ClassificationResult = {
  classification: 'ROUTINE' | 'OPPORTUNISTIC' | 'UNCLASSIFIABLE'
  activeMonths: number[]
  tradeYearCount: number
}

// Cohen, Malloy & Pomorski (2012): classify an insider using 3 lookback calendar years.
// - Must have ≥1 trade in each of the 3 prior years to be classifiable.
// - If any calendar months appear in ALL 3 years → ROUTINE.
// - No overlapping months across all 3 years → OPPORTUNISTIC.
// - Fewer than 3 distinct trade years → UNCLASSIFIABLE.
function classifyInsider(trades: TradeRecord[], classifiedYear: number): ClassificationResult {
  const lookbackYears = [classifiedYear - 1, classifiedYear - 2, classifiedYear - 3]

  // Group trades by calendar year → set of months
  const monthsByYear = new Map<number, Set<number>>()
  for (const t of trades) {
    const y = calendarYear(t.transaction_date)
    const m = calendarMonth(t.transaction_date)
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set())
    monthsByYear.get(y)!.add(m)
  }

  // Check that all 3 lookback years have at least one trade
  const coveredYears = lookbackYears.filter((y) => (monthsByYear.get(y)?.size ?? 0) > 0)
  const tradeYearCount = coveredYears.length

  if (tradeYearCount < 3) {
    return { classification: 'UNCLASSIFIABLE', activeMonths: [], tradeYearCount }
  }

  // Find calendar months that appear in ALL 3 lookback years
  const [y1, y2, y3] = lookbackYears
  const months1 = monthsByYear.get(y1)!
  const months2 = monthsByYear.get(y2)!
  const months3 = monthsByYear.get(y3)!

  const activeMonths: number[] = []
  for (let m = 1; m <= 12; m++) {
    if (months1.has(m) && months2.has(m) && months3.has(m)) {
      activeMonths.push(m)
    }
  }

  if (activeMonths.length > 0) {
    return { classification: 'ROUTINE', activeMonths, tradeYearCount }
  }

  return { classification: 'OPPORTUNISTIC', activeMonths: [], tradeYearCount }
}

function groupByInsider(rows: TradeRecord[]): Map<string, TradeRecord[]> {
  const map = new Map<string, TradeRecord[]>()
  for (const row of rows) {
    if (!row.insider_cik) continue
    if (!map.has(row.insider_cik)) map.set(row.insider_cik, [])
    map.get(row.insider_cik)!.push(row)
  }
  return map
}

// ─── Route handler ────────────────────────────────────────────────────────────
// Trigger manually each January:
//   curl -H "X-Cron-Key: $KEY" "https://sentra.app/api/insider/classify?offset=0&limit=500"
// Repeat with increasing offset until { remaining: 0 }.

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  const { searchParams } = new URL(req.url)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const limit  = parseInt(searchParams.get('limit')  ?? '500', 10)

  const classifiedYear = new Date().getUTCFullYear()
  const since = `${classifiedYear - 4}-01-01`

  // ── Step 1: Get ALL distinct insider_cik values in the window ────────────────
  // PostgREST caps queries at 1000 rows by default. We must paginate through all
  // rows in chunks collecting distinct CIKs, otherwise we'd only see the first
  // 1000 rows and massively undercount distinct insiders.
  const CIK_PAGE = 1000
  const allCikSet = new Set<string>()
  let from = 0
  while (true) {
    const { data: chunk, error: cikErr } = await supabase
      .from('insider_transactions')
      .select('insider_cik')
      .not('insider_cik', 'is', null)
      .gte('transaction_date', since)
      .order('insider_cik', { ascending: true })
      .range(from, from + CIK_PAGE - 1)

    if (cikErr) return NextResponse.json({ error: cikErr.message }, { status: 500 })
    if (!chunk || chunk.length === 0) break
    for (const r of chunk) allCikSet.add((r as any).insider_cik)
    if (chunk.length < CIK_PAGE) break
    from += CIK_PAGE
  }

  const allCiks  = [...allCikSet].sort()
  const totalDistinct = allCiks.length
  const pageCiks = allCiks.slice(offset, offset + limit)

  if (pageCiks.length === 0) {
    return NextResponse.json({ processed: 0, routine: 0, opportunistic: 0, unclassifiable: 0, remaining: 0, offset_next: null })
  }

  // ── Step 2: Fetch ALL trades for every insider in this page ──────────────────
  // Paginate here too — 500 insiders with multi-year history can easily exceed
  // the 1000-row PostgREST cap, which would truncate trade histories mid-insider.
  const allTrades: TradeRecord[] = []
  let tradeFrom = 0
  while (true) {
    const { data: chunk, error: tradesErr } = await supabase
      .from('insider_transactions')
      .select('insider_cik, insider_name, transaction_date')
      .in('insider_cik', pageCiks)
      .gte('transaction_date', since)
      .order('transaction_date', { ascending: true })
      .range(tradeFrom, tradeFrom + CIK_PAGE - 1)

    if (tradesErr) return NextResponse.json({ error: tradesErr.message }, { status: 500 })
    if (!chunk || chunk.length === 0) break
    allTrades.push(...(chunk as TradeRecord[]))
    if (chunk.length < CIK_PAGE) break
    tradeFrom += CIK_PAGE
  }

  // ── Step 3: Classify each insider and build upsert rows ──────────────────────
  const grouped = groupByInsider(allTrades)

  let routine        = 0
  let opportunistic  = 0
  let unclassifiable = 0
  const upserts: any[] = []

  for (const [cik, cikTrades] of grouped) {
    const insiderName = cikTrades[0].insider_name ?? null
    const result = classifyInsider(cikTrades, classifiedYear)

    upserts.push({
      insider_cik:      cik,
      insider_name:     insiderName,
      classification:   result.classification,
      classified_year:  classifiedYear,
      active_months:    result.activeMonths,
      trade_year_count: result.tradeYearCount,
      total_trades:     cikTrades.length,
      classified_at:    new Date().toISOString(),
    })

    if (result.classification === 'ROUTINE')            routine++
    else if (result.classification === 'OPPORTUNISTIC') opportunistic++
    else                                                 unclassifiable++
  }

  // ── Step 4: Upsert — idempotent on (insider_cik, classified_year) ────────────
  let failed = 0
  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from('insider_classifications')
      .upsert(upserts, { onConflict: 'insider_cik,classified_year' })

    if (upsertErr) {
      failed = upserts.length
      return NextResponse.json({ error: upsertErr.message, failed }, { status: 500 })
    }
  }

  const remaining  = Math.max(0, totalDistinct - (offset + pageCiks.length))
  const offset_next = remaining > 0 ? offset + limit : null

  return NextResponse.json({
    processed:      grouped.size,
    routine,
    opportunistic,
    unclassifiable,
    failed,
    total_distinct: totalDistinct,
    remaining,
    offset_next,
  })
}
