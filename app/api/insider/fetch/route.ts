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
  'filed_date, source_url, conviction_score, classification, holdings_pct_change'

// classification is now a stored column on insider_transactions, written by the cron.
// Rows not yet scored by the cron have classification = null; treat them as UNCLASSIFIABLE
// for display purposes, matching what the cron will write once it processes them.
function attachClassifications(rows: any[]): any[] {
  return rows.map((r: any) => ({
    ...r,
    classification: r.classification ?? 'UNCLASSIFIABLE',
  }))
}

// ── Screener sorting: opt-in ?sort=signal|filed|value|stake&dir=desc|asc ────────
// (sort=score is accepted as an alias for signal.) Some orderings can't be one
// ORDER BY in PostgREST, so a sort is a list of segments: each is a filter plus
// an ordering, concatenated in order. match/cmp mirror filter/order for rows
// already in memory (cluster batch path).
//
// Signal: rank by bucket, then score, so Routine buys never outrank Opportunistic
// ones (see /about): Opportunistic >=50 (Very high), Unclassifiable >=50 (High),
// Opportunistic <50 (Moderate), Unclassifiable <50 (Low), Routine >=50 (Low),
// Routine <50 (No signal). asc reverses the buckets. Unscored rows always last.
// Stake: holdings_pct_change is unsigned, so buys (increases) and sales (cuts)
// are separate segments to get a signed order. Unknown stake always last.
type SortKey = 'signal' | 'filed' | 'value' | 'stake'
type Dir = 'asc' | 'desc'
type Segment = {
  filter: (q: any) => any
  order:  (q: any) => any
  match:  (r: any) => boolean
  cmp:    (a: any, b: any) => number
}

// Orderings below use Postgres' default null placement on purpose: it matches the
// btree indexes (idx_it_filed_txn_date, idx_it_total_value, ...). Forcing
// NULLS LAST on a desc sort defeats the index and full-sorts ~260k rows (timeout).
// Where nulls must sort last, they get their own trailing segment instead.
const ALL = (q: any) => q
const orderFiledDesc = (q: any) =>
  q.order('filed_date', { ascending: false }).order('transaction_date', { ascending: false })
const cmpStr = (a: string | null, b: string | null, asc: boolean) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : (asc ? 1 : -1) * a.localeCompare(b)
const cmpNum = (a: number | null, b: number | null, asc: boolean) =>
  a === b ? 0 : a == null ? 1 : b == null ? -1 : (asc ? 1 : -1) * (Number(a) - Number(b))
const cmpFiledDesc = (a: any, b: any) =>
  cmpStr(a.filed_date, b.filed_date, false) || cmpStr(a.transaction_date, b.transaction_date, false)

const SIGNAL_BUCKETS: { cls: string; high: boolean }[] = [
  { cls: 'OPPORTUNISTIC',  high: true  },
  { cls: 'UNCLASSIFIABLE', high: true  },
  { cls: 'OPPORTUNISTIC',  high: false },
  { cls: 'UNCLASSIFIABLE', high: false },
  { cls: 'ROUTINE',        high: true  },
  { cls: 'ROUTINE',        high: false },
]

