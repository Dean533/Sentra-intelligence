import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const SELECT_COLS =
  'id, ticker, insider_name, insider_cik, role, is_director, is_officer, officer_title, ' +
  'transaction_date, transaction_code, transaction_direction, ' +
  'shares, price_per_share, total_value, shares_owned_after, purchase_pct_market_cap, ' +
  'filed_date, source_url'

// Attach classification string to every row. Rows with no matching CIK → UNCLASSIFIABLE.
async function attachClassifications(rows: any[]): Promise<any[]> {
  if (rows.length === 0) return rows
  const ciks = [...new Set(rows.map((r: any) => r.insider_cik).filter(Boolean))]
  let cikClassMap = new Map<string, string>()
  if (ciks.length > 0) {
    const { data: clsRows } = await supabase
      .from('insider_classifications')
      .select('insider_cik, classification')
      .in('insider_cik', ciks)
    cikClassMap = new Map((clsRows ?? []).map((c: any) => [c.insider_cik, c.classification as string]))
  }
  return rows.map((r: any) => ({
    ...r,
    classification: cikClassMap.get(r.insider_cik) ?? 'UNCLASSIFIABLE',
  }))
}

type ClusterResult = {
  counts:   Map<string, number>         // ticker → max insiders in any window
  tradeSets: Map<string, Set<string>>   // ticker → Set of 'cik|date' keys for cluster trades
}

// For each ticker, finds the max distinct-insider count in any 30-day window and
// records which specific (cik, date) pairs fall inside a qualifying window.
function computeClusters(
  rows: { ticker: string; insider_cik: string; transaction_date: string }[],
  minInsiders: number
): ClusterResult {
  const byTicker = new Map<string, { cik: string; date: string; ms: number }[]>()
  for (const row of rows) {
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, [])
    byTicker.get(row.ticker)!.push({
      cik:  row.insider_cik,
      date: row.transaction_date.slice(0, 10),
      ms:   new Date(row.transaction_date).getTime(),
    })
  }
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  const counts   = new Map<string, number>()
  const tradeSets = new Map<string, Set<string>>()

  for (const [ticker, trades] of byTicker) {
    trades.sort((a, b) => a.ms - b.ms)
    let maxCount = 0
    const clusterSet = new Set<string>()
    for (let i = 0; i < trades.length; i++) {
      const windowEnd    = trades[i].ms + WINDOW_MS
      const inWindow: typeof trades = []
      const distinctCiks = new Set<string>()
      for (let j = i; j < trades.length && trades[j].ms <= windowEnd; j++) {
        inWindow.push(trades[j])
        distinctCiks.add(trades[j].cik)
      }
      if (distinctCiks.size > maxCount) maxCount = distinctCiks.size
      if (distinctCiks.size >= minInsiders) {
        for (const t of inWindow) clusterSet.add(`${t.cik}|${t.date}`)
      }
    }
    counts.set(ticker, maxCount)
    if (clusterSet.size > 0) tradeSets.set(ticker, clusterSet)
  }
  return { counts, tradeSets }
}

