// Run with:  npx tsx scripts/backtest-unclassifiable.ts
// Output:    output/unclassifiable_backtest.csv  +  console summary
//
// Fetches all purchases (transaction_code = 'P') by insiders whose CIK does
// NOT appear in insider_classifications with classification = 'OPPORTUNISTIC'
// or 'ROUTINE', then computes SPY-adjusted alpha at 30/60/90/120/150/180d.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env.local not found at', envPath)
    process.exit(1)
  }
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

const DELAY_MS  = 200
const PAGE_SIZE = 1000
const HOLD_DAYS = [30, 60, 90, 120, 150, 180] as const
const CSV_OUT   = path.join(__dirname, '..', 'output', 'unclassifiable_backtest.csv')

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function addDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

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

function fn(s: string | number | null | undefined): number | null {
  if (s == null) return null
  const v = typeof s === 'number' ? s : parseFloat(s)
  return isNaN(v) ? null : v
}

function r2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Supabase paginator ───────────────────────────────────────────────────────

async function fetchAll<T>(
  table: string,
  selectStr: string,
  filters: (q: any) => any
): Promise<T[]> {
  const rows: T[] = []
  let from = 0
  while (true) {
    const q = supabase.from(table).select(selectStr)
    const filtered = filters(q)
    const { data, error } = await filtered.range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`fetchAll ${table}: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function mean(arr: number[]): number | null {
  return arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function hitRate(arr: number[]): number | null {
  return arr.length === 0 ? null : arr.filter(v => v > 0).length / arr.length
}

// ─── Role classifier (identical to deep-analysis-v2.ts) ──────────────────────

function classifyRole(role: string, title: string): string {
  const r = role.toLowerCase(), t = title.toLowerCase()
  if (r.includes('ceo') || r.includes('chief executive') || t.includes('ceo') || t.includes('chief executive')) return 'CEO'
  if (r.includes('cfo') || r.includes('chief financial') || t.includes('cfo') || t.includes('chief financial')) return 'CFO'
  if (r.includes('president') || t.includes('president')) return 'President'
  if (r.includes('director')) return 'Director'
  if (r.includes('10%') || r.includes('10% owner')) return '10% Owner'
  if (r.includes('co-founder')) return 'Co-Founder/Partner'
  if (r.includes('insider')) return 'Insider (other)'
  return 'Other/EVP'
}

// ─── Drawdown (identical to deep-analysis-v2.ts) ─────────────────────────────

function calcDrawdown30(
  priceMap: Map<string, number>,
  txDate: string,
  entryPrice: number
): { maxDrawdownPct: number; daysToMin: number } | null {
  let minPrice = entryPrice
  let daysToMin = 0
  let tradingDays = 0
  for (let day = 0; day <= 30; day++) {
    const d = new Date(txDate)
    d.setUTCDate(d.getUTCDate() + day)
    const price = priceMap.get(isoDate(d))
    if (price != null) {
      tradingDays++
      if (price < minPrice) { minPrice = price; daysToMin = day }
    }
  }
  if (tradingDays < 5) return null
  return {
    maxDrawdownPct: r2(((minPrice - entryPrice) / entryPrice) * 100),
    daysToMin,
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type RichTrade = {
  id: string; ticker: string; insider_name: string; insider_cik: string
  officer_title: string; role: string; role_classified: string
  transaction_date: string; total_value: string; shares: string
  price_per_share: string; shares_owned_after: string
  sector: string
  price_entry:  number | null
  price_30d:    number | null; price_60d:  number | null; price_90d:  number | null
  price_120d:   number | null; price_150d: number | null; price_180d: number | null
  return_30d:   number | null; return_60d:  number | null; return_90d:  number | null
  return_120d:  number | null; return_150d: number | null; return_180d: number | null
  signal_correct_30d: boolean | null; signal_correct_90d: boolean | null; signal_correct_180d: boolean | null
  spy_return_30d:   number | null; spy_return_60d:  number | null; spy_return_90d:  number | null
  spy_return_120d:  number | null; spy_return_150d: number | null; spy_return_180d: number | null
  adjusted_return_30d:  number | null; adjusted_return_60d:  number | null; adjusted_return_90d:  number | null
  adjusted_return_120d: number | null; adjusted_return_150d: number | null; adjusted_return_180d: number | null
  max_drawdown_30d: number | null; days_to_min_30d: number | null; recovered_by_90d: boolean | null
}

const OUT_COLS: (keyof RichTrade)[] = [
  'id', 'ticker', 'insider_name', 'insider_cik', 'officer_title', 'role', 'role_classified',
  'transaction_date', 'total_value', 'shares', 'price_per_share', 'shares_owned_after',
  'sector',
  'price_entry', 'price_30d', 'price_60d', 'price_90d', 'price_120d', 'price_150d', 'price_180d',
  'return_30d', 'return_60d', 'return_90d', 'return_120d', 'return_150d', 'return_180d',
  'signal_correct_30d', 'signal_correct_90d', 'signal_correct_180d',
  'spy_return_30d', 'spy_return_60d', 'spy_return_90d', 'spy_return_120d', 'spy_return_150d', 'spy_return_180d',
  'adjusted_return_30d', 'adjusted_return_60d', 'adjusted_return_90d', 'adjusted_return_120d', 'adjusted_return_150d', 'adjusted_return_180d',
  'max_drawdown_30d', 'days_to_min_30d', 'recovered_by_90d',
]

// ─── Analysis helpers ─────────────────────────────────────────────────────────

type GroupStats = {
  n: number
  hitRate90: number | null; medAlpha90: number | null; meanAlpha90: number | null
  hitRate180: number | null; medAlpha180: number | null; meanAlpha180: number | null
  avgDrawdown30: number | null
}

function groupStats(trades: RichTrade[]): GroupStats {
  const a90  = trades.map(t => t.adjusted_return_90d).filter((v): v is number => v != null)
  const a180 = trades.map(t => t.adjusted_return_180d).filter((v): v is number => v != null)
  const dd   = trades.map(t => t.max_drawdown_30d).filter((v): v is number => v != null)
  return {
    n: trades.length,
    hitRate90:    hitRate(a90),
    medAlpha90:   median(a90),
    meanAlpha90:  mean(a90),
    hitRate180:   hitRate(a180),
    medAlpha180:  median(a180),
    meanAlpha180: mean(a180),
    avgDrawdown30: mean(dd),
  }
}

function fmtPct(n: number | null, dp = 1): string {
  if (n == null) return '  N/A '
  return (n >= 0 ? '+' : '') + n.toFixed(dp) + '%'
}

function fmtHit(n: number | null): string {
  return n == null ? ' N/A' : (n * 100).toFixed(0) + '%'
}

// ─── Console summary ──────────────────────────────────────────────────────────

function printAnalysis(trades: RichTrade[]) {
  const SEP  = '═'.repeat(84)
  const DASH = '─'.repeat(84)

  console.log('\n' + SEP)
  console.log('  BACKTEST — UNCLASSIFIABLE INSIDER PURCHASES')
  console.log(`  ${trades.length} trades  ·  run date: ${new Date().toISOString().split('T')[0]}`)
  console.log(SEP)

  // ── 1. OPTIMAL HOLD PERIOD ────────────────────────────────────────────────

  console.log('\n── OPTIMAL HOLD PERIOD (all trades with data at each interval) ──────────────')
  console.log(`  ${'Period'.padEnd(8)} ${'n'.padStart(5)}  ${'Hit'.padStart(5)}  ${'Avg Raw'.padStart(8)}  ${'Avg Alpha'.padStart(10)}  ${'Med Alpha'.padStart(10)}`)
  console.log('  ' + '─'.repeat(54))

  for (const days of HOLD_DAYS) {
    const retKey   = `return_${days}d`          as keyof RichTrade
    const alphaKey = `adjusted_return_${days}d` as keyof RichTrade
    const raws   = trades.map(t => t[retKey]   as number | null).filter((v): v is number => v != null)
    const alphas = trades.map(t => t[alphaKey] as number | null).filter((v): v is number => v != null)
    const hit = hitRate(alphas)
    console.log(
      `  ${(days + 'd').padEnd(8)} ${String(alphas.length).padStart(5)}  ${fmtHit(hit).padStart(5)}  ` +
      `${fmtPct(mean(raws)).padStart(8)}  ${fmtPct(mean(alphas)).padStart(10)}  ${fmtPct(median(alphas)).padStart(10)}`
    )
  }

  // ── 2. DRAWDOWN ANALYSIS ──────────────────────────────────────────────────

  const withDD = trades.filter(t => t.max_drawdown_30d != null)
  console.log('\n' + DASH)
  console.log('── DRAWDOWN ANALYSIS — First 30 Calendar Days ───────────────────────────────')
  console.log(DASH)
  console.log(`  Trades with drawdown data : ${withDD.length}`)

  const dds    = withDD.map(t => t.max_drawdown_30d!)
  const anyDip = withDD.filter(t => t.max_drawdown_30d! < -0.5)
  console.log(`  Had early dip (> 0.5%)    : ${anyDip.length} / ${withDD.length} (${(anyDip.length / withDD.length * 100).toFixed(0)}%)`)
  console.log(`  Mean max drawdown         : ${fmtPct(mean(dds))}`)
  console.log(`  Median max drawdown       : ${fmtPct(median(dds))}`)

  const recov     = withDD.filter(t => t.recovered_by_90d != null)
  const recovRate = recov.filter(t => t.recovered_by_90d).length / recov.length
  console.log(`  Recovered above entry@90d : ${(recovRate * 100).toFixed(0)}% of ${recov.length} trades`)

  const ddBuckets: Array<{ label: string; fn: (dd: number) => boolean }> = [
    { label: 'No dip (0%)',  fn: dd => dd >= -0.5 },
    { label: 'Dip < 2%',    fn: dd => dd < -0.5 && dd >= -2 },
    { label: 'Dip 2–5%',    fn: dd => dd < -2   && dd >= -5 },
    { label: 'Dip 5–10%',   fn: dd => dd < -5   && dd >= -10 },
    { label: 'Dip > 10%',   fn: dd => dd < -10 },
  ]

  console.log()
  console.log(`  ${'Dip bucket'.padEnd(16)} ${'n'.padStart(4)}  ${'Recov@90d'.padStart(9)}  ${'90d α-med'.padStart(10)}  ${'180d α-med'.padStart(11)}  ${'Avg days-to-min'.padStart(15)}`)
  console.log('  ' + '─'.repeat(72))

  for (const b of ddBuckets) {
    const sub = withDD.filter(t => b.fn(t.max_drawdown_30d!))
    if (!sub.length) continue
    const rec    = sub.filter(t => t.recovered_by_90d != null)
    const recPct = rec.length > 0 ? (rec.filter(t => t.recovered_by_90d).length / rec.length * 100).toFixed(0) + '%' : 'N/A'
    const a90s   = sub.map(t => t.adjusted_return_90d).filter((v): v is number => v != null)
    const a180s  = sub.map(t => t.adjusted_return_180d).filter((v): v is number => v != null)
    const daysArr = sub.map(t => t.days_to_min_30d).filter((v): v is number => v != null)
    console.log(
      `  ${b.label.padEnd(16)} ${String(sub.length).padStart(4)}  ${recPct.padStart(9)}  ` +
      `${fmtPct(median(a90s)).padStart(10)}  ${fmtPct(median(a180s)).padStart(11)}  ${(mean(daysArr) ?? 0).toFixed(1).padStart(15)}`
    )
  }

  // ── 3. BY SECTOR ──────────────────────────────────────────────────────────

  console.log('\n' + DASH)
  console.log('── BY SECTOR (≥4 trades, sorted by 90d median alpha) ────────────────────────')
  console.log(DASH)
  console.log(
    `  ${'Sector'.padEnd(28)} ${'n'.padStart(4)}  ` +
    `${'90d Hit'.padStart(7)}  ${'90d α-med'.padStart(10)}  ` +
    `${'180d Hit'.padStart(8)}  ${'180d α-med'.padStart(11)}  ${'Avg DD30'.padStart(8)}`
  )
  console.log('  ' + '─'.repeat(80))

  const bySector: Record<string, RichTrade[]> = {}
  for (const t of trades) (bySector[t.sector || 'Unknown'] ??= []).push(t)

  const sectorRows = Object.entries(bySector)
    .filter(([, g]) => g.length >= 4)
    .map(([sector, g]) => ({ sector, ...groupStats(g) }))
    .sort((a, b) => (b.medAlpha90 ?? -99) - (a.medAlpha90 ?? -99))

  for (const s of sectorRows) {
    console.log(
      `  ${s.sector.padEnd(28)} ${String(s.n).padStart(4)}  ` +
      `${fmtHit(s.hitRate90).padStart(7)}  ${fmtPct(s.medAlpha90).padStart(10)}  ` +
      `${fmtHit(s.hitRate180).padStart(8)}  ${fmtPct(s.medAlpha180).padStart(11)}  ${fmtPct(s.avgDrawdown30).padStart(8)}`
    )
  }

  // ── 4. BY ROLE ────────────────────────────────────────────────────────────

  console.log('\n' + DASH)
  console.log('── BY ROLE ──────────────────────────────────────────────────────────────────')
  console.log(DASH)
  console.log(
    `  ${'Role'.padEnd(22)} ${'n'.padStart(4)}  ` +
    `${'90d Hit'.padStart(7)}  ${'90d α-med'.padStart(10)}  ${'90d α-mean'.padStart(11)}  ` +
    `${'180d Hit'.padStart(8)}  ${'180d α-med'.padStart(11)}  ${'180d α-mean'.padStart(12)}`
  )
  console.log('  ' + '─'.repeat(88))

  const byRole: Record<string, RichTrade[]> = {}
  for (const t of trades) (byRole[t.role_classified] ??= []).push(t)

  const roleOrder = ['CEO', 'CFO', 'President', 'Director', '10% Owner', 'Co-Founder/Partner', 'Insider (other)', 'Other/EVP']
  for (const role of roleOrder) {
    const g = byRole[role]
    if (!g) continue
    const s = groupStats(g)
    console.log(
      `  ${role.padEnd(22)} ${String(s.n).padStart(4)}  ` +
      `${fmtHit(s.hitRate90).padStart(7)}  ${fmtPct(s.medAlpha90).padStart(10)}  ${fmtPct(s.meanAlpha90).padStart(11)}  ` +
      `${fmtHit(s.hitRate180).padStart(8)}  ${fmtPct(s.medAlpha180).padStart(11)}  ${fmtPct(s.meanAlpha180).padStart(12)}`
    )
  }

  // ── 5. BY DOLLAR SIZE ─────────────────────────────────────────────────────

  console.log('\n' + DASH)
  console.log('── BY DOLLAR SIZE ───────────────────────────────────────────────────────────')
  console.log(DASH)
  console.log(
    `  ${'Size bucket'.padEnd(18)} ${'n'.padStart(4)}  ` +
    `${'90d Hit'.padStart(7)}  ${'90d α-med'.padStart(10)}  ${'90d α-mean'.padStart(11)}  ` +
    `${'180d Hit'.padStart(8)}  ${'180d α-med'.padStart(11)}  ${'180d α-mean'.padStart(12)}`
  )
  console.log('  ' + '─'.repeat(84))

  const sizeBuckets: Array<{ label: string; fn: (v: number) => boolean }> = [
    { label: '$100K–250K',  fn: v => v >= 100_000   && v < 250_000 },
    { label: '$250K–500K',  fn: v => v >= 250_000   && v < 500_000 },
    { label: '$500K–1M',    fn: v => v >= 500_000   && v < 1_000_000 },
    { label: '$1M–5M',      fn: v => v >= 1_000_000 && v < 5_000_000 },
    { label: '$5M–25M',     fn: v => v >= 5_000_000 && v < 25_000_000 },
    { label: '$25M+',       fn: v => v >= 25_000_000 },
  ]

  for (const b of sizeBuckets) {
    const g = trades.filter(t => { const v = fn(t.total_value); return v != null && b.fn(v) })
    if (!g.length) continue
    const s = groupStats(g)
    console.log(
      `  ${b.label.padEnd(18)} ${String(s.n).padStart(4)}  ` +
      `${fmtHit(s.hitRate90).padStart(7)}  ${fmtPct(s.medAlpha90).padStart(10)}  ${fmtPct(s.meanAlpha90).padStart(11)}  ` +
      `${fmtHit(s.hitRate180).padStart(8)}  ${fmtPct(s.medAlpha180).padStart(11)}  ${fmtPct(s.meanAlpha180).padStart(12)}`
    )
  }

  // ── 6. BEST COMBINED FILTERS ──────────────────────────────────────────────

  console.log('\n' + DASH)
  console.log('── BEST COMBINED FILTERS (by 90d median alpha) ──────────────────────────────')
  console.log(DASH)
  console.log(
    `  ${'Filter'.padEnd(42)} ${'n'.padStart(4)}  ` +
    `${'90d Hit'.padStart(7)}  ${'90d α-med'.padStart(10)}  ${'180d α-med'.padStart(11)}`
  )
  console.log('  ' + '─'.repeat(78))

  const valGte = (t: RichTrade, min: number) => { const v = fn(t.total_value); return v != null && v >= min }
  const roles  = (t: RichTrade, ...r: string[]) => r.includes(t.role_classified)

  const combos: Array<{ label: string; filter: (t: RichTrade) => boolean }> = [
    { label: 'All',                              filter: () => true },
    { label: '>= $500K',                         filter: t => valGte(t, 500_000) },
    { label: '>= $1M',                           filter: t => valGte(t, 1_000_000) },
    { label: '>= $500K + CEO',                   filter: t => valGte(t, 500_000)   && roles(t, 'CEO') },
    { label: '>= $500K + CFO',                   filter: t => valGte(t, 500_000)   && roles(t, 'CFO') },
    { label: '>= $500K + Director',              filter: t => valGte(t, 500_000)   && roles(t, 'Director') },
    { label: '>= $1M + CEO',                     filter: t => valGte(t, 1_000_000) && roles(t, 'CEO') },
    { label: '>= $1M + CEO/CFO',                 filter: t => valGte(t, 1_000_000) && roles(t, 'CEO', 'CFO') },
    { label: '>= $1M + 10% Owner',               filter: t => valGte(t, 1_000_000) && roles(t, '10% Owner') },
    { label: 'CEO + no drawdown > 5%',           filter: t => roles(t, 'CEO') && (t.max_drawdown_30d == null || t.max_drawdown_30d >= -5) },
    { label: '>= $500K + no drawdown > 5%',      filter: t => valGte(t, 500_000) && (t.max_drawdown_30d == null || t.max_drawdown_30d >= -5) },
    { label: '>= $1M + CEO + no drawdown > 5%',  filter: t => valGte(t, 1_000_000) && roles(t, 'CEO') && (t.max_drawdown_30d == null || t.max_drawdown_30d >= -5) },
    { label: 'Recovered by 90d + >= $250K',      filter: t => t.recovered_by_90d === true && valGte(t, 250_000) },
    { label: '10% Owner',                        filter: t => roles(t, '10% Owner') },
  ]

  for (const c of combos) {
    const g = trades.filter(c.filter)
    if (!g.length) continue
    const s = groupStats(g)
    console.log(
      `  ${c.label.padEnd(42)} ${String(s.n).padStart(4)}  ` +
      `${fmtHit(s.hitRate90).padStart(7)}  ${fmtPct(s.medAlpha90).padStart(10)}  ${fmtPct(s.medAlpha180).padStart(11)}`
    )
  }

  // ── 7. TOP INSIDERS (≥5 trades, by 90d median alpha) ─────────────────────

  console.log('\n' + DASH)
  console.log('── TOP INSIDERS ≥5 TRADES (by 90d median alpha) ─────────────────────────────')
  console.log(DASH)
  console.log(
    `  ${'Insider'.padEnd(28)} ${'n'.padStart(4)}  ` +
    `${'90d Hit'.padStart(7)}  ${'90d α-med'.padStart(10)}  ${'180d Hit'.padStart(8)}  ${'180d α-med'.padStart(11)}`
  )
  console.log('  ' + '─'.repeat(72))

  const byInsider: Record<string, RichTrade[]> = {}
  for (const t of trades) (byInsider[t.insider_name] ??= []).push(t)

  const insiderRows = Object.entries(byInsider)
    .filter(([, g]) => g.length >= 5)
    .map(([name, g]) => ({ name, ...groupStats(g) }))
    .sort((a, b) => (b.medAlpha90 ?? -99) - (a.medAlpha90 ?? -99))

  for (const row of insiderRows.slice(0, 15)) {
    console.log(
      `  ${row.name.slice(0, 27).padEnd(28)} ${String(row.n).padStart(4)}  ` +
      `${fmtHit(row.hitRate90).padStart(7)}  ${fmtPct(row.medAlpha90).padStart(10)}  ` +
      `${fmtHit(row.hitRate180).padStart(8)}  ${fmtPct(row.medAlpha180).padStart(11)}`
    )
  }

  console.log('\n' + SEP + '\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── Step 1: all classified CIKs (OPPORTUNISTIC + ROUTINE) ────────────────

  console.log('Fetching classified CIKs from insider_classifications...')
  const classifiedRows = await fetchAll<{ insider_cik: string }>(
    'insider_classifications',
    'insider_cik',
    q => q.in('classification', ['OPPORTUNISTIC', 'ROUTINE'])
  )
  const classifiedCiks = new Set(classifiedRows.map(r => r.insider_cik).filter(Boolean))
  console.log(`  ${classifiedCiks.size} classified CIKs (OPPORTUNISTIC + ROUTINE)`)

  // ── Step 2: all purchases ─────────────────────────────────────────────────

  console.log('Fetching all purchases from insider_transactions...')
  const allTrades = await fetchAll<{
    id: string; ticker: string; insider_name: string; insider_cik: string
    officer_title: string | null; role: string | null
    transaction_date: string; total_value: number | null
    shares: number | null; price_per_share: number | null; shares_owned_after: number | null
  }>(
    'insider_transactions',
    'id, ticker, insider_name, insider_cik, officer_title, role, transaction_date, total_value, shares, price_per_share, shares_owned_after',
    q => q.eq('transaction_code', 'P').order('transaction_date', { ascending: true })
  )
  console.log(`  ${allTrades.length} total purchases fetched`)

  // ── Step 3: filter to truly unclassifiable ────────────────────────────────

  const trades = allTrades.filter(t => t.insider_cik && !classifiedCiks.has(t.insider_cik))
  console.log(`  ${trades.length} purchases from unclassifiable insiders`)

  if (trades.length === 0) {
    console.log('Nothing to process.')
    process.exit(0)
  }

  // ── Step 4: sector map ────────────────────────────────────────────────────

  const allTickers = Array.from(new Set(trades.map(t => t.ticker)))
  const sectorMap: Record<string, string> = {}
  try {
    const { data: tickerMeta } = await supabase
      .from('tickers').select('symbol, sector').in('symbol', allTickers)
    for (const t of tickerMeta ?? []) sectorMap[(t as any).symbol] = (t as any).sector ?? 'Unknown'
    console.log(`Sector data loaded for ${Object.keys(sectorMap).length} tickers`)
  } catch (err: any) {
    console.warn(`Sector fetch failed (continuing without): ${err.message}`)
  }

  // ── Step 5: SPY price history ─────────────────────────────────────────────

  const allDates = trades.map(t => t.transaction_date).sort()
  const spyStart = new Date(allDates[0])
  const spyEnd   = addDays(allDates[allDates.length - 1], 190)

  console.log(`\nFetching SPY  ${isoDate(spyStart)} → ${isoDate(spyEnd)}...`)
  let spyMap = new Map<string, number>()
  try {
    await sleep(DELAY_MS)
    const chart: any = await yf.chart('SPY', { period1: spyStart, period2: spyEnd, interval: '1d' })
    spyMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${spyMap.size} SPY price points`)
  } catch (err: any) {
    console.error(`SPY fetch failed: ${err.message}`)
    process.exit(1)
  }

  // ── Step 6: group by ticker, fetch per-ticker prices ─────────────────────

  const byTicker = new Map<string, typeof trades>()
  for (const t of trades) {
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, [])
    byTicker.get(t.ticker)!.push(t)
  }

  const richTrades: RichTrade[] = []
  const tickerList = Array.from(byTicker.keys())

  for (let ti = 0; ti < tickerList.length; ti++) {
    const ticker    = tickerList[ti]
    const tickerTrades = byTicker.get(ticker)!

    const dates      = tickerTrades.map(t => t.transaction_date).sort()
    const rangeStart = new Date(dates[0])
    const rangeEnd   = addDays(dates[dates.length - 1], 190)

    process.stdout.write(`[${ti + 1}/${tickerList.length}] ${ticker.padEnd(6)} — ${tickerTrades.length} trade(s) ... `)

    let priceMap = new Map<string, number>()
    try {
      await sleep(DELAY_MS)
      const chart: any = await yf.chart(ticker, { period1: rangeStart, period2: rangeEnd, interval: '1d' })
      priceMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
      console.log(`${priceMap.size} price points`)
    } catch (err: any) {
      console.log(`⚠ ${err.message} — prices null`)
    }

    for (const trade of tickerTrades) {
      const txDate = trade.transaction_date

      const priceEntry = lookupPrice(priceMap, new Date(txDate))
      const price30d   = priceEntry != null ? lookupPrice(priceMap, addDays(txDate, 30))  : null
      const price60d   = priceEntry != null ? lookupPrice(priceMap, addDays(txDate, 60))  : null
      const price90d   = priceEntry != null ? lookupPrice(priceMap, addDays(txDate, 90))  : null
      const price120d  = priceEntry != null ? lookupPrice(priceMap, addDays(txDate, 120)) : null
      const price150d  = priceEntry != null ? lookupPrice(priceMap, addDays(txDate, 150)) : null
      const price180d  = priceEntry != null ? lookupPrice(priceMap, addDays(txDate, 180)) : null

      const ret30  = priceEntry && price30d  ? pct(priceEntry, price30d)  : null
      const ret60  = priceEntry && price60d  ? pct(priceEntry, price60d)  : null
      const ret90  = priceEntry && price90d  ? pct(priceEntry, price90d)  : null
      const ret120 = priceEntry && price120d ? pct(priceEntry, price120d) : null
      const ret150 = priceEntry && price150d ? pct(priceEntry, price150d) : null
      const ret180 = priceEntry && price180d ? pct(priceEntry, price180d) : null

      const spyEntry  = lookupPrice(spyMap, new Date(txDate))
      const spy30d    = spyEntry ? lookupPrice(spyMap, addDays(txDate, 30))  : null
      const spy60d    = spyEntry ? lookupPrice(spyMap, addDays(txDate, 60))  : null
      const spy90d    = spyEntry ? lookupPrice(spyMap, addDays(txDate, 90))  : null
      const spy120d   = spyEntry ? lookupPrice(spyMap, addDays(txDate, 120)) : null
      const spy150d   = spyEntry ? lookupPrice(spyMap, addDays(txDate, 150)) : null
      const spy180d   = spyEntry ? lookupPrice(spyMap, addDays(txDate, 180)) : null

      const spyRet30  = spyEntry && spy30d  ? pct(spyEntry, spy30d)  : null
      const spyRet60  = spyEntry && spy60d  ? pct(spyEntry, spy60d)  : null
      const spyRet90  = spyEntry && spy90d  ? pct(spyEntry, spy90d)  : null
      const spyRet120 = spyEntry && spy120d ? pct(spyEntry, spy120d) : null
      const spyRet150 = spyEntry && spy150d ? pct(spyEntry, spy150d) : null
      const spyRet180 = spyEntry && spy180d ? pct(spyEntry, spy180d) : null

      const alpha = (stock: number | null, spy: number | null) =>
        stock != null && spy != null ? r2(stock - spy) : null

      const dd = priceEntry != null ? calcDrawdown30(priceMap, txDate, priceEntry) : null

      richTrades.push({
        id:               trade.id,
        ticker:           trade.ticker,
        insider_name:     trade.insider_name,
        insider_cik:      trade.insider_cik,
        officer_title:    trade.officer_title ?? '',
        role:             trade.role ?? '',
        role_classified:  classifyRole(trade.role ?? '', trade.officer_title ?? ''),
        transaction_date: txDate,
        total_value:      String(trade.total_value ?? ''),
        shares:           String(trade.shares ?? ''),
        price_per_share:  String(trade.price_per_share ?? ''),
        shares_owned_after: String(trade.shares_owned_after ?? ''),
        sector:           sectorMap[ticker] ?? 'Unknown',
        price_entry:  priceEntry,
        price_30d: price30d, price_60d: price60d, price_90d: price90d, price_120d: price120d, price_150d: price150d, price_180d: price180d,
        return_30d:  ret30,  return_60d:  ret60,  return_90d:  ret90,
        return_120d: ret120, return_150d: ret150, return_180d: ret180,
        signal_correct_30d:  ret30  != null ? ret30  > 0 : null,
        signal_correct_90d:  ret90  != null ? ret90  > 0 : null,
        signal_correct_180d: ret180 != null ? ret180 > 0 : null,
        spy_return_30d:   spyRet30,  spy_return_60d:  spyRet60,  spy_return_90d:  spyRet90,
        spy_return_120d:  spyRet120, spy_return_150d: spyRet150, spy_return_180d: spyRet180,
        adjusted_return_30d:  alpha(ret30,  spyRet30),
        adjusted_return_60d:  alpha(ret60,  spyRet60),
        adjusted_return_90d:  alpha(ret90,  spyRet90),
        adjusted_return_120d: alpha(ret120, spyRet120),
        adjusted_return_150d: alpha(ret150, spyRet150),
        adjusted_return_180d: alpha(ret180, spyRet180),
        max_drawdown_30d:  dd?.maxDrawdownPct ?? null,
        days_to_min_30d:   dd?.daysToMin ?? null,
        recovered_by_90d:  ret90 != null ? ret90 >= 0 : null,
      })
    }
  }

  // ── Step 7: write CSV ─────────────────────────────────────────────────────

  fs.mkdirSync(path.dirname(CSV_OUT), { recursive: true })
  const csvLines = [
    OUT_COLS.join(','),
    ...richTrades.map(t => OUT_COLS.map(col => csvCell(t[col])).join(',')),
  ]
  fs.writeFileSync(CSV_OUT, csvLines.join('\n'), 'utf-8')
  console.log(`\nWrote ${richTrades.length} rows → ${CSV_OUT}`)

  printAnalysis(richTrades)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
