// Run with:  npx tsx scripts/portfolio-sim.ts
//
// Simulates $100 per OPPORTUNISTIC BUY signal, 180-day hold, independent bets.
// Uses SIZE-MATCHED benchmarks: Large/Mega→SPY, Mid→MDY, Micro/Small→IWM (PIT).
//
// ⚠ Retroactive 2026 CMP classification (lookahead bias) = OPTIMISTIC CEILING.
//    Not live performance. Research / calibration only.
//
// Outputs 4 sections:
//   1. By Track Record bucket  (LOO size-matched alpha)
//   2. By PIT Market Cap tier
//   3. By Role
//   4. By Sector (only sectors with positive mean size-matched alpha)

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
const yf  = new YahooFinance()
const slp = (ms: number) => new Promise(r => setTimeout(r, ms))

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

function pn(v: string): number | null { const f = parseFloat(v); return isNaN(f) ? null : f }

// ─── Price helpers ────────────────────────────────────────────────────────────

function buildPriceMap(quotes: any[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date != null && (q?.adjClose ?? q?.close) != null)
      m.set(new Date(q.date).toISOString().split('T')[0], q.adjClose ?? q.close)
  }
  return m
}

function lookupPrice(m: Map<string, number>, dateStr: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(dateStr); d.setUTCDate(d.getUTCDate() + i)
    const p = m.get(d.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

function addDays(s: string, n: number): string {
  const d = new Date(s); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

// ─── PIT + bucket helpers ────────────────────────────────────────────────────

function pitTier(mc: number | null): string {
  if (mc == null)    return 'No data'
  if (mc < 300e6)    return 'Micro <$300M'
  if (mc < 2e9)      return 'Small $300M-2B'
  if (mc < 10e9)     return 'Mid $2-10B'
  if (mc < 200e9)    return 'Large $10-200B'
  return               'Mega >$200B'
}

function stakeBucket(sh: number | null, after: number | null): string {
  if (sh == null || after == null || sh <= 0) return 'Unknown'
  const before = after - sh
  if (before <= 0) return 'New/Unknown'
  const pct = (sh / before) * 100
  if (pct < 10)  return '<10%'
  if (pct < 25)  return '10-25%'
  if (pct < 50)  return '25-50%'
  if (pct < 100) return '50-100%'
  return '>100% (doubled+)'
}

function trackBucket(loo: number | null): string {
  if (loo == null) return 'No prior trades'
  if (loo < 0)     return 'Negative avg'
  if (loo < 10)    return '0-10% avg'
  if (loo < 25)    return '10-25% avg'
  return             '>25% avg'
}

// ─── Simulation helpers ───────────────────────────────────────────────────────

const BET = 100

type SimRow = {
  strategy_end: number    // $100 × (1 + return_180d/100)
  benchmark_end: number   // $100 × (1 + bm_return/100)
  win: boolean            // return_180d > 0
}

function agg(rows: SimRow[]): {
  n: number
  invested: number
  strat_end: number; strat_profit: number; strat_roi: number
  bench_end: number; bench_profit: number; bench_roi: number
  edge_dollar: number; edge_pct: number
  win_rate: number
} {
  const n          = rows.length
  const invested   = n * BET
  const strat_end  = rows.reduce((s, r) => s + r.strategy_end,  0)
  const bench_end  = rows.reduce((s, r) => s + r.benchmark_end, 0)
  const wins       = rows.filter(r => r.win).length
  return {
    n, invested,
    strat_end,   strat_profit:  strat_end  - invested, strat_roi:  (strat_end  - invested) / invested * 100,
    bench_end,   bench_profit:  bench_end  - invested, bench_roi:  (bench_end  - invested) / invested * 100,
    edge_dollar: strat_end - bench_end,
    edge_pct:    (strat_end - bench_end) / invested * 100,
    win_rate:    wins / n * 100,
  }
}

// ─── Printer ─────────────────────────────────────────────────────────────────

const LOW_SAMPLE = 30

function dollar(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString()
  return (n < 0 ? '-$' : '$') + s
}
function pct1(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%' }
function pct2(n: number): string { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%' }

function printSection(title: string, groups: Map<string, SimRow[]>, order?: string[]) {
  const SEP = '─'.repeat(116)
  console.log('\n' + '═'.repeat(116))
  console.log('  ' + title)
  console.log('  ⚠ Retroactive lookahead classification — optimistic ceiling')
  console.log('═'.repeat(116))
  console.log(
    '  ' + 'Bucket'.padEnd(24) +
    'Sigs'.padStart(6) + '  ' +
    'Invested'.padStart(10) + '  ' +
    'Strat End'.padStart(10) + '  ' + 'Strat P&L'.padStart(10) + '  ' + 'Strat ROI'.padStart(10) + '  ' +
    'BM End'.padStart(10)   + '  ' + 'BM P&L'.padStart(10)    + '  ' + 'BM ROI'.padStart(10)   + '  ' +
    'Edge $'.padStart(10)   + '  ' + 'Edge %'.padStart(8)     + '  ' + 'Win%'.padStart(6)
  )
  console.log('  ' + SEP)

  const keys = order ?? [...groups.keys()].sort()
  for (const k of keys) {
    const rows = groups.get(k)
    if (!rows?.length) continue
    const a   = agg(rows)
    const low = a.n < LOW_SAMPLE ? ' ⚠' : '  '
    console.log(
      low + k.slice(0, 23).padEnd(24) +
      String(a.n).padStart(6) + '  ' +
      dollar(a.invested).padStart(10)    + '  ' +
      dollar(a.strat_end).padStart(10)   + '  ' +
      dollar(a.strat_profit).padStart(10)+ '  ' + pct1(a.strat_roi).padStart(10) + '  ' +
      dollar(a.bench_end).padStart(10)   + '  ' +
      dollar(a.bench_profit).padStart(10)+ '  ' + pct1(a.bench_roi).padStart(10) + '  ' +
      dollar(a.edge_dollar).padStart(10) + '  ' + pct2(a.edge_pct).padStart(8)   + '  ' +
      pct1(a.win_rate).padStart(6)
    )
  }
  if ([...groups.values()].some(r => r.length < LOW_SAMPLE))
    console.log('  ⚠ = fewer than ' + LOW_SAMPLE + ' signals — interpret with caution')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')

  // ── Load CSV ──────────────────────────────────────────────────────────────
  console.log('Reading CSV...')
  const lines   = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx     = (n: string) => headers.indexOf(n)

  const C = {
    insider_cik:        idx('insider_cik'),
    ticker:             idx('ticker'),
    classification:     idx('classification'),
    direction:          idx('direction'),
    transaction_date:   idx('transaction_date'),
    price_entry:        idx('price_entry'),
    shares:             idx('shares'),
    shares_owned_after: idx('shares_owned_after'),
    return_180d:        idx('return_180d'),
    spy_return_180d:    idx('spy_return_180d'),
    role_classified:    idx('role_classified'),
    sector:             idx('sector'),
  }
  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing columns:', missing); process.exit(1) }

  type RawRow = {
    insider_cik: string; ticker: string; classification: string; direction: string
    transaction_date: string; price_entry: number | null
    shares: number | null; shares_owned_after: number | null
    return_180d: number | null; spy_return_180d: number | null
    role_classified: string; sector: string
  }

  const rawRows: RawRow[] = lines.slice(1).map(l => {
    const f = parseCsvLine(l)
    return {
      insider_cik:        f[C.insider_cik]        ?? '',
      ticker:             f[C.ticker]              ?? '',
      classification:     f[C.classification]      ?? '',
      direction:          f[C.direction]           ?? '',
      transaction_date:   f[C.transaction_date]    ?? '',
      price_entry:        pn(f[C.price_entry]),
      shares:             pn(f[C.shares]),
      shares_owned_after: pn(f[C.shares_owned_after]),
      return_180d:        pn(f[C.return_180d]),
      spy_return_180d:    pn(f[C.spy_return_180d]),
      role_classified:    f[C.role_classified]     ?? '',
      sector:             f[C.sector]              ?? '',
    }
  })

  // Filter to OPP BUYs with complete 180d data
  const oppBuysRaw = rawRows.filter(r =>
    r.classification === 'OPPORTUNISTIC' &&
    r.direction === 'buy' &&
    r.return_180d != null
  )
  console.log(`  ${rawRows.length.toLocaleString()} total rows → ${oppBuysRaw.length.toLocaleString()} opp buys with complete 180d`)

  // ── Market caps → PIT tier ────────────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap = new Map<string, number | null>()
  const tickers = [...new Set(rawRows.map(r => r.ticker))]
  for (let i = 0; i < tickers.length; i += 500) {
    const { data } = await supabase.from('tickers').select('symbol,market_cap').in('symbol', tickers.slice(i, i + 500))
    for (const r of data ?? []) mcMap.set((r as any).symbol, (r as any).market_cap ?? null)
  }

  const latestPrice = new Map<string, number>()
  for (const r of rawRows) {
    if (r.price_entry != null) {
      const cur = latestPrice.get(r.ticker)
      if (!cur || r.price_entry > cur) latestPrice.set(r.ticker, r.price_entry)
    }
  }

  // ── Fetch MDY + IWM ───────────────────────────────────────────────────────
  const allDates  = rawRows.map(r => r.transaction_date).filter(Boolean).sort()
  const fetchStart = new Date('2021-01-01')
  const fetchEnd   = new Date(addDays(allDates[allDates.length - 1], 195))

  console.log('Fetching MDY...')
  await slp(300)
  let mdyMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('MDY', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    mdyMap = buildPriceMap(Array.isArray(ch?.quotes) ? ch.quotes : [])
    console.log(`  ${mdyMap.size} MDY points`)
  } catch (e: any) { console.error('MDY failed:', e.message); process.exit(1) }

  await slp(300)
  console.log('Fetching IWM...')
  let iwmMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('IWM', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    iwmMap = buildPriceMap(Array.isArray(ch?.quotes) ? ch.quotes : [])
    console.log(`  ${iwmMap.size} IWM points`)
  } catch (e: any) { console.error('IWM failed:', e.message); process.exit(1) }

  // ── Enrich each opp-buy row ───────────────────────────────────────────────
  type EnrichedRow = RawRow & {
    pit_tier: string
    bm_return_180d: number | null
    sm_alpha_180d: number | null
  }

  const rows: EnrichedRow[] = []
  for (const r of oppBuysRaw) {
    const mc_today = mcMap.get(r.ticker) ?? null
    const p_today  = latestPrice.get(r.ticker) ?? null
    let mc_pit: number | null = null
    if (mc_today != null && p_today != null && p_today > 0 && r.price_entry != null && r.price_entry > 0)
      mc_pit = (mc_today / p_today) * r.price_entry
    const tier = pitTier(mc_pit)

    let bm_ret: number | null
    if (tier === 'Large $10-200B' || tier === 'Mega >$200B') {
      bm_ret = r.spy_return_180d ?? null
    } else if (tier === 'Mid $2-10B') {
      const p0 = lookupPrice(mdyMap, r.transaction_date)
      const p1 = lookupPrice(mdyMap, addDays(r.transaction_date, 180))
      bm_ret   = (p0 && p1) ? Math.round(((p1 - p0) / p0) * 10000) / 100 : null
    } else {
      const p0 = lookupPrice(iwmMap, r.transaction_date)
      const p1 = lookupPrice(iwmMap, addDays(r.transaction_date, 180))
      bm_ret   = (p0 && p1) ? Math.round(((p1 - p0) / p0) * 10000) / 100 : null
    }

    const sm_alpha = (r.return_180d != null && bm_ret != null)
      ? Math.round((r.return_180d - bm_ret) * 100) / 100
      : null

    rows.push({ ...r, pit_tier: tier, bm_return_180d: bm_ret, sm_alpha_180d: sm_alpha })
  }

  // Drop rows where benchmark is missing (very rare)
  const complete = rows.filter(r => r.bm_return_180d != null && r.return_180d != null)
  console.log(`  ${complete.length.toLocaleString()} opp buys with complete benchmark data\n`)

  // ── Build SimRow from EnrichedRow ─────────────────────────────────────────
  function toSim(r: EnrichedRow): SimRow {
    return {
      strategy_end:  BET * (1 + r.return_180d! / 100),
      benchmark_end: BET * (1 + r.bm_return_180d! / 100),
      win:           r.return_180d! > 0,
    }
  }

  // ── LOO track record (size-matched alpha) ─────────────────────────────────
  // Group by insider_cik within opp-buy universe
  const byCik = new Map<string, EnrichedRow[]>()
  for (const r of complete) {
    if (!r.insider_cik) continue
    if (!byCik.has(r.insider_cik)) byCik.set(r.insider_cik, [])
    byCik.get(r.insider_cik)!.push(r)
  }

  const looMap = new Map<EnrichedRow, number | null>()
  for (const trades of byCik.values()) {
    const alphas = trades.map(t => t.sm_alpha_180d)
    const valid  = alphas.filter((v): v is number => v != null)
    const total  = valid.reduce((a, b) => a + b, 0)
    for (let j = 0; j < trades.length; j++) {
      const my = alphas[j]
      if (valid.length === 0)            looMap.set(trades[j], null)
      else if (my != null && valid.length > 1) looMap.set(trades[j], (total - my) / (valid.length - 1))
      else if (my == null && valid.length > 0) looMap.set(trades[j], total / valid.length)
      else                               looMap.set(trades[j], null)
    }
  }

  // ── Helper: group complete rows by a key ──────────────────────────────────
  function groupByKey(fn: (r: EnrichedRow) => string): Map<string, SimRow[]> {
    const m = new Map<string, SimRow[]>()
    for (const r of complete) {
      const k = fn(r)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(toSim(r))
    }
    return m
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 1 — TRACK RECORD
  // ─────────────────────────────────────────────────────────────────────────
  const trackGroups = groupByKey(r => trackBucket(looMap.get(r) ?? null))
  const TRACK_ORDER = ['>25% avg','10-25% avg','0-10% avg','No prior trades','Negative avg']
  printSection('SECTION 1 — OPP BUY by TRACK RECORD (LOO size-matched alpha)', trackGroups, TRACK_ORDER)

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 2 — MARKET CAP TIER
  // ─────────────────────────────────────────────────────────────────────────
  const pitGroups = groupByKey(r => r.pit_tier)
  const PIT_ORDER = ['Micro <$300M','Small $300M-2B','Mid $2-10B','Large $10-200B','Mega >$200B','No data']
  printSection('SECTION 2 — OPP BUY by PIT MARKET-CAP TIER', pitGroups, PIT_ORDER)

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 3 — ROLE
  // ─────────────────────────────────────────────────────────────────────────
  const roleGroups = groupByKey(r => r.role_classified || 'Other/EVP')
  const ROLE_ORDER = ['CEO','CFO','President','Director','10% Owner','Co-Founder/Partner','Insider (other)','Other/EVP']
  printSection('SECTION 3 — OPP BUY by ROLE', roleGroups, ROLE_ORDER)

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 4 — SECTOR (positive mean size-matched alpha only)
  // ─────────────────────────────────────────────────────────────────────────

  // Compute mean SM alpha per sector
  const sectorAlpha = new Map<string, number[]>()
  for (const r of complete) {
    const s = r.sector || 'Unknown'
    if (r.sm_alpha_180d != null) {
      if (!sectorAlpha.has(s)) sectorAlpha.set(s, [])
      sectorAlpha.get(s)!.push(r.sm_alpha_180d)
    }
  }
  const positiveSectors = new Set<string>()
  const sectorMeans: [string, number][] = []
  for (const [s, alphas] of sectorAlpha) {
    const m = alphas.reduce((a, b) => a + b, 0) / alphas.length
    sectorMeans.push([s, m])
    if (m > 0) positiveSectors.add(s)
  }

  const positiveSectorRows = new Map<string, SimRow[]>()
  for (const r of complete) {
    const s = r.sector || 'Unknown'
    if (!positiveSectors.has(s)) continue
    if (!positiveSectorRows.has(s)) positiveSectorRows.set(s, [])
    positiveSectorRows.get(s)!.push(toSim(r))
  }

  // Sort by mean alpha descending
  const sectorMeanMap = new Map(sectorMeans)
  const sectorOrder = [...positiveSectors].sort(
    (a, b) => (sectorMeanMap.get(b) ?? 0) - (sectorMeanMap.get(a) ?? 0)
  )

  printSection(
    'SECTION 4 — OPP BUY by SECTOR (positive mean size-matched alpha only, sorted by alpha)',
    positiveSectorRows, sectorOrder
  )

  const droppedSectors = sectorMeans.filter(([, m]) => m <= 0).sort((a, b) => b[1] - a[1])
  console.log(`\n  Dropped sectors (negative mean SM alpha): ${droppedSectors.map(([s, m]) => `${s} (${m.toFixed(1)}%)`).join(', ')}`)

  // ── Summary totals ────────────────────────────────────────────────────────
  const allSim = complete.map(toSim)
  const tot    = agg(allSim)
  console.log('\n' + '═'.repeat(116))
  console.log('  ALL OPP BUYS (full universe, no filter)')
  console.log('═'.repeat(116))
  console.log(`  Signals:      ${tot.n.toLocaleString()}`)
  console.log(`  Total invested: ${dollar(tot.invested)}`)
  console.log(`  Strategy end:   ${dollar(tot.strat_end)}  (P&L ${dollar(tot.strat_profit)}  ROI ${pct1(tot.strat_roi)})`)
  console.log(`  Benchmark end:  ${dollar(tot.bench_end)}  (P&L ${dollar(tot.bench_profit)}  ROI ${pct1(tot.bench_roi)})`)
  console.log(`  Edge over BM:   ${dollar(tot.edge_dollar)}  (${pct2(tot.edge_pct)} of invested)`)
  console.log(`  Win rate:       ${pct1(tot.win_rate)}`)
  console.log()
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
