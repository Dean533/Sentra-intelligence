// Run with:  npx tsx scripts/size-matched-alpha.ts
//
// Re-derives alpha using size-matched benchmarks instead of SPY-only:
//   Micro/Small (<$2B PIT market cap)  →  IWM  (Russell 2000)
//   Mid          ($2-10B PIT)          →  MDY  (S&P MidCap 400)
//   Large/Mega   (>$10B PIT)           →  SPY  (already in CSV)
//
// Reads the existing backtest-universe.csv (has spy_return_180d per row).
// Fetches MDY and IWM price histories from Yahoo Finance.
// Computes size_matched_alpha_180d = return_180d - matched_benchmark_return.
//
// Prints two tables, each with SPY alpha vs size-matched alpha side-by-side:
//   1. Classification × Direction (all 6 combos)
//   2. OPP BUY by PIT market-cap tier

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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (ch === ',' && !inQ) { fields.push(cur); cur = '' }
    else cur += ch
  }
  fields.push(cur); return fields
}

function pn(v: string): number | null {
  const f = parseFloat(v); return isNaN(f) ? null : f
}

// ─── Price map helpers ────────────────────────────────────────────────────────

function buildPriceMap(quotes: any[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date != null && (q?.adjClose ?? q?.close) != null) {
      const d = new Date(q.date).toISOString().split('T')[0]
      map.set(d, q.adjClose ?? q.close)
    }
  }
  return map
}