function passesHoldingsFilter(row: any, min: number): boolean {
  const s     = row.shares as number | null
  const after = row.shares_owned_after as number | null
  const code  = (row.transaction_code ?? '').toUpperCase()
  if (s == null || after == null) return false
  const denom = code === 'S' ? after + s : after - s
  if (denom <= 0) return false
  const pct = Math.min((s / denom) * 100, 999)
  return pct >= min
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ticker         = searchParams.get('ticker')?.toUpperCase() ?? null
  const direction      = searchParams.get('direction') ?? 'all'
  const classification = searchParams.get('classification') ?? null
  const role           = searchParams.get('role') ?? null
  const startDate      = searchParams.get('start_date') ?? null
  const endDate        = searchParams.get('end_date') ?? null
  const clusterMin     = parseInt(searchParams.get('cluster_min') ?? '0', 10)
  const holdingsMinRaw = searchParams.get('holdings_min')
  const holdingsMin    = holdingsMinRaw ? parseFloat(holdingsMinRaw) : null
  const limit          = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const page           = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset         = (page - 1) * limit

  const clusterCounts: Record<string, number> = {}

  // ── 1. Classification pre-fetch ───────────────────────────────────────────────
  let classificationCiks: string[] | null = null
  if (classification && classification !== 'all') {
    if (classification === 'OPPORTUNISTIC' || classification === 'ROUTINE') {
      const { data: clsRows } = await supabase
        .from('insider_classifications')
        .select('insider_cik')
        .eq('classification', classification)
      classificationCiks = (clsRows ?? []).map((r: any) => r.insider_cik as string).filter(Boolean)
      if (classificationCiks.length === 0) {
        return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })
      }
    } else if (classification === 'UNCLASSIFIABLE') {
      const { data: clsRows } = await supabase
        .from('insider_classifications')
        .select('insider_cik')
        .eq('classification', 'UNCLASSIFIABLE')
      classificationCiks = (clsRows ?? []).map((r: any) => r.insider_cik as string).filter(Boolean)
    }
  }

  // ── 2. Cluster pre-fetch ──────────────────────────────────────────────────────
  let clusteredTickers: string[] | null = null
  let clusterTradeMap = new Map<string, Set<string>>()
  if (clusterMin >= 2) {
    const clusterFrom = startDate
      ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    let clusterQ = supabase
      .from('insider_transactions')
      .select('ticker, insider_cik, transaction_date')
      .eq('transaction_code', 'P')
      .gte('transaction_date', clusterFrom)
      .not('insider_cik', 'is', null)
      .limit(10000)
    if (endDate) clusterQ = clusterQ.lte('transaction_date', endDate)
    if (ticker)  clusterQ = clusterQ.eq('ticker', ticker)
    const { data: clusterData } = await clusterQ
    const { counts: countMap, tradeSets } = computeClusters(clusterData ?? [], clusterMin)
    clusterTradeMap = tradeSets
    for (const [t, cnt] of countMap) {
      if (cnt >= clusterMin) clusterCounts[t] = cnt
    }
    clusteredTickers = Object.keys(clusterCounts)
    if (clusteredTickers.length === 0) {
      return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })
    }
  }

  // ── 3. Base query factory (all filters except range/count) ────────────────────
  // Returns null when the ticker+cluster intersection is empty.
  function buildBaseQuery(withCount: boolean) {
    let q = supabase
      .from('insider_transactions')
      .select(SELECT_COLS, withCount ? { count: 'exact' } : {})
      .order('transaction_date', { ascending: false })

    // Direction
    if (direction === 'buys')       q = q.eq('transaction_code', 'P')
    else if (direction === 'sells') q = q.eq('transaction_code', 'S')
    else                            q = q.in('transaction_code', ['P', 'S'])

    // Ticker / cluster
    if (clusteredTickers) {
      if (ticker) {
        if (!clusteredTickers.includes(ticker)) return null
        q = q.eq('ticker', ticker)
      } else {
        q = q.in('ticker', clusteredTickers)
      }
    } else if (ticker) {
      q = q.eq('ticker', ticker)
    }

    // Classification
    if (classification === 'OPPORTUNISTIC' || classification === 'ROUTINE') {
      q = q.in('insider_cik', classificationCiks!)
    } else if (classification === 'UNCLASSIFIABLE') {
      if (classificationCiks && classificationCiks.length > 0) {
        q = q.or(`insider_cik.is.null,insider_cik.in.(${classificationCiks.join(',')})`)
      } else {
        q = q.is('insider_cik', null)
      }
    }

    // Role
    if (role && role !== 'all' && role !== 'other') {
      if (role === 'ceo')      q = q.ilike('officer_title', '%Chief Executive%')
      if (role === 'cfo')      q = q.ilike('officer_title', '%Chief Financial%')
      if (role === 'director') q = q.eq('is_director', true)
      if (role === '10pct')    q = q.ilike('officer_title', '%10%')
    }

    // Date range
    if (startDate) q = q.gte('transaction_date', startDate)
    if (endDate)   q = q.lte('transaction_date', endDate)

    return q
  }

  // ── 4a. Batch path — JS filtering needed for holdings formula or cluster trades ─
  if (holdingsMin !== null || clusterMin >= 2) {
    const base = buildBaseQuery(false)
    if (!base) return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })

    const { data: allData, error } = await base.limit(5000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let matching: any[] = allData ?? []
    if (holdingsMin !== null) {
      matching = matching.filter((row: any) => passesHoldingsFilter(row, holdingsMin))
    }
    if (clusterMin >= 2) {
      matching = matching.filter((row: any) => {
        const set = clusterTradeMap.get(row.ticker)
        if (!set) return false
        const date = (row.transaction_date ?? '').slice(0, 10)
        return set.has(`${row.insider_cik}|${date}`)
      })
    }

    const total    = matching.length
    const pages    = Math.ceil(total / limit) || 1
    const pageRows = matching.slice(offset, offset + limit)

    return NextResponse.json({
      rows:  await attachClassifications(pageRows),
      total,
      page,
      pages,
      clusterCounts,
    })
  }

  // ── 4b. Normal path — single query with server-side pagination ────────────────
  const base = buildBaseQuery(true)
  if (!base) return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })

  const { data, count, error } = await base.range(offset, offset + limit - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    rows:  await attachClassifications(data ?? []),
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
    clusterCounts,
  })
}
