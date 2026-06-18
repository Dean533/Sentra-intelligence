// Run with:  npx tsx scripts/backtest-universe.ts
// Output:    output/backtest-universe.csv
//            output/backtest-results.json   (aggregate buckets)
//            output/backtest-universe-progress.json  (resume state)
//            output/backtest-universe-partial.jsonl  (per-trade enriched rows, appended live)
//
// Measures SPY-adjusted alpha at 30/60/90/180d for ALL P/S insider trades
// across the full tracked universe, joining each trade to the insider's current
// classification (OPPORTUNISTIC / ROUTINE / UNCLASSIFIABLE).
//
// Classification is applied retroactively (current 2026 CMP classification used
// for all historical trades). This characterises insider *type* vs performance,
// not a walk-forward signal — appropriate for calibrating scoring priors.
//
// Resume-safe: price fetches are cached in partial.jsonl + progress.json.
// Re-running after interruption resumes from the last completed ticker.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
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

const DELAY_MS    = 250
const PAGE_SIZE   = 1000
const HOLD_DAYS   = [30, 60, 90, 180] as const
const CUTOFF_DATE = '2021-01-01'

const OUT_DIR      = path.join(__dirname, '..', 'output')
const PROGRESS_F   = path.join(OUT_DIR, 'backtest-universe-progress.json')
const PARTIAL_F    = path.join(OUT_DIR, 'backtest-universe-partial.jsonl')
const CSV_OUT      = path.join(OUT_DIR, 'backtest-universe.csv')
const JSON_OUT     = path.join(OUT_DIR, 'backtest-results.json')

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

function r2(n: number): number { return Math.round(n * 100) / 100 }

function fn(v: string | number | null | undefined): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v as string)
  return isNaN(n) ? null : n
}

function buildPriceMap(quotes: any[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date != null && (q?.adjClose ?? q?.close) != null)
      map.set(isoDate(new Date(q.date)), q.adjClose ?? q.close)
  }
  return map
}

// Nearest trading day on or after target, up to 7 calendar days forward
function lookupPrice(map: Map<string, number>, target: Date): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(target)
    d.setUTCDate(d.getUTCDate() + i)
    const p = map.get(isoDate(d))
    if (p != null) return p
  }
  return null
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? `"${s.replace(/"/g, '""')}"` : s
}

function classifyRole(role: string, title: string): string {
  const r = (role ?? '').toLowerCase(), t = (title ?? '').toLowerCase()
  if (r.includes('ceo') || r.includes('chief executive') || t.includes('ceo') || t.includes('chief executive')) return 'CEO'
  if (r.includes('cfo') || r.includes('chief financial')  || t.includes('cfo') || t.includes('chief financial'))  return 'CFO'
  if (r.includes('president') || t.includes('president')) return 'President'
  if (r.includes('director'))  return 'Director'
  if (r.includes('10%') || r.includes('10% owner'))       return '10% Owner'
  if (r.includes('co-founder')) return 'Co-Founder/Partner'
  if (r.includes('insider'))    return 'Insider (other)'
  return 'Other/EVP'
}

function sizeBucket(totalValue: number | null): string {
  if (totalValue == null || totalValue <= 0) return 'Unknown'
  if (totalValue < 50_000)      return '<$50K'
  if (totalValue < 100_000)     return '$50K–100K'
  if (totalValue < 250_000)     return '$100K–250K'
  if (totalValue < 500_000)     return '$250K–500K'
  if (totalValue < 1_000_000)   return '$500K–1M'
  if (totalValue < 5_000_000)   return '$1M–5M'
  if (totalValue < 25_000_000)  return '$5M–25M'
  return '$25M+'
}

// ─── Supabase paginator ───────────────────────────────────────────────────────