function lookupPrice(map: Map<string, number>, dateStr: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(dateStr)
    d.setUTCDate(d.getUTCDate() + i)
    const p = map.get(d.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

function benchmarkReturn(map: Map<string, number>, entryDate: string, days: number): number | null {
  const p0 = lookupPrice(map, entryDate)
  const p1 = lookupPrice(map, addDays(entryDate, days))
  if (p0 == null || p1 == null || p0 === 0) return null
  return Math.round(((p1 - p0) / p0) * 10000) / 100
}

// ─── PIT market cap helpers ───────────────────────────────────────────────────

function pitTier(mc: number | null): string {
  if (mc == null)    return 'No data'
  if (mc < 300e6)    return 'Micro <$300M'
  if (mc < 2e9)      return 'Small $300M-2B'
  if (mc < 10e9)     return 'Mid $2-10B'
  if (mc < 200e9)    return 'Large $10-200B'
  return               'Mega >$200B'
}

function benchmarkForTier(tier: string): 'SPY' | 'MDY' | 'IWM' {
  if (tier === 'Large $10-200B' || tier === 'Mega >$200B') return 'SPY'
  if (tier === 'Mid $2-10B')                               return 'MDY'
  return                                                     'IWM'  // Micro/Small/No data
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mean(arr: number[]): number | null {
  if (!arr.length) return null
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

function r2(v: number | null): string {
  if (v == null) return '  N/A  '
  const s = (Math.round(v * 100) / 100).toFixed(2)
  return (v >= 0 ? '+' : '') + s + '%'
}

function r2n(v: number | null): number | null {
  if (v == null) return null
  return Math.round(v * 100) / 100
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')

  // ── Load CSV ──────────────────────────────────────────────────────────────
  console.log('Reading backtest CSV...')
  const lines   = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx     = (n: string) => headers.indexOf(n)

  const C = {
    ticker:           idx('ticker'),
    classification:   idx('classification'),
    direction:        idx('direction'),
    transaction_date: idx('transaction_date'),
    price_entry:      idx('price_entry'),
    return_180d:      idx('return_180d'),
    spy_return_180d:  idx('spy_return_180d'),
    alpha_180d:       idx('alpha_180d'),
  }
  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing columns:', missing); process.exit(1) }

  type Row = {
    ticker: string; classification: string; direction: string
    transaction_date: string; price_entry: number | null
    return_180d: number | null; spy_return_180d: number | null; alpha_180d: number | null
    // computed:
    pit_tier?: string; benchmark?: 'SPY'|'MDY'|'IWM'
    bm_return_180d?: number | null
    size_matched_alpha_180d?: number | null
  }

  const allRows: Row[] = lines.slice(1).map(l => {
    const f = parseCsvLine(l)
    return {
      ticker:           f[C.ticker]           ?? '',
      classification:   f[C.classification]   ?? '',
      direction:        f[C.direction]        ?? '',
      transaction_date: f[C.transaction_date] ?? '',
      price_entry:      pn(f[C.price_entry]),
      return_180d:      pn(f[C.return_180d]),
      spy_return_180d:  pn(f[C.spy_return_180d]),
      alpha_180d:       pn(f[C.alpha_180d]),
    }
  })
  console.log(`  ${allRows.length.toLocaleString()} rows loaded`)

  // ── Fetch market caps for PIT tier ────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap = new Map<string, number | null>()
  const tickers = [...new Set(allRows.map(r => r.ticker))]
  for (let i = 0; i < tickers.length; i += 500) {
    const { data } = await supabase.from('tickers').select('symbol,market_cap').in('symbol', tickers.slice(i, i + 500))
    for (const r of data ?? []) mcMap.set((r as any).symbol, (r as any).market_cap ?? null)
  }
  console.log(`  ${[...mcMap.values()].filter(v => v != null).length}/${tickers.length} with market cap`)

  // Latest price_entry per ticker (proxy for current price)
  const latestPrice = new Map<string, number>()
  for (const r of allRows) {
    if (r.price_entry != null) {
      const cur = latestPrice.get(r.ticker)
      if (!cur || r.price_entry > cur) latestPrice.set(r.ticker, r.price_entry)
    }
  }

  // Assign PIT tier to every row
  for (const r of allRows) {
    const mc_today = mcMap.get(r.ticker) ?? null
    const p_today  = latestPrice.get(r.ticker) ?? null
    let mc_pit: number | null = null
    if (mc_today != null && p_today != null && p_today > 0 && r.price_entry != null && r.price_entry > 0) {
      mc_pit = (mc_today / p_today) * r.price_entry
    }
    r.pit_tier  = pitTier(mc_pit)
    r.benchmark = benchmarkForTier(r.pit_tier)
  }

  // ── Fetch MDY and IWM price histories ─────────────────────────────────────
  const allDates = allRows.map(r => r.transaction_date).filter(Boolean).sort()
  const dateStart = new Date('2021-01-01')
  const dateEnd   = new Date(addDays(allDates[allDates.length - 1], 195))

  console.log(`\nFetching MDY  ${dateStart.toISOString().split('T')[0]} → ${dateEnd.toISOString().split('T')[0]}...`)
  await sleep(300)
  let mdyMap = new Map<string, number>()
  try {
    const chart: any = await yf.chart('MDY', { period1: dateStart, period2: dateEnd, interval: '1d' })
    mdyMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${mdyMap.size} MDY price points`)
  } catch (err: any) { console.error('MDY fetch failed:', err.message); process.exit(1) }

  await sleep(300)
  console.log('Fetching IWM...')
  let iwmMap = new Map<string, number>()
  try {
    const chart: any = await yf.chart('IWM', { period1: dateStart, period2: dateEnd, interval: '1d' })
    iwmMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${iwmMap.size} IWM price points`)
  } catch (err: any) { console.error('IWM fetch failed:', err.message); process.exit(1) }

  // ── Compute size-matched alpha per row ────────────────────────────────────
  let noMatch = 0
  for (const r of allRows) {
    let bm_ret: number | null = null
    if (r.benchmark === 'SPY') {
      // Already computed in CSV
      bm_ret = r.spy_return_180d ?? null
    } else if (r.benchmark === 'MDY') {
      bm_ret = benchmarkReturn(mdyMap, r.transaction_date, 180)
    } else {
      bm_ret = benchmarkReturn(iwmMap, r.transaction_date, 180)
    }
    r.bm_return_180d = bm_ret
    if (r.return_180d != null && bm_ret != null) {
      r.size_matched_alpha_180d = r2n(r.return_180d - bm_ret)
    } else {
      r.size_matched_alpha_180d = null
      if (r.return_180d != null) noMatch++
    }
  }
  console.log(`\nSize-matched alpha computed. Missing benchmark: ${noMatch} rows`)

  // ─── Print Table 1: Classification × Direction ───────────────────────────

  const CLS_DIR: [string, string][] = [
    ['OPPORTUNISTIC',  'buy'],  ['OPPORTUNISTIC',  'sell'],
    ['ROUTINE',        'buy'],  ['ROUTINE',        'sell'],
    ['UNCLASSIFIABLE', 'buy'],  ['UNCLASSIFIABLE', 'sell'],
  ]

  type Stats = {
    n: number
    spy_med: number | null; spy_mean: number | null
    sm_med:  number | null; sm_mean:  number | null
    lift_med: number | null
  }

  function calcStats(rows: Row[]): Stats {
    const spyArr = rows.map(r => r.alpha_180d).filter((v): v is number => v != null)
    const smArr  = rows.map(r => r.size_matched_alpha_180d).filter((v): v is number => v != null)
    return {
      n:        rows.length,
      spy_med:  median(spyArr),
      spy_mean: mean(spyArr),
      sm_med:   median(smArr),
      sm_mean:  mean(smArr),
      lift_med: (median(smArr) != null && median(spyArr) != null)
        ? r2n(median(smArr)! - median(spyArr)!)
        : null,
    }
  }

  const rowMap = new Map<string, Row[]>()
  for (const [cls, dir] of CLS_DIR) rowMap.set(`${cls}|${dir}`, [])
  for (const r of allRows) rowMap.get(`${r.classification}|${r.direction}`)?.push(r)

  console.log('\n' + '═'.repeat(100))
  console.log('TABLE 1 — CLASSIFICATION × DIRECTION  (180d alpha: SPY-only vs size-matched)')
  console.log('  IWM = Micro/Small <$2B PIT  |  MDY = Mid $2-10B PIT  |  SPY = Large/Mega >$10B PIT')
  console.log('═'.repeat(100))
  const H1 = '  ' + 'Group'.padEnd(30) + 'n'.padStart(7) +
    '  SPY med α'.padStart(11) + '  SPY mean α'.padStart(12) +
    '  SM med α'.padStart(11)  + '  SM mean α'.padStart(12)  +
    '  lift (med)'.padStart(13)
  console.log(H1)
  console.log('  ' + '─'.repeat(98))

  const table1Results: Array<{ label: string } & Stats> = []
  for (const [cls, dir] of CLS_DIR) {
    const rows  = rowMap.get(`${cls}|${dir}`) ?? []
    const s     = calcStats(rows)
    const label = `${cls} ${dir}`
    table1Results.push({ label, ...s })
    console.log(
      '  ' + label.padEnd(30) +
      String(s.n).padStart(7) +
      r2(s.spy_med).padStart(11)  + r2(s.spy_mean).padStart(12) +
      r2(s.sm_med).padStart(11)   + r2(s.sm_mean).padStart(12)  +
      r2(s.lift_med).padStart(13)
    )
  }
  console.log()

  // ─── Print Table 2: OPP BUY by PIT tier ──────────────────────────────────

  const oppBuys = allRows.filter(r => r.classification === 'OPPORTUNISTIC' && r.direction === 'buy')
  const PIT_ORDER = ['Micro <$300M', 'Small $300M-2B', 'Mid $2-10B', 'Large $10-200B', 'Mega >$200B', 'No data']

  console.log('═'.repeat(100))
  console.log('TABLE 2 — OPP BUY by PIT MARKET-CAP TIER (size-matched benchmarks)')
  console.log('  Micro/Small → IWM  |  Mid → MDY  |  Large/Mega → SPY (unchanged)')
  console.log('═'.repeat(100))
  console.log(H1 + '  benchmark')
  console.log('  ' + '─'.repeat(110))

  for (const tier of PIT_ORDER) {
    const rows = oppBuys.filter(r => r.pit_tier === tier)
    if (!rows.length) continue
    const s   = calcStats(rows)
    const bm  = benchmarkForTier(tier)
    console.log(
      '  ' + tier.padEnd(30) +
      String(s.n).padStart(7) +
      r2(s.spy_med).padStart(11)  + r2(s.spy_mean).padStart(12) +
      r2(s.sm_med).padStart(11)   + r2(s.sm_mean).padStart(12)  +
      r2(s.lift_med).padStart(13) +
      ('  [' + bm + ']').padStart(9)
    )
  }
  console.log()

  // ─── Benchmark cumulative returns over the study period ──────────────────
  // Shows how much the drift affects the alpha calculation overall.

  console.log('═'.repeat(100))
  console.log('BENCHMARK CUMULATIVE RETURNS  2021-01-01 → 2025-06-20 (approx study period)')
  console.log('═'.repeat(100))

  const studyStart = '2021-01-01'
  const studyEnd   = '2025-06-20'

  function cumulReturn(map: Map<string, number>, from: string, to: string): string {
    const p0 = lookupPrice(map, from)
    const p1 = lookupPrice(map, to)
    if (!p0 || !p1) return 'N/A'
    return r2((p1 - p0) / p0 * 100)
  }

  // For SPY, rebuild from CSV: spy_return is per-trade, not easy to reconstruct period return.
  // Fetch SPY directly for the comparison too.
  await sleep(300)
  console.log('Fetching SPY for cumulative comparison...')
  let spyMap = new Map<string, number>()
  try {
    const chart: any = await yf.chart('SPY', { period1: new Date(studyStart), period2: new Date(), interval: '1d' })
    spyMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
  } catch (err: any) { console.error('SPY fetch failed:', err.message) }

  console.log(`  SPY 2021→2025:  ${cumulReturn(spyMap, studyStart, studyEnd)}`)
  console.log(`  MDY 2021→2025:  ${cumulReturn(mdyMap, studyStart, studyEnd)}`)
  console.log(`  IWM 2021→2025:  ${cumulReturn(iwmMap, studyStart, studyEnd)}`)
  console.log()
  console.log('  → Alpha "lift" for Micro/Small = (IWM benchmark replaces SPY benchmark)')
  console.log('    IWM underperformed SPY by ~' + (() => {
    const spy = parseFloat(cumulReturn(spyMap, studyStart, studyEnd) ?? '0')
    const iwm = parseFloat(cumulReturn(iwmMap, studyStart, studyEnd) ?? '0')
    return (spy - iwm).toFixed(1)
  })() + '% cumulative over this period.')
  console.log()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