function sortSegments(sort: SortKey, dir: Dir): Segment[] {
  const asc = dir === 'asc'
  if (sort === 'signal') {
    const buckets = asc ? [...SIGNAL_BUCKETS].reverse() : SIGNAL_BUCKETS
    return [
      ...buckets.map(({ cls, high }): Segment => ({
        filter: (q) => { const f = q.eq('classification', cls); return high ? f.gte('conviction_score', 50) : f.lt('conviction_score', 50) },
        order:  (q) => orderFiledDesc(q.order('conviction_score', { ascending: asc })),
        match:  (r) => r.classification === cls && r.conviction_score != null && (r.conviction_score >= 50) === high,
        cmp:    (a, b) => cmpNum(a.conviction_score, b.conviction_score, asc) || cmpFiledDesc(a, b),
      })),
      { filter: (q) => q.or('conviction_score.is.null,classification.is.null'), order: orderFiledDesc, match: () => true, cmp: cmpFiledDesc },
    ]
  }
  if (sort === 'filed') {
    return [{
      filter: ALL,
      order:  (q) => q.order('filed_date', { ascending: asc }).order('transaction_date', { ascending: asc }),
      match:  () => true,
      cmp:    (a, b) => cmpStr(a.filed_date, b.filed_date, asc) || cmpStr(a.transaction_date, b.transaction_date, asc),
    }]
  }
  if (sort === 'value') {
    return [
      {
        filter: (q) => q.not('total_value', 'is', null),
        order:  (q) => orderFiledDesc(q.order('total_value', { ascending: asc })),
        match:  (r) => r.total_value != null,
        cmp:    (a, b) => cmpNum(a.total_value, b.total_value, asc) || cmpFiledDesc(a, b),
      },
      { filter: (q) => q.is('total_value', null), order: orderFiledDesc, match: () => true, cmp: cmpFiledDesc },
    ]
  }
  // stake: desc = biggest increase first, biggest cut last; asc = the reverse.
  const side = (code: 'P' | 'S', magAsc: boolean): Segment => ({
    filter: (q) => q.eq('transaction_code', code).not('holdings_pct_change', 'is', null),
    order:  (q) => orderFiledDesc(q.order('holdings_pct_change', { ascending: magAsc })),
    match:  (r) => r.transaction_code?.toUpperCase() === code && r.holdings_pct_change != null,
    cmp:    (a, b) => cmpNum(a.holdings_pct_change, b.holdings_pct_change, magAsc) || cmpFiledDesc(a, b),
  })
  const unknown: Segment = { filter: (q) => q.is('holdings_pct_change', null), order: orderFiledDesc, match: () => true, cmp: cmpFiledDesc }
  return asc ? [side('S', false), side('P', true), unknown] : [side('P', false), side('S', true), unknown]
}

