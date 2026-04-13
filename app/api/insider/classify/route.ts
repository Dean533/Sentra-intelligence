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

  // Fetch a page of distinct insider_cik values with their trade dates.
  // We need 3 years of lookback, so pull everything from the past 4 years.
  const since = `${classifiedYear - 4}-01-01`

  const { data: rows, error } = await supabase
    .from('insider_transactions')
    .select('insider_cik, insider_name, transaction_date')
    .not('insider_cik', 'is', null)
    .gte('transaction_date', since)
    .order('insider_cik', { ascending: true })
    .order('transaction_date', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) {
    return NextResponse.json({ processed: 0, routine: 0, opportunistic: 0, unclassifiable: 0, remaining: 0 })
  }

  // Group by insider_cik and classify each
  const grouped = groupByInsider(rows as TradeRecord[])

  let routine       = 0
  let opportunistic = 0
  let unclassifiable = 0
  let failed        = 0

  const upserts: any[] = []

  for (const [cik, trades] of grouped) {
    const insiderName = trades[0].insider_name ?? null
    const result = classifyInsider(trades, classifiedYear)

    upserts.push({
      insider_cik:      cik,
      insider_name:     insiderName,
      classification:   result.classification,
      classified_year:  classifiedYear,
      active_months:    result.activeMonths,
      trade_year_count: result.tradeYearCount,
      total_trades:     trades.length,
      classified_at:    new Date().toISOString(),
    })

    if (result.classification === 'ROUTINE')       routine++
    else if (result.classification === 'OPPORTUNISTIC') opportunistic++
    else unclassifiable++
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await supabase
      .from('insider_classifications')
      .upsert(upserts, { onConflict: 'insider_cik,classified_year' })

    if (upsertErr) {
      failed = upserts.length
      return NextResponse.json({ error: upsertErr.message, failed }, { status: 500 })
    }
  }

  // Estimate remaining: if we got a full page, there may be more
  const remaining = rows.length === limit ? limit : 0

  return NextResponse.json({
    processed:     grouped.size,
    routine,
    opportunistic,
    unclassifiable,
    failed,
    remaining,
    offset_next:   remaining > 0 ? offset + limit : null,
  })
}
