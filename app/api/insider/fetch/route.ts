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
// Window is centred on each purchase: [trade.ms − 30d, trade.ms + 30d].
// This catches clusters where consecutive buys each straddle a window boundary
// (e.g. A on day 0, B on day 25, C on day 50 — B is within 30d of both A and C).
function computeClusters(
  rows: { ticker: string; insider_cik: string | null; insider_name: string | null; transaction_date: string }[],
  minInsiders: number
): ClusterResult {
  const byTicker = new Map<string, { cik: string; date: string; ms: number }[]>()
  for (const row of rows) {
    const id = row.insider_cik ?? row.insider_name
    if (!id) continue
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, [])
    byTicker.get(row.ticker)!.push({
      cik:  id,
      date: row.transaction_date.slice(0, 10),
      ms:   new Date(row.transaction_date).getTime(),
    })
  }
  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  const counts    = new Map<string, number>()
  const tradeSets = new Map<string, Set<string>>()

  for (const [ticker, trades] of byTicker) {
    trades.sort((a, b) => a.ms - b.ms)
    let maxCount = 0
    const clusterSet = new Set<string>()

    for (let i = 0; i < trades.length; i++) {
      const lo = trades[i].ms - WINDOW_MS   // 30 days before this purchase
      const hi = trades[i].ms + WINDOW_MS   // 30 days after  this purchase
      const inWindow: typeof trades = []
      const distinctCiks = new Set<string>()

      for (let j = 0; j < trades.length; j++) {
        if (trades[j].ms < lo) continue   // before window — keep scanning (sorted asc)
        if (trades[j].ms > hi) break      // past window end — done
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
  const minValueRaw    = searchParams.get('min_value')
  const minValue       = minValueRaw ? parseInt(minValueRaw, 10) : null
  const limit          = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const page           = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset         = (page - 1) * limit

  const clusterCounts: Record<string, number> = {}

  // Effective lower-date bound for cluster queries — computed once and reused by
  // both the discovery pass and the batch fetch so both cover the same window.
  const clusterFrom: string | null = clusterMin >= 2
    ? (startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    : null

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

  // ── 2. Cluster pre-fetch — paginate through all purchases in the window ────────
  // Supabase PostgREST caps responses at 1 000 rows by default, so the page size
  // must match that cap — a larger value causes the break condition to fire after
  // the first page (pageRows.length < PAGE_SIZE is always true when capped at 1 000).
  let clusteredTickers: string[] | null = null
  let clusterTradeMap = new Map<string, Set<string>>()
  if (clusterMin >= 2 && clusterFrom) {
    const CLUSTER_PAGE = 1_000
    const clusterAllData: { ticker: string; insider_cik: string | null; insider_name: string | null; transaction_date: string }[] = []

    for (let from = 0; ; from += CLUSTER_PAGE) {
      let q = supabase
        .from('insider_transactions')
        .select('ticker, insider_cik, insider_name, transaction_date')
        .eq('transaction_code', 'P')
        .gte('transaction_date', clusterFrom)
        .order('transaction_date', { ascending: true })
        .range(from, from + CLUSTER_PAGE - 1)
      if (endDate) q = q.lte('transaction_date', endDate)
      if (ticker)  q = q.eq('ticker', ticker)
      const { data: pageRows } = await q
      if (!pageRows || pageRows.length === 0) break
      clusterAllData.push(...pageRows)
      if (pageRows.length < CLUSTER_PAGE) break
    }

    const { counts: countMap, tradeSets } = computeClusters(clusterAllData, clusterMin)
    clusterTradeMap = tradeSets
    for (const [t, cnt] of countMap) {
      if (cnt >= clusterMin) clusterCounts[t] = cnt
    }
    clusteredTickers = Object.keys(clusterCounts)

    console.log(`[cluster] clusterMin=${clusterMin} clusterFrom=${clusterFrom} endDate=${endDate ?? 'none'}`)
    console.log(`[cluster] filtered discovery (within window): ${clusteredTickers.length} tickers with ${clusterMin}+ insiders`)
    if (clusteredTickers.length > 0) {
      console.log(`[cluster] tickers: ${clusteredTickers.join(', ')}`)
      // Log the date sets inside clusterTradeMap for the first 3 tickers
      for (const t of clusteredTickers.slice(0, 3)) {
        const keys = [...(clusterTradeMap.get(t) ?? [])]
        const dates = [...new Set(keys.map(k => k.split('|')[1]))].sort()
        console.log(`[cluster]   ${t}: cluster dates ${dates.join(', ')} (${keys.length} cik|date pairs)`)
      }
    }

    // ── Diagnostic: full-table scan (no date filter) ─────────────────────────
    {
      const DIAG_PAGE = 1_000
      const diagData: { ticker: string; insider_cik: string | null; insider_name: string | null; transaction_date: string }[] = []
      for (let f = 0; ; f += DIAG_PAGE) {
        let dq = supabase
          .from('insider_transactions')
          .select('ticker, insider_cik, insider_name, transaction_date')
          .eq('transaction_code', 'P')
          .order('transaction_date', { ascending: true })
          .range(f, f + DIAG_PAGE - 1)
        if (ticker) dq = dq.eq('ticker', ticker)
        const { data: diagPage } = await dq
        if (!diagPage || diagPage.length === 0) break
        diagData.push(...diagPage)
        if (diagPage.length < DIAG_PAGE) break
      }

      // counts map gives true max-insiders-in-any-window per ticker,
      // independent of minInsiders threshold — so one pass suffices.
      const { counts: allCounts } = computeClusters(diagData, 2)
      const t2 = [...allCounts.entries()].filter(([, c]) => c >= 2)
      const t3 = [...allCounts.entries()].filter(([, c]) => c >= 3)
      const t4 = [...allCounts.entries()].filter(([, c]) => c >= 4)
      const top5 = [...allCounts.entries()]
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)

      console.log(`[cluster-diag] rows scanned (no date filter): ${diagData.length}`)
      console.log(`[cluster-diag] all-time 2+ insiders: ${t2.length} tickers`)
      console.log(`[cluster-diag] all-time 3+ insiders: ${t3.length} tickers`)
      console.log(`[cluster-diag] all-time 4+ insiders: ${t4.length} tickers`)
      console.log(`[cluster-diag] top 5 by max cluster: ${top5.map(([t, c]) => `${t}=${c}`).join(' | ')}`)
      // Cross-check: which all-time 4+ tickers are NOT in the windowed discovery
      const windowed4 = new Set(Object.keys(clusterCounts))
      const allTime4  = t4.map(([t]) => t)
      const missing   = allTime4.filter(t => !windowed4.has(t))
      console.log(`[cluster-diag] all-time 4+ tickers absent from ${clusterFrom}–${endDate ?? 'now'} window: ${missing.length > 0 ? missing.join(', ') : 'none (all captured in window)'}`)
      if (windowed4.size === 0 && allTime4.length > 0) {
        console.log(`[cluster-diag] *** clusterFrom window (${clusterFrom}) captures 0 qualifying tickers — widen date range or remove start_date filter ***`)
      }
    }

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
    if (role && role !== 'all') {
      if (role === 'ceo')           q = q.or('officer_title.ilike.%Chief Executive%,officer_title.ilike.%CEO%,role.ilike.%Chief Executive%,role.ilike.%CEO%')
      else if (role === 'cfo')      q = q.or('officer_title.ilike.%Chief Financial%,officer_title.ilike.%CFO%,role.ilike.%Chief Financial%,role.ilike.%CFO%')
      else if (role === 'director') q = q.eq('is_director', true)
      else if (role === '10pct')    q = q.ilike('officer_title', '%10%')
      else if (role === 'other') {
        // Exclude rows matching any senior-role pattern in either column.
        q = q
          .not('officer_title', 'ilike', '%Chief Executive%')
          .not('officer_title', 'ilike', '%CEO%')
          .not('officer_title', 'ilike', '%Chief Financial%')
          .not('officer_title', 'ilike', '%CFO%')
          .not('officer_title', 'ilike', '%Director%')
          .not('officer_title', 'ilike', '%10%')
          .not('role', 'ilike', '%Chief Executive%')
          .not('role', 'ilike', '%CEO%')
          .not('role', 'ilike', '%Chief Financial%')
          .not('role', 'ilike', '%CFO%')
          .not('role', 'ilike', '%Director%')
      }
    }

    // Minimum trade value
    if (minValue !== null) q = q.gte('total_value', minValue)

    // Date range — when cluster mode is active and no explicit startDate, use
    // clusterFrom as the lower bound so the batch query doesn't pull all-time history.
    const effectiveStart = startDate ?? clusterFrom
    if (effectiveStart) q = q.gte('transaction_date', effectiveStart)
    if (endDate)        q = q.lte('transaction_date', endDate)

    return q
  }

  // ── 4a. Batch path — JS filtering needed for holdings formula or cluster trades ─
  if (holdingsMin !== null || clusterMin >= 2) {
    const base = buildBaseQuery(false)
    if (!base) return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })

    // Paginate until all rows are fetched — no hard cap.
    const BATCH_PAGE = 1_000
    const allData: any[] = []
    for (let from = 0; ; from += BATCH_PAGE) {
      const { data: pageRows, error } = await base.range(from, from + BATCH_PAGE - 1)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!pageRows || pageRows.length === 0) break
      allData.push(...pageRows)
      if (pageRows.length < BATCH_PAGE) break
    }

    console.log(`[cluster] batch fetched ${allData.length} rows for tickers: ${[...new Set(allData.map((r: any) => r.ticker))].join(', ')}`)

    let matching: any[] = allData
    if (holdingsMin !== null) {
      matching = matching.filter((row: any) => passesHoldingsFilter(row, holdingsMin))
    }
    if (clusterMin >= 2) {
      let clusterMatchCount = 0
      let clusterMissCount  = 0
      matching = matching.filter((row: any) => {
        const set = clusterTradeMap.get(row.ticker)
        if (!set) { clusterMissCount++; return false }
        const date = (row.transaction_date ?? '').slice(0, 10)
        const id   = row.insider_cik ?? row.insider_name
        const hit  = set.has(`${id}|${date}`)
        if (hit) clusterMatchCount++; else clusterMissCount++
        return hit
      })
      console.log(`[cluster] batch filter: ${clusterMatchCount} matched, ${clusterMissCount} excluded`)
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