function sortInMemory(rows: any[], segs: Segment[]): any[] {
  const seg = (r: any) => segs.findIndex((s) => s.match(r))
  return rows
    .map((r) => ({ r, i: seg(r) }))
    .sort((a, b) => a.i - b.i || segs[a.i].cmp(a.r, b.r))
    .map((x) => x.r)
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

// Holdings-% filter is now computed in Postgres by the stored generated column
// holdings_pct_change (see migration 20261109_add_holdings_pct_change.sql), applied
// in buildBaseQuery via .gte(). This function is kept only as a reference for the
// formula it replaces: denom = code === 'S' ? after + s : after - s; pct = min(s/denom*100, 999).

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ticker         = searchParams.get('ticker')?.toUpperCase() ?? null
  const tickersParam   = searchParams.get('tickers') ?? ''
  const tickersList    = tickersParam
    ? tickersParam.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
    : []
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
  const minScoreRaw    = searchParams.get('min_score')
  const minScore       = minScoreRaw ? parseInt(minScoreRaw, 10) : null
  const sortRaw        = searchParams.get('sort')
  const sort: SortKey | null =
    sortRaw === 'score' || sortRaw === 'signal' ? 'signal'
    : sortRaw === 'filed' || sortRaw === 'value' || sortRaw === 'stake' ? sortRaw
    : null
  const dir: Dir       = searchParams.get('dir') === 'asc' ? 'asc' : 'desc'
  const withCompany    = (searchParams.get('include') ?? '').split(',').includes('company')
  const limit          = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const page           = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset         = (page - 1) * limit

  const clusterCounts: Record<string, number> = {}

  // Effective lower-date bound for cluster queries — computed once and reused by
  // both the discovery pass and the batch fetch so both cover the same window.
  const clusterFrom: string | null = clusterMin >= 2
    ? (startDate ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    : null

  // ── 1. Classification pre-fetch — replaced by stored column ──────────────────
  // No pre-fetch needed: classification is stored on insider_transactions directly.
  // The filter in buildBaseQuery reads the column with a simple WHERE clause + index.

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

    if (clusteredTickers.length === 0) {
      return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })
    }
  }

  // ── 3. Base query factory (all filters except range/count) ────────────────────
  // Returns null when the ticker+cluster intersection is empty.
  function buildBaseQuery(withCount: boolean, headCount?: 'exact' | 'estimated') {
    let q = supabase
      .from('insider_transactions')
      .select(SELECT_COLS, headCount ? { count: headCount, head: true } : withCount ? { count: 'estimated' } : {})
    // Default: newest filed first. Opt-in screener sorts order per segment instead.
    if (!sort) q = q.order('filed_date', { ascending: false }).order('transaction_date', { ascending: false })
    q = q.lte('transaction_date', '2027-01-01')

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
    } else if (tickersList.length > 0) {
      q = q.in('ticker', tickersList)
    }

    // Classification — direct column filter; no pre-fetch, no CIK list, no pagination issue.
    if (classification === 'OPPORTUNISTIC' || classification === 'ROUTINE') {
      q = q.eq('classification', classification)
    } else if (classification === 'UNCLASSIFIABLE') {
      // Include rows the cron classified as UNCLASSIFIABLE AND rows not yet scored (NULL).
      // Both display as UNCLASSIFIABLE in the feed.
      q = q.or('classification.is.null,classification.eq.UNCLASSIFIABLE')
    }

    // Role
    if (role && role !== 'all') {
      if (role === 'ceo')           q = q.or('officer_title.ilike.%Chief Executive%,officer_title.ilike.%CEO%,role.ilike.%Chief Executive%,role.ilike.%CEO%')
      else if (role === 'cfo')      q = q.or('officer_title.ilike.%Chief Financial%,officer_title.ilike.%CFO%,role.ilike.%Chief Financial%,role.ilike.%CFO%')
      else if (role === 'director') q = q.eq('is_director', true)
      else if (role === '10pct')    q = q.ilike('role', '%10%')
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
          .not('role', 'ilike', '%10%')
      }
    }

    // Holdings % change — computed in Postgres by the generated column, indexed.
    if (holdingsMin !== null) q = q.gte('holdings_pct_change', holdingsMin)

    // Minimum trade value
    if (minValue !== null) q = q.gte('total_value', minValue)

    // Minimum conviction score filter
    if (minScore !== null) q = q.gte('conviction_score', minScore)

    // Date range — only apply bounds explicitly passed by the caller.
    // clusterFrom is intentionally NOT used here; it belongs only to the
    // cluster discovery query above and must not restrict the main data query.
    if (startDate) q = q.gte('transaction_date', startDate)
    if (endDate)   q = q.lte('transaction_date', endDate)

    return q
  }

  // Optional company names for the returned page (screener), one batched lookup.
  async function attachCompanies(rows: any[]): Promise<any[]> {
    if (!withCompany || rows.length === 0) return rows
    const symbols = [...new Set(rows.map((r) => r.ticker as string))]
    const { data, error } = await supabase.from('tickers').select('symbol, name').in('symbol', symbols)
    if (error) { console.error('[insider/fetch] company lookup failed:', error.message); return rows }
    const names = new Map((data ?? []).map((t) => [t.symbol as string, t.name as string | null]))
    return rows.map((r) => ({ ...r, company: names.get(r.ticker) ?? null }))
  }

  // ── 4a. Batch path — JS filtering needed for cluster trade membership ─────────
  // Holdings-% filtering is now applied in SQL inside buildBaseQuery, so it no
  // longer forces this path on its own.
  if (clusterMin >= 2) {
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

    let clusterMatchCount = 0
    let clusterMissCount  = 0
    const matching: any[] = allData.filter((row: any) => {
      const set = clusterTradeMap.get(row.ticker)
      if (!set) { clusterMissCount++; return false }
      const date = (row.transaction_date ?? '').slice(0, 10)
      const id   = row.insider_cik ?? row.insider_name
      const hit  = set.has(`${id}|${date}`)
      if (hit) clusterMatchCount++; else clusterMissCount++
      return hit
    })
    console.log(`[cluster] batch filter: ${clusterMatchCount} matched, ${clusterMissCount} excluded`)

    const ordered  = sort ? sortInMemory(matching, sortSegments(sort, dir)) : matching
    const total    = ordered.length
    const pages    = Math.ceil(total / limit) || 1
    const pageRows = ordered.slice(offset, offset + limit)

    return NextResponse.json({
      rows:  await attachCompanies(attachClassifications(pageRows)),
      total,
      page,
      pages,
      clusterCounts,
    })
  }

  // ── 4b. Screener sort path (opt-in ?sort=...) ─────────────────────────────────
  // Segments are concatenated in order. Two strategies:
  //  • Date-bounded (start_date set): exact count per segment in parallel, then
  //    fetch only the slice(s) that overlap this page. Exact total.
  //  • Unbounded ("All"): exact counts over the full history time out, so read
  //    segments in order until the page is full. A segment's count is only
  //    needed when the page starts beyond it (deep pages). Total is Postgres'
  //    estimate and flagged totalEstimated.
  if (sort) {
    const segs = sortSegments(sort, dir)
    const segQuery = (seg: Segment, head?: 'exact' | 'estimated') => {
      const q = buildBaseQuery(false, head)
      return q ? seg.filter(q) : null
    }
    const segCount = async (seg: Segment): Promise<number> => {
      const q = segQuery(seg, 'exact')
      if (!q) return 0
      const { count, error } = await q
      if (error) throw new Error(error.message || 'count failed (timeout)')
      return count ?? 0
    }
    const segSlice = async (seg: Segment, from: number, n: number): Promise<any[]> => {
      const q = segQuery(seg)
      if (!q) return []
      const { data, error } = await seg.order(q).range(from, from + n - 1)
      if (error) throw new Error(error.message || 'query failed (timeout)')
      return data ?? []
    }

    const t0 = performance.now()
    const rows: any[] = []
    let total: number
    let totalEstimated = false
    try {
      if (startDate) {
        const counts = await Promise.all(segs.map(segCount))
        let skip = offset
        for (let i = 0; i < segs.length && rows.length < limit; i++) {
          if (skip >= counts[i]) { skip -= counts[i]; continue }
          rows.push(...await segSlice(segs[i], skip, Math.min(limit - rows.length, counts[i] - skip)))
          skip = 0
        }
        total = counts.reduce((a, c) => a + c, 0)
      } else {
        const estQ = buildBaseQuery(false, 'estimated')
        const est = estQ ? estQ.then(({ count }: { count: number | null }) => count ?? 0) : Promise.resolve(0)
        let skip = offset
        for (let i = 0; i < segs.length && rows.length < limit; i++) {
          const want = limit - rows.length
          const got = await segSlice(segs[i], skip, want)
          rows.push(...got)
          if (got.length === want) break
          // Segment ended inside this page (got > 0) or before it (got = 0).
          skip = got.length > 0 || skip === 0 ? 0 : Math.max(0, skip - await segCount(segs[i]))
        }
        total = Math.max(await est, offset + rows.length)
        totalEstimated = true
      }
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 })
    }

    console.log(`[insider/fetch] sort=${sort} dir=${dir} ${startDate ? 'exact' : 'lazy'} total=${total} rows=${rows.length} ${(performance.now() - t0).toFixed(0)}ms`)
    return NextResponse.json({
      rows:  await attachCompanies(attachClassifications(rows)),
      total,
      totalEstimated,
      page,
      pages: Math.max(page, Math.ceil(total / limit)),
      clusterCounts,
    })
  }

  // ── 4c. Normal path — single query with server-side pagination ────────────────
  const base = buildBaseQuery(true)
  if (!base) return NextResponse.json({ rows: [], total: 0, page, pages: 0, clusterCounts })

  const t0 = performance.now()
  const { data, count, error } = await base.range(offset, offset + limit - 1)
  const tQuery = performance.now() - t0
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const t1 = performance.now()
  const classified = attachClassifications(data ?? [])
  const tCls = performance.now() - t1

  console.log(
    `[insider/fetch] query=${tQuery.toFixed(0)}ms classify=${tCls.toFixed(0)}ms ` +
    `count=${count} rows=${data?.length ?? 0} ` +
    `filters: direction=${direction} ticker=${ticker ?? 'none'} cls=${classification ?? 'none'} ` +
    `start=${startDate ?? '-'} end=${endDate ?? '-'}`
  )

  return NextResponse.json({
    rows:  await attachCompanies(classified),
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
    clusterCounts,
  })
}
