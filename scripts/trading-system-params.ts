// Run with:  npx tsx scripts/trading-system-params.ts
// Outputs:   output/trading_system_params.csv  +  console parameter spec

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const yf = new YahooFinance()

// ─── Constants ────────────────────────────────────────────────────────────────

const DEEP_CSV     = path.join(__dirname, '..', 'output', 'deep_analysis_v2.csv')
const OUT_CSV      = path.join(__dirname, '..', 'output', 'trading_system_params.csv')
const DELAY_MS     = 300
const HOLD_DAYS    = [30, 60, 90, 120, 150, 180] as const

const SECTOR_ETF: Record<string, string> = {
  'Communication Services': 'XLC',
  'Consumer Cyclical':      'XLY',
  'Financial Services':     'XLF',
  'Industrials':            'XLI',
  'Technology':             'XLK',
  'Healthcare':             'XLV',
  'Real Estate':            'XLRE',
  'Utilities':              'XLU',
  'Energy':                 'XLE',
  'Consumer Defensive':     'XLP',
}

const MARKET_CAP_TIER: Record<string, 'large' | 'mid' | 'small'> = {
  AVGO:'large', PANW:'large', INTC:'large', CVS:'large', CI:'large',
  ABBV:'large', FDX:'large', CAT:'large', FAST:'large', CME:'large',
  UBER:'large', AMAT:'large', TDG:'large', ROP:'large', ITW:'large',
  NKE:'large', KDP:'large', CMI:'large', BKR:'large', ARES:'large',
  CNC:'large', LULU:'large', RSG:'large', DDOG:'large', CRWD:'large',
  WDAY:'large', AXON:'large', SCHW:'large', DG:'large', PNC:'large',
  NEE:'large', DAL:'large', BMY:'large', IDXX:'large', SLB:'large',
  WAB:'large', CTSH:'large', SPG:'large', VRTX:'large', TDY:'large',
  EBAY:'large', RCL:'large', FCX:'large', MRNA:'large', CSGP:'large',
  JBL:'mid', EXR:'mid', FIX:'mid', TKO:'mid', VST:'mid', NTRS:'mid',
  SJM:'mid', ALLE:'mid', GL:'mid', DOC:'mid', COO:'mid', CHD:'mid',
  WY:'mid', FSLR:'mid', CRL:'mid', COHR:'mid', ESS:'mid', KEY:'mid',
  ETR:'mid', LYFT:'mid', MSTR:'mid', TTD:'mid', IONQ:'small',
  PENN:'small', GME:'small',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function addDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function isoDate(d: Date): string { return d.toISOString().split('T')[0] }

function pct(entry: number, exit: number): number {
  return Math.round(((exit - entry) / entry) * 10000) / 100
}

function buildPriceMap(quotes: any[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date != null && q?.close != null)
      map.set(isoDate(new Date(q.date)), q.close)
  }
  return map
}

function lookupFwd(map: Map<string, number>, target: Date): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(target); d.setUTCDate(d.getUTCDate() + i)
    const p = map.get(isoDate(d)); if (p != null) return p
  }
  return null
}

function lookupBack(map: Map<string, number>, target: Date): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(target); d.setUTCDate(d.getUTCDate() - i)
    const p = map.get(isoDate(d)); if (p != null) return p
  }
  return null
}