async function fetchAll<T>(
  table: string,
  selectStr: string,
  filters: (q: any) => any
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const { data, error } = await filters(
      supabase.from(table).select(selectStr)
    ).range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`fetchAll(${table}): ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function hitRate(arr: number[]): number | null {
  return arr.length ? arr.filter(v => v > 0).length / arr.length : null
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Classification = 'OPPORTUNISTIC' | 'ROUTINE' | 'UNCLASSIFIABLE'

type RichTrade = {
  id:                string
  ticker:            string
  insider_name:      string
  insider_cik:       string
  officer_title:     string
  role:              string
  role_classified:   string
  transaction_code:  string
  direction:         'buy' | 'sell'
  classification:    Classification
  transaction_date:  string
  total_value:       number | null
  shares:            number | null
  price_per_share:   number | null
  shares_owned_after: number | null
  sector:            string
  size_bucket:       string
  price_entry:       number | null
  price_30d:  number | null; price_60d:  number | null
  price_90d:  number | null; price_180d: number | null
  return_30d:  number | null; return_60d:  number | null
  return_90d:  number | null; return_180d: number | null
  spy_return_30d:  number | null; spy_return_60d:  number | null
  spy_return_90d:  number | null; spy_return_180d: number | null
  // alpha = stock_return - spy_return (raw, unsigned)
  alpha_30d:  number | null; alpha_60d:  number | null
  alpha_90d:  number | null; alpha_180d: number | null
  // signal_alpha: flipped for sells so positive = correct directional call
  signal_alpha_30d:  number | null; signal_alpha_60d:  number | null
  signal_alpha_90d:  number | null; signal_alpha_180d: number | null
  direction_correct_90d:  boolean | null
  direction_correct_180d: boolean | null
}

const CSV_COLS: (keyof RichTrade)[] = [
  'id', 'ticker', 'insider_name', 'insider_cik', 'officer_title', 'role', 'role_classified',
  'transaction_code', 'direction', 'classification',
  'transaction_date', 'total_value', 'shares', 'price_per_share', 'shares_owned_after',
  'sector', 'size_bucket', 'price_entry',
  'price_30d', 'price_60d', 'price_90d', 'price_180d',
  'return_30d', 'return_60d', 'return_90d', 'return_180d',
  'spy_return_30d', 'spy_return_60d', 'spy_return_90d', 'spy_return_180d',
  'alpha_30d', 'alpha_60d', 'alpha_90d', 'alpha_180d',
  'signal_alpha_30d', 'signal_alpha_60d', 'signal_alpha_90d', 'signal_alpha_180d',
  'direction_correct_90d', 'direction_correct_180d',
]

// ─── Aggregation ──────────────────────────────────────────────────────────────

type BucketStats = {
  n:               number
  mean_alpha_30d:  number | null; median_alpha_30d:  number | null
  mean_alpha_60d:  number | null; median_alpha_60d:  number | null
  mean_alpha_90d:  number | null; median_alpha_90d:  number | null
  mean_alpha_180d: number | null; median_alpha_180d: number | null
  hit_rate_90d:    number | null
  hit_rate_180d:   number | null
}

function bucketStats(trades: RichTrade[]): BucketStats {
  const a = (key: 'alpha_30d'|'alpha_60d'|'alpha_90d'|'alpha_180d') =>
    trades.map(t => t[key]).filter((v): v is number => v != null)

  const a90  = a('alpha_90d')
  const a180 = a('alpha_180d')
  return {
    n:               trades.length,
    mean_alpha_30d:  mean(a('alpha_30d')),  median_alpha_30d:  median(a('alpha_30d')),
    mean_alpha_60d:  mean(a('alpha_60d')),  median_alpha_60d:  median(a('alpha_60d')),
    mean_alpha_90d:  mean(a90),             median_alpha_90d:  median(a90),
    mean_alpha_180d: mean(a180),            median_alpha_180d: median(a180),
    hit_rate_90d:    hitRate(a90),
    hit_rate_180d:   hitRate(a180),
  }
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const t of arr) {
    const k = key(t)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(t)
  }
  return m
}

function aggregateBuckets(trades: RichTrade[]): Record<string, BucketStats> {
  const out: Record<string, BucketStats> = {}
  const add = (key: string, subset: RichTrade[]) => {
    if (subset.length > 0) out[key] = bucketStats(subset)
  }

  // 1. By classification alone (all directions)
  for (const [cls, g] of groupBy(trades, t => t.classification)) {
    add(`cls:${cls}`, g)
  }

  // 2. By classification × direction
  for (const [k, g] of groupBy(trades, t => `${t.classification}:${t.direction}`)) {
    add(`cls_dir:${k}`, g)
  }

  // 3. By classification × role (all directions)
  for (const [k, g] of groupBy(trades, t => `${t.classification}:${t.role_classified}`)) {
    add(`cls_role:${k}`, g)
  }

  // 4. By classification × direction × role
  for (const [k, g] of groupBy(trades, t => `${t.classification}:${t.direction}:${t.role_classified}`)) {
    add(`cls_dir_role:${k}`, g)
  }

  // 5. By classification × direction × size bucket
  for (const [k, g] of groupBy(trades, t => `${t.classification}:${t.direction}:${t.size_bucket}`)) {
    add(`cls_dir_size:${k}`, g)
  }

  // 6. By classification × direction × sector (≥5 trades implicit in caller)
  for (const [k, g] of groupBy(trades, t => `${t.classification}:${t.direction}:${t.sector}`)) {
    add(`cls_dir_sector:${k}`, g)
  }

  // 7. Fine-grained: classification × direction × role × size bucket
  for (const [k, g] of groupBy(trades, t =>
    `fine:${t.classification}:${t.direction}:${t.role_classified}:${t.size_bucket}`
  )) {
    if (g.length >= 3) add(k, g)  // only emit buckets with ≥3 trades
  }

  return out
}

// ─── Console summary ──────────────────────────────────────────────────────────

function fmtPct(n: number | null, dp = 1): string {
  if (n == null) return '  N/A '
  return (n >= 0 ? '+' : '') + n.toFixed(dp) + '%'
}
function fmtHit(n: number | null): string {
  return n == null ? ' N/A' : (n * 100).toFixed(0) + '%'
}
function pad(s: string | number, w: number): string { return String(s).padStart(w) }

function printTable(
  title: string,
  rows: Array<{ label: string } & BucketStats>,
  minN = 0
) {
  const SEP = '─'.repeat(90)
  console.log(`\n── ${title}`)
  console.log(SEP)
  console.log(
    '  ' + 'Label'.padEnd(38) +
    pad('n', 6) + '  ' +
    pad('90d hit', 7) + '  ' + pad('90d α-med', 10) + '  ' + pad('90d α-mean', 11) + '  ' +
    pad('180d hit', 8) + '  ' + pad('180d α-med', 11)
  )
  console.log('  ' + SEP)
  for (const r of rows) {
    if (r.n < minN) continue
    console.log(
      '  ' + r.label.slice(0, 37).padEnd(38) +
      pad(r.n, 6) + '  ' +
      pad(fmtHit(r.hit_rate_90d), 7) + '  ' +
      pad(fmtPct(r.median_alpha_90d), 10) + '  ' +
      pad(fmtPct(r.mean_alpha_90d), 11) + '  ' +
      pad(fmtHit(r.hit_rate_180d), 8) + '  ' +
      pad(fmtPct(r.median_alpha_180d), 11)
    )
  }
}

function printSummary(trades: RichTrade[], buckets: Record<string, BucketStats>) {
  const SEP = '═'.repeat(90)
  console.log('\n' + SEP)
  console.log('  BACKTEST — FULL UNIVERSE  ·  ' + trades.length.toLocaleString() + ' trades')
  console.log(SEP)

  // ── 1. By classification ──────────────────────────────────────────────────
  const CLASS_ORDER: Classification[] = ['OPPORTUNISTIC', 'ROUTINE', 'UNCLASSIFIABLE']
  printTable('BY CLASSIFICATION (all directions)', CLASS_ORDER.map(cls => ({
    label: cls,
    ...(buckets[`cls:${cls}`] ?? { n: 0, mean_alpha_30d:null, median_alpha_30d:null, mean_alpha_60d:null, median_alpha_60d:null, mean_alpha_90d:null, median_alpha_90d:null, mean_alpha_180d:null, median_alpha_180d:null, hit_rate_90d:null, hit_rate_180d:null }),
  })))

  // ── 2. By classification × direction ─────────────────────────────────────
  printTable('BY CLASSIFICATION × DIRECTION', CLASS_ORDER.flatMap(cls =>
    (['buy', 'sell'] as const).map(dir => ({
      label: `${cls} · ${dir}`,
      ...(buckets[`cls_dir:${cls}:${dir}`] ?? { n: 0, mean_alpha_30d:null, median_alpha_30d:null, mean_alpha_60d:null, median_alpha_60d:null, mean_alpha_90d:null, median_alpha_90d:null, mean_alpha_180d:null, median_alpha_180d:null, hit_rate_90d:null, hit_rate_180d:null }),
    }))
  ))

  // ── 3. By classification × role (buys only) ───────────────────────────────
  const ROLE_ORDER = ['CEO', 'CFO', 'President', 'Director', '10% Owner', 'Co-Founder/Partner', 'Insider (other)', 'Other/EVP']
  printTable('BY CLASSIFICATION × ROLE  (buys only)',
    CLASS_ORDER.flatMap(cls => ROLE_ORDER.map(role => {
      const key = `cls_dir_role:${cls}:buy:${role}`
      const s   = buckets[key]
      return s ? { label: `${cls} · ${role}`, ...s } : null
    })).filter(Boolean) as any[],
    5
  )

  // ── 4. By classification × size bucket (buys only) ───────────────────────
  const SIZE_ORDER = ['<$50K','$50K–100K','$100K–250K','$250K–500K','$500K–1M','$1M–5M','$5M–25M','$25M+','Unknown']
  printTable('BY SIZE BUCKET  (buys only)',
    CLASS_ORDER.flatMap(cls => SIZE_ORDER.map(sz => {
      const key = `cls_dir_size:${cls}:buy:${sz}`
      const s   = buckets[key]
      return s ? { label: `${cls} · ${sz}`, ...s } : null
    })).filter(Boolean) as any[],
    5
  )

  // ── 5. By sector (buys, each classification, ≥10 trades) ─────────────────
  const sectorKeys = Object.keys(buckets)
    .filter(k => k.startsWith('cls_dir_sector:') && k.includes(':buy:'))
    .sort((a, b) => (buckets[b].median_alpha_90d ?? -99) - (buckets[a].median_alpha_90d ?? -99))
    .slice(0, 30)

  printTable('TOP SECTORS BY 90d MEDIAN ALPHA  (buys only)',
    sectorKeys.map(k => ({ label: k.replace('cls_dir_sector:', '').replace(':buy:', ' · '), ...buckets[k] })),
    10
  )

  console.log('\n' + SEP + '\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })

  // ── Load resume state ─────────────────────────────────────────────────────

  let completedTickers = new Set<string>()
  let existingTrades: RichTrade[] = []

  if (fs.existsSync(PROGRESS_F)) {
    const prog = JSON.parse(fs.readFileSync(PROGRESS_F, 'utf-8'))
    completedTickers = new Set(prog.completedTickers ?? [])
    console.log(`Resuming: ${completedTickers.size} tickers already done`)
  }

  if (fs.existsSync(PARTIAL_F)) {
    const lines = fs.readFileSync(PARTIAL_F, 'utf-8').split('\n').filter(Boolean)
    existingTrades = lines.map(l => JSON.parse(l))
    console.log(`Loaded ${existingTrades.length} enriched trades from partial file`)
  }

  // ── Step 1: fetch all P/S trades ─────────────────────────────────────────

  console.log('\nFetching all P/S trades from insider_transactions...')
  const rawTrades = await fetchAll<{
    id: string; ticker: string; insider_name: string | null; insider_cik: string | null
    officer_title: string | null; role: string | null; transaction_code: string
    transaction_date: string; total_value: number | null
    shares: number | null; price_per_share: number | null; shares_owned_after: number | null
  }>(
    'insider_transactions',
    'id, ticker, insider_name, insider_cik, officer_title, role, transaction_code, transaction_date, total_value, shares, price_per_share, shares_owned_after',
    q => q
      .in('transaction_code', ['P', 'S'])
      .gte('transaction_date', CUTOFF_DATE)
      .order('transaction_date', { ascending: true })
  )
  console.log(`  ${rawTrades.length.toLocaleString()} total P/S trades fetched`)

  // ── Step 2: classification map (insider_cik → classification) ────────────

  console.log('Fetching insider_classifications...')
  const classRows = await fetchAll<{ insider_cik: string; classification: string }>(
    'insider_classifications',
    'insider_cik, classification',
    q => q
  )
  const classMap = new Map<string, Classification>()
  for (const r of classRows) {
    if (r.insider_cik) classMap.set(r.insider_cik, r.classification as Classification)
  }
  console.log(`  ${classMap.size.toLocaleString()} classified insiders`)

  // ── Step 3: sector map ───────────────────────────────────────────────────

  const allTickerSymbols = Array.from(new Set(rawTrades.map(t => t.ticker)))
  const sectorMap = new Map<string, string>()
  for (let i = 0; i < allTickerSymbols.length; i += 500) {
    const chunk = allTickerSymbols.slice(i, i + 500)
    const { data } = await supabase.from('tickers').select('symbol, sector').in('symbol', chunk)
    for (const r of data ?? []) sectorMap.set((r as any).symbol, (r as any).sector ?? 'Unknown')
  }
  console.log(`  Sector data: ${sectorMap.size} tickers`)

  // ── Step 4: SPY history ───────────────────────────────────────────────────

  const allDates = rawTrades.map(t => t.transaction_date).sort()
  const spyStart = new Date(CUTOFF_DATE)
  const spyEnd   = addDays(allDates[allDates.length - 1], 195)

  console.log(`\nFetching SPY  ${isoDate(spyStart)} → ${isoDate(spyEnd)}...`)
  await sleep(DELAY_MS)
  let spyMap = new Map<string, number>()
  try {
    const chart: any = await yf.chart('SPY', { period1: spyStart, period2: spyEnd, interval: '1d' })
    spyMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${spyMap.size} SPY price points`)
  } catch (err: any) {
    console.error(`SPY fetch failed: ${err.message}`)
    process.exit(1)
  }

  // ── Step 5: group by ticker, fetch prices, enrich trades ─────────────────

  const byTicker = new Map<string, typeof rawTrades>()
  for (const t of rawTrades) {
    if (!t.ticker) continue
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, [])
    byTicker.get(t.ticker)!.push(t)
  }

  const tickerList  = Array.from(byTicker.keys())
  const pendingList = tickerList.filter(t => !completedTickers.has(t))
  console.log(`\nTickers: ${tickerList.length} total, ${pendingList.length} to fetch, ${completedTickers.size} cached`)

  const today = isoDate(new Date())
  const partialStream = fs.createWriteStream(PARTIAL_F, { flags: 'a' })

  const saveProgress = () => {
    fs.writeFileSync(PROGRESS_F, JSON.stringify({
      completedTickers: Array.from(completedTickers),
      totalTickers: tickerList.length,
      lastUpdated: new Date().toISOString(),
    }, null, 2))
  }

  for (let ti = 0; ti < pendingList.length; ti++) {
    const ticker      = pendingList[ti]
    const tickerTrades = byTicker.get(ticker)!

    const dates      = tickerTrades.map(t => t.transaction_date).sort()
    const rangeStart = new Date(CUTOFF_DATE < dates[0] ? dates[0] : CUTOFF_DATE)
    const rangeEnd   = addDays(dates[dates.length - 1], 195)

    const total = completedTickers.size + ti + 1
    process.stdout.write(
      `[${total}/${tickerList.length}] ${ticker.padEnd(8)} ${tickerTrades.length}tx ... `
    )

    let priceMap = new Map<string, number>()
    try {
      await sleep(DELAY_MS)
      const chart: any = await yf.chart(ticker, { period1: rangeStart, period2: rangeEnd, interval: '1d' })
      priceMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
      process.stdout.write(`${priceMap.size}pts `)
    } catch (err: any) {
      process.stdout.write(`⚠ fetch failed (prices null) `)
    }

    let inserted = 0
    for (const trade of tickerTrades) {
      const txDate  = trade.transaction_date
      const txYear  = new Date(txDate).getUTCFullYear()
      const horizon = addDays(txDate, 180)

      // Skip if 180d window extends past today (incomplete data)
      if (isoDate(horizon) > today) continue

      const direction: 'buy' | 'sell' = trade.transaction_code === 'P' ? 'buy' : 'sell'
      const classification: Classification =
        trade.insider_cik ? (classMap.get(trade.insider_cik) ?? 'UNCLASSIFIABLE') : 'UNCLASSIFIABLE'

      const totalValue = fn(trade.total_value)
        ?? (fn(trade.shares) != null && fn(trade.price_per_share) != null
            ? fn(trade.shares)! * fn(trade.price_per_share)!
            : null)

      const priceEntry = lookupPrice(priceMap, new Date(txDate))
      if (priceEntry == null) continue

      const get = (days: number) => lookupPrice(priceMap, addDays(txDate, days))
      const p30  = get(30);  const p60  = get(60)
      const p90  = get(90);  const p180 = get(180)

      const ret = (fwd: number | null) => fwd != null ? pct(priceEntry, fwd) : null
      const r30  = ret(p30);  const r60  = ret(p60)
      const r90  = ret(p90);  const r180 = ret(p180)

      const spyEntry  = lookupPrice(spyMap, new Date(txDate))
      const spyGet = (days: number) => spyEntry ? lookupPrice(spyMap, addDays(txDate, days)) : null
      const sp30  = spyGet(30);  const sp60  = spyGet(60)
      const sp90  = spyGet(90);  const sp180 = spyGet(180)

      const spyRet = (fwd: number | null) => (spyEntry && fwd) ? pct(spyEntry, fwd) : null
      const sr30 = spyRet(sp30); const sr60 = spyRet(sp60)
      const sr90 = spyRet(sp90); const sr180 = spyRet(sp180)

      const alpha = (s: number | null, spy: number | null) =>
        s != null && spy != null ? r2(s - spy) : null

      const a30  = alpha(r30,  sr30);  const a60  = alpha(r60,  sr60)
      const a90  = alpha(r90,  sr90);  const a180 = alpha(r180, sr180)

      // signal_alpha: positive = insider was RIGHT (buys: alpha>0, sells: alpha<0)
      const sig = (a: number | null) => (a != null && direction === 'sell') ? r2(-a) : a

      const richTrade: RichTrade = {
        id:                trade.id,
        ticker,
        insider_name:      trade.insider_name  ?? '',
        insider_cik:       trade.insider_cik   ?? '',
        officer_title:     trade.officer_title ?? '',
        role:              trade.role          ?? '',
        role_classified:   classifyRole(trade.role ?? '', trade.officer_title ?? ''),
        transaction_code:  trade.transaction_code,
        direction,
        classification,
        transaction_date:  txDate,
        total_value:       totalValue,
        shares:            fn(trade.shares),
        price_per_share:   fn(trade.price_per_share),
        shares_owned_after: fn(trade.shares_owned_after),
        sector:            sectorMap.get(ticker) ?? 'Unknown',
        size_bucket:       sizeBucket(totalValue),
        price_entry:       priceEntry,
        price_30d: p30, price_60d: p60, price_90d: p90, price_180d: p180,
        return_30d: r30, return_60d: r60, return_90d: r90, return_180d: r180,
        spy_return_30d: sr30, spy_return_60d: sr60, spy_return_90d: sr90, spy_return_180d: sr180,
        alpha_30d: a30, alpha_60d: a60, alpha_90d: a90, alpha_180d: a180,
        signal_alpha_30d: sig(a30), signal_alpha_60d: sig(a60),
        signal_alpha_90d: sig(a90), signal_alpha_180d: sig(a180),
        direction_correct_90d:  a90  != null ? (direction === 'buy' ? a90 > 0 : a90 < 0) : null,
        direction_correct_180d: a180 != null ? (direction === 'buy' ? a180 > 0 : a180 < 0) : null,
      }

      partialStream.write(JSON.stringify(richTrade) + '\n')
      inserted++
    }

    completedTickers.add(ticker)
    process.stdout.write(`→ ${inserted} enriched\n`)

    // Save progress every 25 tickers
    if ((ti + 1) % 25 === 0) saveProgress()
  }

  partialStream.end()
  saveProgress()
  console.log(`\nAll tickers processed. Progress saved.`)

  // ── Step 6: merge existing + new trades, write outputs ───────────────────

  // Re-read partial.jsonl to get all trades (existing + newly appended)
  const allLines = fs.readFileSync(PARTIAL_F, 'utf-8').split('\n').filter(Boolean)
  const allTrades: RichTrade[] = allLines.map(l => JSON.parse(l))

  // Deduplicate by trade id (in case of partial resume overlap)
  const seen = new Set<string>()
  const trades = allTrades.filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true })

  console.log(`\nTotal enriched trades: ${trades.length.toLocaleString()}`)
  console.log(`  Buys:  ${trades.filter(t => t.direction === 'buy').length.toLocaleString()}`)
  console.log(`  Sells: ${trades.filter(t => t.direction === 'sell').length.toLocaleString()}`)
  for (const cls of ['OPPORTUNISTIC', 'ROUTINE', 'UNCLASSIFIABLE'] as Classification[]) {
    console.log(`  ${cls}: ${trades.filter(t => t.classification === cls).length.toLocaleString()}`)
  }

  // ── Write CSV ─────────────────────────────────────────────────────────────

  const csvLines = [
    CSV_COLS.join(','),
    ...trades.map(t => CSV_COLS.map(col => csvCell(t[col])).join(',')),
  ]
  fs.writeFileSync(CSV_OUT, csvLines.join('\n') + '\n', 'utf-8')
  console.log(`\nWrote CSV  → ${CSV_OUT}`)

  // ── Aggregate & write JSON ────────────────────────────────────────────────

  const buckets = aggregateBuckets(trades)

  const jsonOut = {
    generated_at:   new Date().toISOString(),
    cutoff_date:    CUTOFF_DATE,
    total_trades:   trades.length,
    total_buys:     trades.filter(t => t.direction === 'buy').length,
    total_sells:    trades.filter(t => t.direction === 'sell').length,
    classifications: {
      OPPORTUNISTIC:  trades.filter(t => t.classification === 'OPPORTUNISTIC').length,
      ROUTINE:        trades.filter(t => t.classification === 'ROUTINE').length,
      UNCLASSIFIABLE: trades.filter(t => t.classification === 'UNCLASSIFIABLE').length,
    },
    buckets,
  }

  fs.writeFileSync(JSON_OUT, JSON.stringify(jsonOut, null, 2), 'utf-8')
  console.log(`Wrote JSON → ${JSON_OUT}`)

  // ── Console summary ───────────────────────────────────────────────────────

  printSummary(trades, buckets)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