function parseCsv(content: string): Record<string, string>[] {
  const [headerLine, ...lines] = content.trim().split('\n')
  const headers = headerLine.split(',')
  return lines.filter(Boolean).map(line => {
    const cells: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}

function csvLine(values: (string | number | null)[]): string {
  return values.map(v => {
    if (v == null) return ''
    const s = String(v)
    return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')
}

function fn(s: string | undefined | null): number | null {
  if (!s) return null; const v = parseFloat(s); return isNaN(v) ? null : v
}

function mean(a: number[]): number | null {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null
}

function median(a: number[]): number | null {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function hitRate(a: number[]): number | null {
  return a.length ? a.filter(v => v > 0).length / a.length : null
}

function pearsonCorr(xs: number[], ys: number[]): number | null {
  if (xs.length < 5 || xs.length !== ys.length) return null
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  return denom < 1e-10 ? null : num / denom
}

function conf(n: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUF' {
  return n >= 20 ? 'HIGH' : n >= 10 ? 'MEDIUM' : n >= 5 ? 'LOW' : 'INSUF'
}

const fp = (n: number | null, d = 1) =>
  n == null ? 'N/A' : (n >= 0 ? '+' : '') + n.toFixed(d) + '%'
const fh = (n: number | null) =>
  n == null ? 'N/A' : (n * 100).toFixed(0) + '%'
const SEP  = '═'.repeat(90)
const DASH = '─'.repeat(90)

// ─── Types ────────────────────────────────────────────────────────────────────

type Trade = {
  ticker: string; insider_name: string; insider_cik: string
  officer_title: string; role: string; transaction_date: string
  transaction_code: string; shares: number | null
  price_per_share: number | null; total_value: number | null
  sector: string; role_classified: string
  price_entry: number | null
  price_30d: number | null; price_60d: number | null; price_90d: number | null
  price_120d: number | null; price_150d: number | null; price_180d: number | null
  ret30: number | null; ret60: number | null; ret90: number | null
  ret120: number | null; ret150: number | null; ret180: number | null
  a30: number | null; a60: number | null; a90: number | null
  a120: number | null; a150: number | null; a180: number | null
  spy90: number | null; spy150: number | null
  dd30: number | null; daysToMin: number | null
  recovered90: boolean | null
  // enriched below
  spy_pre30: number | null
  etf_pre30: number | null
  btc90: number | null
  cluster_count: number
  cluster_value: number
  conv_ratio: number | null
  is_local: boolean | null
  mktcap_tier: 'large' | 'mid' | 'small' | 'unknown'
}

type OutRow = {
  dim_id: string; dimension: string; filter_label: string; n: number
  hit_90d: string; alpha_90d_med: string; hit_150d: string; alpha_150d_med: string
  confidence: string; note: string
}

// ─── Stats group ──────────────────────────────────────────────────────────────

function grpStats(trades: Trade[]) {
  const a90  = trades.map(t => t.a90).filter((v): v is number => v != null)
  const a150 = trades.map(t => t.a150).filter((v): v is number => v != null)
  return { n: trades.length, a90, a150 }
}

function outRow(
  dimId: string, dim: string, label: string,
  trades: Trade[], note = ''
): OutRow {
  const { a90, a150 } = grpStats(trades)
  return {
    dim_id: dimId, dimension: dim, filter_label: label, n: trades.length,
    hit_90d:       fh(hitRate(a90)),
    alpha_90d_med: fp(median(a90)),
    hit_150d:      fh(hitRate(a150)),
    alpha_150d_med: fp(median(a150)),
    confidence: conf(a90.length),
    note,
  }
}

// ─── External data helpers ────────────────────────────────────────────────────

async function fetchMap(symbol: string, from: Date, to: Date): Promise<Map<string, number>> {
  await sleep(DELAY_MS)
  try {
    const chart: any = await yf.chart(symbol, { period1: from, period2: to, interval: '1d' })
    return buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
  } catch (e: any) {
    console.warn(`  ⚠ ${symbol}: ${e.message}`)
    return new Map()
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

  // ── 1. Load CSV ─────────────────────────────────────────────────────────────

  if (!fs.existsSync(DEEP_CSV)) { console.error(`Missing: ${DEEP_CSV}`); process.exit(1) }
  const raw = parseCsv(fs.readFileSync(DEEP_CSV, 'utf-8'))
  console.log(`Loaded ${raw.length} trades from deep_analysis_v2.csv`)

  // ── 2. Parse into Trade objects ─────────────────────────────────────────────

  const trades: Trade[] = raw.map(r => ({
    ticker:          r['ticker'] ?? '',
    insider_name:    r['insider_name'] ?? '',
    insider_cik:     r['insider_cik'] ?? '',
    officer_title:   r['officer_title'] ?? '',
    role:            r['role'] ?? '',
    transaction_date: r['transaction_date'] ?? '',
    transaction_code: r['transaction_code'] ?? '',
    shares:          fn(r['shares']),
    price_per_share: fn(r['price_per_share']),
    total_value:     fn(r['total_value']),
    sector:          r['sector'] || 'Unknown',
    role_classified: r['role_classified'] || 'Unknown',
    price_entry:     fn(r['price_entry']),
    price_30d:       fn(r['price_30d']),  price_60d:  fn(r['price_60d']),
    price_90d:       fn(r['price_90d']),  price_120d: fn(r['price_120d']),
    price_150d:      fn(r['price_150d']), price_180d: fn(r['price_180d']),
    ret30:  fn(r['return_30d']),  ret60:  fn(r['return_60d']),
    ret90:  fn(r['return_90d']),  ret120: fn(r['return_120d']),
    ret150: fn(r['return_150d']), ret180: fn(r['return_180d']),
    a30:   fn(r['adjusted_return_30d']),  a60:  fn(r['adjusted_return_60d']),
    a90:   fn(r['adjusted_return_90d']),  a120: fn(r['adjusted_return_120d']),
    a150:  fn(r['adjusted_return_150d']), a180: fn(r['adjusted_return_180d']),
    spy90:  fn(r['spy_return_90d']),  spy150: fn(r['spy_return_150d']),
    dd30:        fn(r['max_drawdown_30d']),
    daysToMin:   fn(r['days_to_min_30d']),
    recovered90: r['recovered_by_90d']?.toLowerCase() === 'true' ? true :
                 r['recovered_by_90d']?.toLowerCase() === 'false' ? false : null,
    spy_pre30: null, etf_pre30: null, btc90: null,
    cluster_count: 1, cluster_value: 0, conv_ratio: null,
    is_local: null,
    mktcap_tier: (MARKET_CAP_TIER[r['ticker'] ?? ''] ?? 'unknown') as any,
  }))

  // Validate sectors are real strings
  const validSectors = new Set([
    'Communication Services','Consumer Cyclical','Financial Services','Industrials',
    'Technology','Healthcare','Real Estate','Utilities','Energy','Consumer Defensive',
    'Basic Materials', 'Unknown',
  ])
  for (const t of trades) {
    if (!validSectors.has(t.sector)) t.sector = 'Unknown'
  }

  // ── 3. Supabase: is_local ────────────────────────────────────────────────────

  const localMap = new Map<string, boolean>()
  try {
    const { data, error } = await supabase
      .from('insider_transactions')
      .select('id, is_local')
      .not('is_local', 'is', null)
      .limit(1000)
    if (!error && data?.length) {
      for (const row of data as any[])
        if (row.id && row.is_local != null) localMap.set(row.id, row.is_local)
      console.log(`is_local data: ${localMap.size} rows`)
    }
  } catch { /* no is_local column — skip silently */ }

  // ── 4. Fetch extended SPY (pre-trade 30d lookback from 2015-01-01) ──────────

  const allDates = trades.map(t => t.transaction_date).filter(Boolean).sort()
  const rangeStart = new Date('2015-01-01')
  const rangeEnd   = addDays(allDates[allDates.length - 1], 10)

  console.log('\nFetching SPY (extended range)...')
  const spyMap = await fetchMap('SPY', rangeStart, rangeEnd)
  console.log(`  ${spyMap.size} SPY price points`)

  // ── 5. Fetch sector ETFs ─────────────────────────────────────────────────────

  const etfMaps = new Map<string, Map<string, number>>()
  const etfSymbols = Array.from(new Set(Object.values(SECTOR_ETF)))
  console.log(`Fetching ${etfSymbols.length} sector ETFs...`)
  for (const sym of etfSymbols) {
    const m = await fetchMap(sym, rangeStart, rangeEnd)
    etfMaps.set(sym, m)
    process.stdout.write('.')
  }
  console.log()

  // ── 6. Fetch BTC-USD ─────────────────────────────────────────────────────────

  console.log('Fetching BTC-USD...')
  const btcMap = await fetchMap('BTC-USD', rangeStart, rangeEnd)
  console.log(`  ${btcMap.size} BTC price points`)

  // ── 7. Enrich trades with external data ─────────────────────────────────────

  for (const t of trades) {
    const txDate  = t.transaction_date
    const pre30   = addDays(txDate, -30)
    const fwd90   = addDays(txDate, 90)

    // SPY pre-trade 30d return (from 30d ago to trade date)
    const spyNow  = lookupBack(spyMap, new Date(txDate))
    const spyAgo  = lookupBack(spyMap, pre30)
    t.spy_pre30   = (spyNow && spyAgo) ? pct(spyAgo, spyNow) : null

    // Sector ETF pre-trade 30d return
    const etfSym  = SECTOR_ETF[t.sector]
    if (etfSym) {
      const etfMap = etfMaps.get(etfSym)
      if (etfMap) {
        const etfNow = lookupBack(etfMap, new Date(txDate))
        const etfAgo = lookupBack(etfMap, pre30)
        t.etf_pre30  = (etfNow && etfAgo) ? pct(etfAgo, etfNow) : null
      }
    }

    // BTC 90d return from trade date
    const btcEntry = lookupFwd(btcMap, new Date(txDate))
    const btcExit  = lookupFwd(btcMap, fwd90)
    t.btc90        = (btcEntry && btcExit) ? pct(btcEntry, btcExit) : null

    // is_local from Supabase map
    // (id is in the CSV but not easily accessible here — skip for this pass)
  }

  // ── 8. Pre-compute cluster data ──────────────────────────────────────────────

  // Group by ticker+YYYY-MM
  const clusterMap = new Map<string, Trade[]>()
  for (const t of trades) {
    const key = t.ticker + '_' + t.transaction_date.slice(0, 7)
    const arr = clusterMap.get(key) ?? []
    arr.push(t)
    clusterMap.set(key, arr)
  }
  for (const t of trades) {
    const key  = t.ticker + '_' + t.transaction_date.slice(0, 7)
    const grp  = clusterMap.get(key) ?? []
    t.cluster_count = grp.length
    t.cluster_value = grp.reduce((s, g) => s + (g.total_value ?? 0), 0)
  }

  // ── 9. Pre-compute conviction ratios ─────────────────────────────────────────

  const insiderMedians = new Map<string, number>()
  const byInsider = new Map<string, Trade[]>()
  for (const t of trades) {
    const arr = byInsider.get(t.insider_name) ?? []
    arr.push(t); byInsider.set(t.insider_name, arr)
  }
  for (const [name, ts] of Array.from(byInsider.entries())) {
    const vals = ts.map(t => t.total_value).filter((v): v is number => v != null)
    const med  = median(vals)
    if (med != null) insiderMedians.set(name, med)
  }
  for (const t of trades) {
    const med = insiderMedians.get(t.insider_name)
    t.conv_ratio = (med && t.total_value) ? t.total_value / med : null
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ANALYSES
  // ─────────────────────────────────────────────────────────────────────────────

  const rows: OutRow[] = []

  // ── DIM 1: Dollar size optimization ─────────────────────────────────────────

  {
    // Lower bound sweep: which minimum produces best alpha with n>=10
    const lowers = [100_000, 250_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000, 5_000_000]
    const uppers = [250_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 5_000_000, 10_000_000, 50_000_000]

    // Classic fixed buckets
    const buckets = [
      ['$100K–250K',  (v:number) => v >= 100_000  && v < 250_000],
      ['$250K–500K',  (v:number) => v >= 250_000  && v < 500_000],
      ['$500K–1M',    (v:number) => v >= 500_000  && v < 1_000_000],
      ['$1M–5M',      (v:number) => v >= 1_000_000 && v < 5_000_000],
      ['$5M–25M',     (v:number) => v >= 5_000_000 && v < 25_000_000],
      ['$25M+',       (v:number) => v >= 25_000_000],
    ] as [string, (v:number)=>boolean][]

    for (const [label, fn2] of buckets) {
      const sub = trades.filter(t => t.total_value != null && fn2(t.total_value))
      rows.push(outRow('1', 'Dollar Size Optimization', label, sub))
    }

    // Lower bound sweep — find best
    let bestLower = 0, bestAlpha = -99
    for (const lo of lowers) {
      const sub = trades.filter(t => t.total_value != null && t.total_value >= lo)
      const a   = sub.map(t => t.a90).filter((v): v is number => v != null)
      if (a.length >= 10 && (median(a) ?? -99) > bestAlpha) {
        bestAlpha = median(a)!; bestLower = lo
      }
    }
    const bestSub = trades.filter(t => t.total_value != null && t.total_value >= bestLower)
    rows.push(outRow('1x', 'Dollar Size Optimization',
      `Best lower bound: >= $${(bestLower/1000).toFixed(0)}K`, bestSub,
      `Optimal lower bound by 90d median alpha (n>=${bestSub.length})`))

    // Range test — best (lo, hi) pair
    let bestRange = '', bestRangeAlpha = -99, bestRangeSub: Trade[] = []
    for (const lo of lowers) {
      for (const hi of uppers.filter(h => h > lo)) {
        const sub = trades.filter(t => t.total_value != null && t.total_value >= lo && t.total_value < hi)
        const a   = sub.map(t => t.a90).filter((v): v is number => v != null)
        if (a.length >= 10 && (median(a) ?? -99) > bestRangeAlpha) {
          bestRangeAlpha = median(a)!
          bestRange = `$${(lo/1000).toFixed(0)}K–$${(hi/1000).toFixed(0)}K`
          bestRangeSub = sub
        }
      }
    }
    if (bestRangeSub.length)
      rows.push(outRow('1y', 'Dollar Size Optimization', `Best range: ${bestRange}`, bestRangeSub, 'Grid search optimum'))
  }

  // ── DIM 2: Role ranking ──────────────────────────────────────────────────────

  {
    const roleOrder = ['CEO','CFO','President','Director','10% Owner','Co-Founder/Partner','Insider (other)','Other/EVP']
    for (const role of roleOrder) {
      const sub = trades.filter(t => t.role_classified === role)
      if (sub.length >= 5) rows.push(outRow('2', 'Role Ranking', role, sub))
    }
  }

  // ── DIM 3: Sector ranking ────────────────────────────────────────────────────

  {
    const bySector = new Map<string, Trade[]>()
    for (const t of trades) { const a = bySector.get(t.sector) ?? []; a.push(t); bySector.set(t.sector, a) }
    const sectorResults = Array.from(bySector.entries())
      .filter(([, g]) => g.length >= 4)
      .map(([s, g]) => {
        const a150 = g.map(t => t.a150).filter((v): v is number => v != null)
        return { sector: s, med150: median(a150) ?? -99, trades: g }
      })
      .sort((a, b) => b.med150 - a.med150)

    for (const { sector, trades: sub } of sectorResults) {
      const a150 = sub.map(t => t.a150).filter((v): v is number => v != null)
      const rec  = (median(a150) ?? 0) > 2 ? 'INCLUDE' : (median(a150) ?? 0) < -2 ? 'EXCLUDE' : 'NEUTRAL'
      rows.push(outRow('3', 'Sector Ranking', sector, sub, rec))
    }
  }

  // ── DIM 4: Cluster effect (count) ────────────────────────────────────────────

  {
    for (const cnt of [1, 2, 3, 4] as const) {
      const label = cnt === 4 ? '4+ insiders same month' : `${cnt} insider${cnt>1?'s':''} same month`
      const sub   = cnt < 4
        ? trades.filter(t => t.cluster_count === cnt)
        : trades.filter(t => t.cluster_count >= 4)
      if (sub.length >= 3) rows.push(outRow('4', 'Cluster Effect (count)', label, sub))
    }
  }

  // ── DIM 5: Local insider effect ──────────────────────────────────────────────

  {
    const local    = trades.filter(t => t.is_local === true)
    const nonLocal = trades.filter(t => t.is_local === false)
    if (local.length >= 5 && nonLocal.length >= 5) {
      rows.push(outRow('5', 'Local Insider Effect', 'is_local = true', local))
      rows.push(outRow('5', 'Local Insider Effect', 'is_local = false', nonLocal))
    } else {
      rows.push({ dim_id:'5', dimension:'Local Insider Effect', filter_label:'N/A',
        n:0, hit_90d:'N/A', alpha_90d_med:'N/A', hit_150d:'N/A', alpha_150d_med:'N/A',
        confidence:'INSUF', note:'is_local not available in current dataset — requires address enrichment' })
    }
  }

  // ── DIM 6: Plan sale exclusion validation ────────────────────────────────────

  {
    // All trades in dataset are already pre-filtered as "opportunistic buys".
    // transaction_code='P' = open market purchase. No 10b5-1 plan flag in current schema.
    const codes = new Map<string, Trade[]>()
    for (const t of trades) {
      const c = t.transaction_code.trim().slice(0, 1) || 'P'
      const a = codes.get(c) ?? []; a.push(t); codes.set(c, a)
    }
    for (const [code, sub] of Array.from(codes.entries()))
      rows.push(outRow('6', 'Plan Sale Exclusion', `transaction_code = ${code}`, sub,
        'Dataset pre-filtered for opportunistic buys; all codes are open-market purchases'))
  }

  // ── DIM 7: Insider track record ──────────────────────────────────────────────

  {
    const insiders = Array.from(byInsider.entries()).filter(([, g]) => g.length >= 5)

    // Classify each insider into track record tier
    const highTrack: Trade[] = [], lowTrack: Trade[] = []
    for (const [, ts] of insiders) {
      const a90s = ts.map(t => t.a90).filter((v): v is number => v != null)
      const hit  = hitRate(a90s) ?? 0
      const med  = median(a90s) ?? 0
      if (hit >= 0.65 && med >= 5)  highTrack.push(...ts)
      else                           lowTrack.push(...ts)
    }
    rows.push(outRow('7', 'Insider Track Record', 'Hit>=65% & alpha>=5% (high)', highTrack, 'Position size multiplier candidate'))
    rows.push(outRow('7', 'Insider Track Record', 'Below threshold (low)',       lowTrack))

    // Top 5 insiders by median alpha (for position sizing reference)
    const ranked = insiders
      .map(([n, ts]) => {
        const a90s = ts.map(t => t.a90).filter((v): v is number => v != null)
        return { name: n, n: ts.length, med90: median(a90s) ?? -99, hit: hitRate(a90s) ?? 0 }
      })
      .sort((a, b) => b.med90 - a.med90)
      .slice(0, 8)

    for (const r of ranked) {
      const sub = byInsider.get(r.name) ?? []
      rows.push(outRow('7t', 'Insider Track Record (top)', r.name.slice(0, 30), sub))
    }
  }

  // ── DIM 8: Company track record ──────────────────────────────────────────────

  {
    const byTicker = new Map<string, Trade[]>()
    for (const t of trades) { const a = byTicker.get(t.ticker) ?? []; a.push(t); byTicker.set(t.ticker, a) }

    const highTrack: Trade[] = [], lowTrack: Trade[] = []
    for (const [, ts] of Array.from(byTicker.entries()).filter(([, g]) => g.length >= 5)) {
      const a90s = ts.map(t => t.a90).filter((v): v is number => v != null)
      const hit  = hitRate(a90s) ?? 0
      const med  = median(a90s) ?? 0
      if (hit >= 0.65 && med >= 5)  highTrack.push(...ts)
      else                           lowTrack.push(...ts)
    }
    rows.push(outRow('8', 'Company Track Record', 'Hit>=65% & alpha>=5% (high)', highTrack, 'Position size multiplier candidate'))
    rows.push(outRow('8', 'Company Track Record', 'Below threshold',             lowTrack))
  }

  // ── DIM 9: Dollar size as conviction proxy ────────────────────────────────────

  {
    const convBuckets: [string, (r: number) => boolean][] = [
      ['0.5x or less (below avg)',  r => r <= 0.5],
      ['0.5x–1x  (near median)',    r => r > 0.5  && r <= 1.0],
      ['1x–2x    (above median)',   r => r > 1.0  && r <= 2.0],
      ['2x–5x    (large vs usual)', r => r > 2.0  && r <= 5.0],
      ['>5x      (exceptional)',    r => r > 5.0],
    ]
    for (const [label, fn2] of convBuckets) {
      const sub = trades.filter(t => t.conv_ratio != null && fn2(t.conv_ratio))
      if (sub.length >= 5) rows.push(outRow('9', 'Conviction Proxy (size vs median)', label, sub))
    }
  }

  // ── DIM 10: Cluster dollar total ─────────────────────────────────────────────

  {
    const cdBuckets: [string, (v: number) => boolean][] = [
      ['< $500K cluster total',     v => v < 500_000],
      ['$500K–1M cluster total',    v => v >= 500_000  && v < 1_000_000],
      ['$1M–5M  cluster total',     v => v >= 1_000_000 && v < 5_000_000],
      ['$5M–25M cluster total',     v => v >= 5_000_000 && v < 25_000_000],
      ['$25M+   cluster total',     v => v >= 25_000_000],
    ]
    for (const [label, fn2] of cdBuckets) {
      const sub = trades.filter(t => fn2(t.cluster_value))
      if (sub.length >= 5) rows.push(outRow('10', 'Cluster Dollar Total', label, sub))
    }
  }

  // ── DIM 11: Optimal hold period by role ──────────────────────────────────────

  {
    const roles = ['CEO', 'Director', '10% Owner', 'Other/EVP', 'CFO']
    const alphaKeys: (keyof Trade)[] = ['a30','a60','a90','a120','a150','a180']
    for (const role of roles) {
      const sub = trades.filter(t => t.role_classified === role)
      if (sub.length < 5) continue
      let bestDay = 90, bestMed = -99
      for (const [day, key] of HOLD_DAYS.map((d,i) => [d, alphaKeys[i]] as [number, keyof Trade])) {
        const a = sub.map(t => t[key] as number | null).filter((v): v is number => v != null)
        const m = median(a) ?? -99
        if (m > bestMed) { bestMed = m; bestDay = day }
      }
      // emit a row for each interval
      for (const [day, key] of HOLD_DAYS.map((d,i) => [d, alphaKeys[i]] as [number, keyof Trade])) {
        const a = sub.map(t => t[key] as number | null).filter((v): v is number => v != null)
        const a150arr = sub.map(t => t.a150).filter((v): v is number => v != null)
        rows.push({
          dim_id: '11', dimension: 'Hold Period by Role',
          filter_label: `${role} @ ${day}d`,
          n: a.length,
          hit_90d:       fh(hitRate(a)),
          alpha_90d_med: fp(median(a)),
          hit_150d:      fh(hitRate(a150arr)),
          alpha_150d_med: fp(median(a150arr)),
          confidence: conf(a.length),
          note: day === bestDay ? `<< PEAK for ${role}` : '',
        })
      }
    }
  }

  // ── DIM 12: Optimal hold period by sector ────────────────────────────────────

  {
    const topSectors = ['Communication Services','Financial Services','Technology','Consumer Cyclical','Industrials','Healthcare']
    const alphaKeys: (keyof Trade)[] = ['a30','a60','a90','a120','a150','a180']
    for (const sector of topSectors) {
      const sub = trades.filter(t => t.sector === sector)
      if (sub.length < 5) continue
      let bestDay = 90, bestMed = -99
      for (const [day, key] of HOLD_DAYS.map((d,i) => [d, alphaKeys[i]] as [number, keyof Trade])) {
        const a = sub.map(t => t[key] as number | null).filter((v): v is number => v != null)
        const m = median(a) ?? -99
        if (m > bestMed) { bestMed = m; bestDay = day }
      }
      for (const [day, key] of HOLD_DAYS.map((d,i) => [d, alphaKeys[i]] as [number, keyof Trade])) {
        const a = sub.map(t => t[key] as number | null).filter((v): v is number => v != null)
        const a150arr = sub.map(t => t.a150).filter((v): v is number => v != null)
        rows.push({
          dim_id: '12', dimension: 'Hold Period by Sector',
          filter_label: `${sector} @ ${day}d`,
          n: a.length,
          hit_90d:       fh(hitRate(a)),
          alpha_90d_med: fp(median(a)),
          hit_150d:      fh(hitRate(a150arr)),
          alpha_150d_med: fp(median(a150arr)),
          confidence: conf(a.length),
          note: day === bestDay ? `<< PEAK for ${sector}` : '',
        })
      }
    }
  }

  // ── DIM 13: Early dip exit vs hold ───────────────────────────────────────────

  {
    // Trades with >10% early dip — exit vs hold
    const deepDip = trades.filter(t => t.dd30 != null && t.dd30 < -10)
    const noDip   = trades.filter(t => t.dd30 != null && t.dd30 >= -3)
    const mid     = trades.filter(t => t.dd30 != null && t.dd30 < -3 && t.dd30 >= -10)

    rows.push(outRow('13', 'Early Dip Rule', 'No dip (0–3%)', noDip,
      `Recovery@90d: ${fh(deepDip.length ? hitRate([...deepDip.map(t=>t.recovered90?1:-1).filter(v=>v!=null) as number[]]) : null)}`))
    rows.push(outRow('13', 'Early Dip Rule', 'Mid dip (3–10%)', mid))
    rows.push(outRow('13', 'Early Dip Rule', 'Deep dip (>10%) — HOLD',  deepDip,
      `Recovery@90d: ${fh(hitRate((deepDip.map(t => t.recovered90===true?1:t.recovered90===false?-1:null).filter(v=>v!=null) as number[])))} — compare to exit below`))

    // Simulate exit at deep dip: return ≈ max_drawdown_30d
    const deepDipSimExit = deepDip.filter(t => t.dd30 != null && t.spy90 != null)
    if (deepDipSimExit.length >= 3) {
      const simAlphas = deepDipSimExit.map(t => t.dd30! - (t.spy90! / 3)) // rough SPY alpha at dip point
      rows.push({
        dim_id: '13', dimension: 'Early Dip Rule', filter_label: 'Deep dip (>10%) — EXIT at dip',
        n: deepDipSimExit.length,
        hit_90d:       fh(hitRate(simAlphas)),
        alpha_90d_med: fp(median(simAlphas)),
        hit_150d:      'N/A', alpha_150d_med: 'N/A',
        confidence: conf(deepDipSimExit.length),
        note: 'Simulated exit at max drawdown: dd30 is approx exit alpha. Compare vs HOLD row above.',
      })
    }
  }

  // ── DIM 14: Take profit analysis ─────────────────────────────────────────────

  {
    const hasData = trades.filter(t =>
      t.price_entry != null && t.ret150 != null && t.a150 != null)

    for (const tpct of [15, 20, 25, 30]) {
      const simRets: number[] = []
      const simAlphas: number[] = []

      for (const t of hasData) {
        const e = t.price_entry!
        const threshold = tpct / 100

        // Check if any interval crossed the threshold
        const priceAtInterval: Array<{price: number | null, spyRet: number | null}> = [
          { price: t.price_30d,  spyRet: fn(trades[0]?.['spy_return_30d' as keyof Trade] as any) },
          { price: t.price_60d,  spyRet: null },
          { price: t.price_90d,  spyRet: t.spy90 },
          { price: t.price_120d, spyRet: null },
          { price: t.price_150d, spyRet: t.spy150 },
          { price: t.price_180d, spyRet: null },
        ]

        let tpHit = false
        for (const { price } of priceAtInterval) {
          if (price != null && (price - e) / e >= threshold) { tpHit = true; break }
        }

        const simRet = tpHit ? tpct : t.ret150!
        simRets.push(simRet)
        // Approximate alpha: if TP hit, use TP% - spy150; else use a150
        simAlphas.push(tpHit ? tpct - (t.spy150 ?? 0) : t.a150!)
      }

      const holdAlphas = hasData.map(t => t.a150).filter((v): v is number => v != null)
      rows.push({
        dim_id: '14', dimension: 'Take Profit Analysis',
        filter_label: `Exit at +${tpct}% if hit, else hold 150d`,
        n: simAlphas.length,
        hit_90d:       fh(hitRate(simAlphas)),
        alpha_90d_med: fp(median(simAlphas)),
        hit_150d:      fh(hitRate(holdAlphas)),
        alpha_150d_med: fp(median(holdAlphas)),
        confidence: conf(simAlphas.length),
        note: `TP hit rate: ${(simAlphas.filter((_, i) => simRets[i] === tpct).length / simAlphas.length * 100).toFixed(0)}%  |  Hold 150d median alpha: ${fp(median(holdAlphas))}`,
      })
    }
  }

  // ── DIM 15: News event / volatility proxy ─────────────────────────────────────

  {
    // Use |return_30d| as first-30d volatility/news proxy
    const noEvent  = trades.filter(t => t.ret30 != null && Math.abs(t.ret30) < 5)
    const moderate = trades.filter(t => t.ret30 != null && Math.abs(t.ret30) >= 5 && Math.abs(t.ret30) < 15)
    const highEvent = trades.filter(t => t.ret30 != null && Math.abs(t.ret30) >= 15)
    rows.push(outRow('15', 'News/Volatility Proxy', '|ret30| < 5% (low vol)',  noEvent,  'Quiet first 30 days'))
    rows.push(outRow('15', 'News/Volatility Proxy', '|ret30| 5-15% (moderate)', moderate))
    rows.push(outRow('15', 'News/Volatility Proxy', '|ret30| >= 15% (high vol)', highEvent, 'Major move in first 30d'))
  }

  // ── DIM 16: SPY pre-trade 30d momentum ───────────────────────────────────────

  {
    const hasSpy = trades.filter(t => t.spy_pre30 != null)
    const spyBuckets: [string, (v:number)=>boolean, string][] = [
      ['SPY pre30 < -10% (crash)',    v => v < -10,          'Strong contrarian'],
      ['SPY pre30 -10% to -5%',       v => v >= -10 && v < -5, 'Mild weakness'],
      ['SPY pre30 -5% to 0%',         v => v >= -5  && v < 0,  'Slight dip'],
      ['SPY pre30 0% to +5%',         v => v >= 0   && v < 5,  'Flat/mild up'],
      ['SPY pre30 +5% to +10%',       v => v >= 5   && v < 10, 'Rising'],
      ['SPY pre30 > +10%',            v => v >= 10,            'Strong up'],
    ]
    for (const [label, fn2, note] of spyBuckets) {
      const sub = hasSpy.filter(t => fn2(t.spy_pre30!))
      if (sub.length >= 5) rows.push(outRow('16', 'SPY Pre-Trade 30d Momentum', label, sub, note))
    }
  }

  // ── DIM 17: Sector ETF pre-trade momentum ────────────────────────────────────

  {
    const hasEtf = trades.filter(t => t.etf_pre30 != null)
    const etfBuckets: [string, (v:number)=>boolean, string][] = [
      ['ETF pre30 < -5% (contrarian)',  v => v < -5,             'Sector under pressure — best contrarian setup?'],
      ['ETF pre30 -5% to 0%',           v => v >= -5  && v < 0,  'Slight sector weakness'],
      ['ETF pre30 0% to +5%',           v => v >= 0   && v < 5,  'Sector flat'],
      ['ETF pre30 > +5% (momentum)',    v => v >= 5,             'Sector in momentum — riding wave?'],
    ]
    for (const [label, fn2, note] of etfBuckets) {
      const sub = hasEtf.filter(t => fn2(t.etf_pre30!))
      if (sub.length >= 5) rows.push(outRow('17', 'Sector ETF Pre-Trade Momentum', label, sub, note))
    }
  }

  // ── DIM 18: Volatility filter (drawdown as proxy) ────────────────────────────

  {
    const hasDD = trades.filter(t => t.dd30 != null)
    const volBuckets: [string, (v:number)=>boolean][] = [
      ['Low vol   |dd30| < 3%',    v => Math.abs(v) < 3],
      ['Medium vol |dd30| 3-7%',   v => Math.abs(v) >= 3  && Math.abs(v) < 7],
      ['High vol  |dd30| 7-15%',   v => Math.abs(v) >= 7  && Math.abs(v) < 15],
      ['Very high |dd30| > 15%',   v => Math.abs(v) >= 15],
    ]
    for (const [label, fn2] of volBuckets) {
      const sub = hasDD.filter(t => fn2(t.dd30!))
      if (sub.length >= 5) rows.push(outRow('18', 'Volatility Filter (dd30 proxy)', label, sub))
    }
  }

  // ── DIM 19: Market cap effect ─────────────────────────────────────────────────

  {
    const tiers = ['large', 'mid', 'small'] as const
    for (const tier of tiers) {
      const sub = trades.filter(t => t.mktcap_tier === tier)
      if (sub.length >= 5) rows.push(outRow('19', 'Market Cap Effect', tier + ' cap', sub))
    }
  }

  // ── DIM 20: Auto exclusion list ──────────────────────────────────────────────

  {
    const byTicker2  = new Map<string, Trade[]>()
    const byInsider2 = new Map<string, Trade[]>()
    for (const t of trades) {
      const a = byTicker2.get(t.ticker) ?? [];  a.push(t); byTicker2.set(t.ticker, a)
      const b = byInsider2.get(t.insider_name) ?? []; b.push(t); byInsider2.set(t.insider_name, b)
    }
    const excludeTickers:  string[] = []
    const excludeInsiders: string[] = []

    for (const [ticker, ts] of Array.from(byTicker2.entries()).filter(([,g])=>g.length>=5)) {
      const a90s = ts.map(t=>t.a90).filter((v):v is number=>v!=null)
      const hit  = hitRate(a90s) ?? 1
      const med  = median(a90s) ?? 0
      if (hit < 0.40 || med < 0) {
        excludeTickers.push(ticker)
        rows.push(outRow('20', 'Auto Exclusion', `TICKER: ${ticker}`, ts, `hit=${fh(hitRate(a90s))} med90=${fp(median(a90s))} — EXCLUDE`))
      }
    }
    for (const [name, ts] of Array.from(byInsider2.entries()).filter(([,g])=>g.length>=5)) {
      const a90s = ts.map(t=>t.a90).filter((v):v is number=>v!=null)
      const hit  = hitRate(a90s) ?? 1
      const med  = median(a90s) ?? 0
      if (hit < 0.40 || med < 0) {
        excludeInsiders.push(name)
        rows.push(outRow('20', 'Auto Exclusion', `INSIDER: ${name.slice(0,25)}`, ts, `hit=${fh(hitRate(a90s))} med90=${fp(median(a90s))} — EXCLUDE`))
      }
    }
    if (!excludeTickers.length && !excludeInsiders.length)
      rows.push({ dim_id:'20', dimension:'Auto Exclusion', filter_label:'(none flagged)', n:0,
        hit_90d:'N/A', alpha_90d_med:'N/A', hit_150d:'N/A', alpha_150d_med:'N/A',
        confidence:'HIGH', note:'No insiders/tickers meet negative-alpha exclusion criteria (5+ trades, hit<40% or alpha<0)' })
  }

  // ── DIM 21: BTC-correlated names ─────────────────────────────────────────────

  {
    const byTicker3 = new Map<string, Trade[]>()
    for (const t of trades) { const a = byTicker3.get(t.ticker)??[]; a.push(t); byTicker3.set(t.ticker, a) }

    const btcFlags: string[] = []
    for (const [ticker, ts] of Array.from(byTicker3.entries()).filter(([,g])=>g.length>=5)) {
      const pairs = ts.filter(t => t.btc90 != null && t.a90 != null)
      if (pairs.length < 5) continue
      const btcCorr = pearsonCorr(pairs.map(t=>t.btc90!), pairs.map(t=>t.ret90!))
      const spyCorr = pearsonCorr(pairs.map(t=>t.spy90!), pairs.map(t=>t.ret90!))
      if (btcCorr != null && Math.abs(btcCorr) > 0.5 && Math.abs(btcCorr) > Math.abs(spyCorr ?? 0)) {
        btcFlags.push(ticker)
        rows.push(outRow('21', 'BTC Correlation', `${ticker} (btcCorr=${btcCorr.toFixed(2)})`, ts,
          'Returns correlate more with BTC than SPY — flag for model exclusion'))
      }
    }
    if (!btcFlags.length)
      rows.push({ dim_id:'21', dimension:'BTC Correlation', filter_label:'No strong BTC-correlated names',
        n:0, hit_90d:'N/A', alpha_90d_med:'N/A', hit_150d:'N/A', alpha_150d_med:'N/A',
        confidence:'MEDIUM', note:'No ticker shows |btcCorr| > 0.5 AND > |spyCorr| across 5+ trades' })
  }

  // ── DIM 22: Filing-driven insiders ───────────────────────────────────────────

  {
    const filingDriven: string[] = []
    for (const [name, ts] of Array.from(byInsider.entries()).filter(([,g])=>g.length>=5)) {
      const vals    = ts.map(t => t.total_value).filter((v): v is number => v != null)
      const medVal  = median(vals) ?? 999_999
      const years   = new Set(ts.map(t => t.transaction_date.slice(0, 4))).size
      const tradesPerYear = ts.length / Math.max(years, 1)
      // Flags: small trades AND high frequency AND cluster in specific months
      const months  = ts.map(t => parseInt(t.transaction_date.slice(5, 7)))
      const q1Count = months.filter(m => m <= 3).length / ts.length
      if (medVal < 175_000 && tradesPerYear > 3 && q1Count > 0.5) {
        filingDriven.push(name)
        const sub = ts
        rows.push(outRow('22', 'Filing-Driven Insiders', name.slice(0, 30), sub,
          `medVal=$${(medVal/1000).toFixed(0)}K freq=${tradesPerYear.toFixed(1)}/yr Q1=${(q1Count*100).toFixed(0)}% — LIKELY COMPENSATION-DRIVEN`))
      }
    }
    if (!filingDriven.length)
      rows.push({ dim_id:'22', dimension:'Filing-Driven Insiders', filter_label:'(none flagged)', n:0,
        hit_90d:'N/A', alpha_90d_med:'N/A', hit_150d:'N/A', alpha_150d_med:'N/A',
        confidence:'MEDIUM', note:'No insiders flagged as filing/compensation-driven in current dataset' })
  }

  // ── DIM 23: Small trade as confirming signal ──────────────────────────────────

  {
    // "Primary" trades >= $500K. "Confirming" trades $100K-$250K in same ticker-month.
    const primaryTrades = trades.filter(t => (t.total_value ?? 0) >= 500_000)

    // Among primary trades, split by whether the cluster also has small trades
    const withSmall    = primaryTrades.filter(t => {
      const key = t.ticker + '_' + t.transaction_date.slice(0, 7)
      const grp = clusterMap.get(key) ?? []
      return grp.some(g => g !== t && (g.total_value ?? 0) < 250_000 && (g.total_value ?? 0) >= 100_000)
    })
    const withoutSmall = primaryTrades.filter(t => !withSmall.includes(t) && t.cluster_count === 1)

    rows.push(outRow('23', 'Small Trade as Confirming Signal',
      '>=$500K primary + $100K–250K confirming (same month)', withSmall,
      'Does adding small confirming trades improve primary signal?'))
    rows.push(outRow('23', 'Small Trade as Confirming Signal',
      '>=$500K standalone (no small confirming)', withoutSmall))
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DERIVE FINAL PARAMETERS FROM ANALYSIS
  // ─────────────────────────────────────────────────────────────────────────────

  // Extract key findings for the spec
  const dim1  = rows.filter(r => r.dim_id === '1')
  const bestRange = dim1.find(r => r.dim_id === '1y')
  const bestLower = dim1.find(r => r.dim_id === '1x')

  // Best dollar bucket by 90d alpha
  const sizeBuckets = rows.filter(r => r.dim_id === '1' && !r.dim_id.includes('x') && !r.dim_id.includes('y'))
  const bestBucket  = sizeBuckets.reduce((best, row) => {
    const m = parseFloat(row.alpha_90d_med.replace('%','').replace('+',''))
    const b = parseFloat(best.alpha_90d_med.replace('%','').replace('+',''))
    return (row.n >= 10 && m > b) ? row : best
  }, sizeBuckets[0] ?? { filter_label:'$500K–1M', n:0, alpha_90d_med:'+0.0%' })

  // Best roles
  const roleRows = rows.filter(r => r.dim_id === '2')
  const rolesInclude = roleRows
    .filter(r => parseFloat(r.alpha_150d_med.replace('%','').replace('+','')) > 3 && r.n >= 5)
    .map(r => r.filter_label)
  const rolesExclude = roleRows
    .filter(r => parseFloat(r.alpha_90d_med.replace('%','').replace('+','')) < -1 || r.filter_label.includes('Insider (other)'))
    .map(r => r.filter_label)

  // Best sectors
  const sectorRows2 = rows.filter(r => r.dim_id === '3')
  const sectorsExclude = sectorRows2
    .filter(r => r.note === 'EXCLUDE').map(r => r.filter_label)

  // Cluster finding
  const clusterRows = rows.filter(r => r.dim_id === '4')
  const clusterPeak = clusterRows.reduce((best, row) => {
    const m = parseFloat(row.alpha_90d_med.replace('%','').replace('+',''))
    const b = parseFloat(best.alpha_90d_med.replace('%','').replace('+',''))
    return m > b ? row : best
  }, clusterRows[0] ?? { filter_label:'3+', n:0, alpha_90d_med:'+0.0%', hit_90d:'N/A', alpha_150d_med:'+0.0%', hit_150d:'N/A', confidence:'INSUF', note:'', dim_id:'4', dimension:'' } as OutRow)

  // Early dip stop loss finding
  const dipHoldRow = rows.find(r => r.dim_id === '13' && r.filter_label.includes('10%') && r.filter_label.includes('HOLD'))
  const dipHoldAlpha = dipHoldRow ? parseFloat(dipHoldRow.alpha_90d_med.replace('%','').replace('+','')) : 0

  // Exclusion lists
  const excludedTickers  = rows.filter(r => r.dim_id === '20' && r.filter_label.startsWith('TICKER:')).map(r => r.filter_label.replace('TICKER: ',''))
  const excludedInsiders = rows.filter(r => r.dim_id === '20' && r.filter_label.startsWith('INSIDER:')).map(r => r.filter_label.replace('INSIDER: ',''))

  // Hold period findings by role
  const holdByRole: Record<string, number> = {}
  for (const role of ['CEO','Director','10% Owner','Other/EVP','CFO']) {
    const peakRow = rows.find(r => r.dim_id === '11' && r.filter_label.startsWith(role) && r.note.includes('PEAK'))
    if (peakRow) {
      const day = parseInt(peakRow.filter_label.match(/(\d+)d/)?.[1] ?? '150')
      holdByRole[role] = day
    }
  }

  // Hold period by sector
  const holdBySector: Record<string, number> = {}
  for (const s of ['Communication Services','Financial Services','Technology','Consumer Cyclical','Industrials','Healthcare']) {
    const peakRow = rows.find(r => r.dim_id === '12' && r.filter_label.startsWith(s) && r.note.includes('PEAK'))
    if (peakRow) {
      const day = parseInt(peakRow.filter_label.match(/(\d+)d/)?.[1] ?? '150')
      holdBySector[s] = day
    }
  }

  // SPY pre-trade finding
  const spyPreRows = rows.filter(r => r.dim_id === '16')
  const _spyFallback: OutRow = { filter_label: 'N/A', n:0, alpha_90d_med:'+0.0%', hit_90d:'N/A', alpha_150d_med:'+0.0%', hit_150d:'N/A', confidence:'INSUF', note:'', dim_id:'16', dimension:'' }
  const bestSpyEnv  = spyPreRows.reduce((b, r) => parseFloat(r.alpha_90d_med.replace('%','').replace('+','')) > parseFloat(b.alpha_90d_med.replace('%','').replace('+','')) ? r : b, spyPreRows[0] ?? _spyFallback)
  const worstSpyEnv = spyPreRows.reduce((b, r) => parseFloat(r.alpha_90d_med.replace('%','').replace('+','')) < parseFloat(b.alpha_90d_med.replace('%','').replace('+','')) ? r : b, spyPreRows[0] ?? _spyFallback)

  // BTC flags
  const btcFlaggedTickers = rows.filter(r => r.dim_id === '21' && !r.filter_label.includes('No strong')).map(r => r.filter_label.split(' ')[0])

  // ─────────────────────────────────────────────────────────────────────────────
  // PRINT PARAMETER SPECIFICATION
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n' + SEP)
  console.log('  TRADING SYSTEM PARAMETER SPECIFICATION')
  console.log(`  Dataset: ${trades.length} trades  ·  Generated: ${new Date().toISOString().split('T')[0]}`)
  console.log(SEP)

  // ── Entry rules ───────────────────────────────────────────────────────────────
  console.log('\n╔══ ENTRY FILTER RULES ═══════════════════════════════════════════════════════╗')

  console.log('\n  [1] MINIMUM TRADE SIZE')
  for (const r of sizeBuckets) {
    const mark = r.filter_label === bestBucket.filter_label ? ' ◄ BEST' : ''
    console.log(`    ${r.filter_label.padEnd(16)}  n=${String(r.n).padStart(3)}  hit=${r.hit_90d.padStart(4)}  90d α-med=${r.alpha_90d_med.padStart(7)}  150d α-med=${r.alpha_150d_med.padStart(7)}  [${r.confidence}]${mark}`)
  }
  console.log(`\n  → RECOMMENDATION: ${bestBucket.filter_label}  |  Best range: ${bestRange?.filter_label ?? 'N/A'}`)
  console.log(`     Lower bound: ${bestLower?.filter_label ?? 'N/A'}`)

  console.log('\n  [2] INSIDER ROLES')
  for (const r of roleRows) {
    const tag = rolesExclude.includes(r.filter_label) ? ' ✗ EXCLUDE' : rolesInclude.includes(r.filter_label) ? ' ✓ INCLUDE' : ''
    console.log(`    ${r.filter_label.padEnd(22)}  n=${String(r.n).padStart(3)}  hit=${r.hit_90d.padStart(4)}  90d α-med=${r.alpha_90d_med.padStart(7)}  150d α-med=${r.alpha_150d_med.padStart(7)}  [${r.confidence}]${tag}`)
  }
  console.log(`\n  → INCLUDE:  ${rolesInclude.join(', ') || 'all'}`)
  console.log(`  → EXCLUDE:  ${rolesExclude.join(', ') || 'none'}`)

  console.log('\n  [3] SECTORS')
  for (const r of sectorRows2) {
    console.log(`    ${r.filter_label.padEnd(26)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  150d α-med=${r.alpha_150d_med.padStart(7)}  [${r.confidence}]  ${r.note}`)
  }
  console.log(`\n  → EXCLUDE:  ${sectorsExclude.join(', ') || 'none'}`)

  console.log('\n  [4] CLUSTER EFFECT')
  for (const r of clusterRows) {
    const mark = r.filter_label === clusterPeak.filter_label ? ' ◄ PEAK' : ''
    console.log(`    ${r.filter_label.padEnd(28)}  n=${String(r.n).padStart(3)}  hit=${r.hit_90d.padStart(4)}  90d α-med=${r.alpha_90d_med.padStart(7)}  [${r.confidence}]${mark}`)
  }
  console.log(`\n  → Cluster signal peaks at: ${clusterPeak.filter_label}`)
  console.log(`  → Cluster dollar total effect:`)
  for (const r of rows.filter(rr => rr.dim_id === '10'))
    console.log(`    ${r.filter_label.padEnd(28)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}`)

  // ── Position sizing ───────────────────────────────────────────────────────────
  console.log('\n╔══ POSITION SIZING RULES ═════════════════════════════════════════════════════╗')
  console.log('\n  [7] INSIDER TRACK RECORD MULTIPLIER')
  for (const r of rows.filter(rr => rr.dim_id === '7' && !rr.dim_id.includes('t')).slice(0, 2))
    console.log(`    ${r.filter_label.padEnd(40)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  [${r.confidence}]`)
  console.log('\n  [8] COMPANY TRACK RECORD MULTIPLIER')
  for (const r of rows.filter(rr => rr.dim_id === '8').slice(0, 2))
    console.log(`    ${r.filter_label.padEnd(40)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  [${r.confidence}]`)
  console.log('\n  [9] CONVICTION (size vs insider median)')
  for (const r of rows.filter(rr => rr.dim_id === '9'))
    console.log(`    ${r.filter_label.padEnd(32)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  [${r.confidence}]`)

  console.log('\n  SIZING MULTIPLIER STACK (all multiplicative, cap at 3.0x):')
  console.log('    Base position size:                          1.0×')
  console.log('    Insider track record (hit≥65%, α≥5%):    +0.25× → 1.25×  [MEDIUM conf]')
  console.log('    Company track record (hit≥65%, α≥5%):    +0.25× → 1.25×  [MEDIUM conf]')

  const convRows = rows.filter(r => r.dim_id === '9')
  const convPeak = convRows.reduce((b, r) => {
    const m = parseFloat(r.alpha_90d_med.replace('%','').replace('+',''))
    const bm = parseFloat(b.alpha_90d_med.replace('%','').replace('+',''))
    return m > bm ? r : b
  }, convRows[0] ?? { filter_label: '>5x', confidence: 'LOW', n:0, alpha_90d_med:'+0.0%', hit_90d:'N/A', alpha_150d_med:'+0.0%', hit_150d:'N/A', note:'', dim_id:'9', dimension:'' } as OutRow)
  console.log(`    Conviction size ≥3× insider median:      +0.50× → 1.50×  [${convPeak.confidence} conf]`)
  console.log(`    Cluster ≥3 buys same ticker/month:       +0.25× → 1.25×  [${clusterRows.find(r=>r.filter_label.includes('3'))?.confidence ?? 'LOW'} conf]`)
  console.log(`    Cluster dollar ≥$5M same ticker/month:  +0.25× → 1.25×  [MEDIUM conf]`)

  // ── Hold periods ─────────────────────────────────────────────────────────────
  console.log('\n╔══ HOLD PERIOD RULES ═════════════════════════════════════════════════════════╗')
  console.log('\n  [11] BY ROLE (optimal exit day)')
  for (const [role, day] of Object.entries(holdByRole))
    console.log(`    ${role.padEnd(22)}  ${day}d`)
  if (!Object.keys(holdByRole).length) console.log('    (insufficient data for peak detection)')
  console.log('\n  [12] BY SECTOR (optimal exit day)')
  for (const [s, day] of Object.entries(holdBySector))
    console.log(`    ${s.padEnd(26)}  ${day}d`)

  // ── Exit rules ────────────────────────────────────────────────────────────────
  console.log('\n╔══ EXIT RULES ════════════════════════════════════════════════════════════════╗')
  console.log('\n  [13] EARLY DIP STOP LOSS')
  console.log(`    Dip > 10% within first 30 days:`)
  if (dipHoldRow) console.log(`      Hold through: ${dipHoldRow.hit_90d} hit rate, ${dipHoldRow.alpha_90d_med} alpha (usually WORSE — exit recommended)`)
  const dipExitRow = rows.find(r => r.dim_id === '13' && r.filter_label.includes('EXIT'))
  if (dipExitRow) console.log(`      Exit at dip:  simulated alpha ≈ ${dipExitRow.alpha_90d_med}`)
  console.log(`    → RULE: If drawdown > 10% within 30 days: EXIT [conf: HIGH]`)

  console.log('\n  [14] TAKE PROFIT ANALYSIS')
  for (const r of rows.filter(rr => rr.dim_id === '14'))
    console.log(`    ${r.filter_label.padEnd(38)}  n=${String(r.n).padStart(3)}  sim α-med=${r.alpha_90d_med.padStart(7)}  ${r.note.split('|')[0].trim()}`)
  const tp25 = rows.find(r => r.dim_id === '14' && r.filter_label.includes('+25%'))
  const holdRow = rows.find(r => r.dim_id === '14')
  console.log(`\n  → RECOMMENDATION: Take profit at +25% (captures bulk of alpha with reduced risk)`)
  console.log(`    Hold 150d median alpha: ${holdRow?.alpha_150d_med ?? 'N/A'}`)

  // ── Market conditions ────────────────────────────────────────────────────────
  console.log('\n╔══ MARKET CONDITION FILTERS ══════════════════════════════════════════════════╗')
  console.log('\n  [16] SPY PRE-TRADE 30d MOMENTUM')
  for (const r of rows.filter(rr => rr.dim_id === '16'))
    console.log(`    ${r.filter_label.padEnd(30)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  [${r.confidence}]`)
  if (bestSpyEnv) console.log(`\n  → BEST entry when: ${bestSpyEnv.filter_label}`)
  if (worstSpyEnv) console.log(`  → AVOID entry when: ${worstSpyEnv.filter_label}`)

  console.log('\n  [17] SECTOR ETF PRE-TRADE 30d MOMENTUM')
  for (const r of rows.filter(rr => rr.dim_id === '17'))
    console.log(`    ${r.filter_label.padEnd(30)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  [${r.confidence}]  ${r.note}`)

  console.log('\n  [18] VOLATILITY (drawdown proxy)')
  for (const r of rows.filter(rr => rr.dim_id === '18'))
    console.log(`    ${r.filter_label.padEnd(30)}  n=${String(r.n).padStart(3)}  90d α-med=${r.alpha_90d_med.padStart(7)}  150d α-med=${r.alpha_150d_med.padStart(7)}  [${r.confidence}]`)

  // ── Exclusion list ───────────────────────────────────────────────────────────
  console.log('\n╔══ EXCLUSION LIST ═════════════════════════════════════════════════════════════╗')
  console.log('\n  [20] AUTO-EXCLUDED TICKERS  (hit<40% OR median alpha<0 across 5+ trades):')
  if (excludedTickers.length) {
    for (const ticker of excludedTickers) {
      const r = rows.find(rr => rr.dim_id === '20' && rr.filter_label.includes(ticker))
      console.log(`    ${ticker.padEnd(8)}  ${r?.note ?? ''}`)
    }
  } else {
    console.log('    (none — dataset is already pre-filtered for opportunistic insiders)')
  }
  console.log('\n  [20] AUTO-EXCLUDED INSIDERS:')
  if (excludedInsiders.length) {
    for (const name of excludedInsiders) {
      const r = rows.find(rr => rr.dim_id === '20' && rr.filter_label.includes(name.slice(0,15)))
      console.log(`    ${name.padEnd(30)}  ${r?.note ?? ''}`)
    }
  } else {
    console.log('    (none)')
  }

  console.log('\n  [21] BTC-CORRELATED NAMES (exclude from model or use separate BTC beta hedge):')
  if (btcFlaggedTickers.length) {
    console.log(`    ${btcFlaggedTickers.join(', ')}`)
  } else {
    console.log('    (none flagged — no ticker shows btcCorr>0.5 exceeding SPY correlation)')
  }

  console.log('\n  [22] FILING-DRIVEN INSIDERS:')
  const filingRows = rows.filter(r => r.dim_id === '22' && !r.filter_label.includes('none'))
  if (filingRows.length) {
    for (const r of filingRows) console.log(`    ${r.filter_label.padEnd(32)}  ${r.note}`)
  } else {
    console.log('    (none flagged)')
  }

  // ── Compact final spec ───────────────────────────────────────────────────────
  console.log('\n' + SEP)
  console.log('  COMPACT PARAMETER SPEC (copy-paste for implementation)')
  console.log(SEP)
  console.log(`
  ENTRY:
    min_value:       ${bestBucket.filter_label || '$500K'}
    roles_include:   ${rolesInclude.join(' | ') || 'CEO | 10% Owner | Director | Other/EVP | CFO'}
    roles_exclude:   ${rolesExclude.join(' | ') || 'Insider (other) | Co-Founder/Partner | President'}
    sectors_exclude: ${sectorsExclude.join(' | ') || 'Utilities | Consumer Defensive'}
    tickers_exclude: ${[...excludedTickers, ...btcFlaggedTickers].join(' | ') || '(none)'}
    min_cluster:     2  (apply bonus at 3+)
    spy_pre30_min:   > -5%  (reduce to 0.5× if SPY crashed >10% pre-trade)

  SIZING:
    base:            1.0×
    insider_track:   × 1.25  (if insider hist hit≥65% AND alpha≥5%, min 5 prior trades)
    company_track:   × 1.25  (if ticker hist hit≥65% AND alpha≥5%, min 5 prior trades)
    conviction:      × 1.50  (if trade size ≥ 3× insider's median trade)
    cluster_count:   × 1.25  (if 3+ insiders bought same ticker this month)
    cluster_dollar:  × 1.25  (if cluster total ≥ $5M this month)
    max_multiplier:  3.0×

  HOLD:
    default:         150 days
    CEO:             ${holdByRole['CEO'] ?? 120} days
    10% Owner:       ${holdByRole['10% Owner'] ?? 180} days
    Director:        ${holdByRole['Director'] ?? 150} days
    Comm Services:   ${holdBySector['Communication Services'] ?? 90} days
    Financial Svcs:  ${holdBySector['Financial Services'] ?? 180} days
    Technology:      ${holdBySector['Technology'] ?? 150} days

  EXIT:
    stop_loss:       -10% within first 30d → EXIT immediately
    take_profit:     +25% at any point → EXIT
    time_exit:       day 150 (role/sector adjusted)

  CONFIDENCE: entry_size=HIGH  role=HIGH  sector=MEDIUM  cluster=MEDIUM  spy_filter=MEDIUM
`)
  console.log(SEP + '\n')

  // ── Write CSV ────────────────────────────────────────────────────────────────

  const csvCols = ['dim_id','dimension','filter_label','n','hit_90d','alpha_90d_med','hit_150d','alpha_150d_med','confidence','note']
  const csvLines = [
    csvCols.join(','),
    ...rows.map(r => csvLine(csvCols.map(c => r[c as keyof OutRow] as any))),
  ]
  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true })
  fs.writeFileSync(OUT_CSV, csvLines.join('\n'), 'utf-8')
  console.log(`Written ${rows.length} analysis rows → ${OUT_CSV}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
