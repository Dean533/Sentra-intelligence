// Run with:  npx tsx scripts/factor-breakdown-final.ts
// Output:    output/factor-breakdown-final.csv
//
// Full 6-factor breakdown with SIZE-MATCHED benchmarks:
//   Micro/Small (<$2B PIT)  →  IWM
//   Mid         ($2-10B)    →  MDY
//   Large/Mega  (>$10B)     →  SPY  (already in backtest CSV)
//
// Columns per cell:
//   factor, group, classification, direction,
//   count, win_rate,
//   mean_return_180d, median_return_180d,
//   mean_alpha_sizematched_180d, median_alpha_sizematched_180d
//
// LOO track record also uses size-matched alpha.

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

function csvQ(v: string): string {
  return (v.includes(',') || v.includes('"')) ? `"${v.replace(/"/g, '""')}"` : v
}

// ─── Price map helpers ────────────────────────────────────────────────────────

function buildPriceMap(quotes: any[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date != null && (q?.adjClose ?? q?.close) != null)
      map.set(new Date(q.date).toISOString().split('T')[0], q.adjClose ?? q.close)
  }
  return map
}

function lookupPrice(map: Map<string, number>, dateStr: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(dateStr); d.setUTCDate(d.getUTCDate() + i)
    const p = map.get(d.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

// ─── PIT helpers ──────────────────────────────────────────────────────────────

function pitTier(mc: number | null): string {
  if (mc == null)    return 'No data'
  if (mc < 300e6)    return 'Micro <$300M'
  if (mc < 2e9)      return 'Small $300M-2B'
  if (mc < 10e9)     return 'Mid $2-10B'
  if (mc < 200e9)    return 'Large $10-200B'
  return               'Mega >$200B'
}

// ─── Factor bucketers ─────────────────────────────────────────────────────────

function stakeBucket(shares: number | null, after: number | null): string {
  if (shares == null || after == null || shares <= 0) return 'Unknown'
  const before = after - shares
  if (before <= 0) return 'New/Unknown'
  const pct = (shares / before) * 100
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

// ─── Statistics ───────────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function r2s(v: number | null): string {
  if (v == null) return ''
  return (Math.round(v * 100) / 100).toFixed(2)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_IN  = path.join(__dirname, '..', 'output', 'backtest-universe.csv')
  const CSV_OUT = path.join(__dirname, '..', 'output', 'factor-breakdown-final.csv')

  // ── Load CSV ───────────────────────────────────────────────────────────────
  console.log('Reading backtest CSV...')
  const lines   = fs.readFileSync(CSV_IN, 'utf-8').split('\n').filter(Boolean)
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
    size_bucket:        idx('size_bucket'),
    sector:             idx('sector'),
  }
  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing columns:', missing); process.exit(1) }

  type Row = {
    insider_cik: string; ticker: string; classification: string; direction: string
    transaction_date: string; price_entry: number | null
    shares: number | null; shares_owned_after: number | null
    return_180d: number | null; spy_return_180d: number | null
    role_classified: string; size_bucket: string; sector: string
    // computed:
    pit_tier: string
    size_matched_alpha_180d: number | null
    stake_bucket: string
    track_bucket: string   // filled in after LOO pass
  }

  const allRows: Row[] = lines.slice(1).map(l => {
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
      size_bucket:        f[C.size_bucket]         ?? '',
      sector:             f[C.sector]              ?? '',
      pit_tier:           '',
      size_matched_alpha_180d: null,
      stake_bucket:       '',
      track_bucket:       '',
    }
  })
  console.log(`  ${allRows.length.toLocaleString()} rows`)

  // ── Market caps → PIT tier ─────────────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap = new Map<string, number | null>()
  const tickers = [...new Set(allRows.map(r => r.ticker))]
  for (let i = 0; i < tickers.length; i += 500) {
    const { data } = await supabase.from('tickers').select('symbol,market_cap').in('symbol', tickers.slice(i, i + 500))
    for (const r of data ?? []) mcMap.set((r as any).symbol, (r as any).market_cap ?? null)
  }
  console.log(`  ${[...mcMap.values()].filter(v => v != null).length}/${tickers.length} with market cap`)

  const latestPrice = new Map<string, number>()
  for (const r of allRows) {
    if (r.price_entry != null) {
      const cur = latestPrice.get(r.ticker)
      if (!cur || r.price_entry > cur) latestPrice.set(r.ticker, r.price_entry)
    }
  }

  for (const r of allRows) {
    const mc_today = mcMap.get(r.ticker) ?? null
    const p_today  = latestPrice.get(r.ticker) ?? null
    let mc_pit: number | null = null
    if (mc_today != null && p_today != null && p_today > 0 && r.price_entry != null && r.price_entry > 0)
      mc_pit = (mc_today / p_today) * r.price_entry
    r.pit_tier    = pitTier(mc_pit)
    r.stake_bucket = stakeBucket(r.shares, r.shares_owned_after)
  }

  // ── Fetch MDY and IWM ─────────────────────────────────────────────────────
  const allDates  = allRows.map(r => r.transaction_date).filter(Boolean).sort()
  const fetchStart = new Date('2021-01-01')
  const fetchEnd   = new Date(addDays(allDates[allDates.length - 1], 195))

  console.log(`\nFetching MDY...`)
  await sleep(300)
  let mdyMap = new Map<string, number>()
  try {
    const chart: any = await yf.chart('MDY', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    mdyMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${mdyMap.size} MDY points`)
  } catch (err: any) { console.error('MDY fetch failed:', err.message); process.exit(1) }

  await sleep(300)
  console.log('Fetching IWM...')
  let iwmMap = new Map<string, number>()
  try {
    const chart: any = await yf.chart('IWM', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    iwmMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${iwmMap.size} IWM points`)
  } catch (err: any) { console.error('IWM fetch failed:', err.message); process.exit(1) }

  // ── Size-matched alpha per row ─────────────────────────────────────────────
  for (const r of allRows) {
    if (r.return_180d == null) continue
    let bm_ret: number | null
    if (r.pit_tier === 'Large $10-200B' || r.pit_tier === 'Mega >$200B') {
      bm_ret = r.spy_return_180d ?? null
    } else if (r.pit_tier === 'Mid $2-10B') {
      const p0 = lookupPrice(mdyMap, r.transaction_date)
      const p1 = lookupPrice(mdyMap, addDays(r.transaction_date, 180))
      bm_ret   = (p0 && p1) ? Math.round(((p1 - p0) / p0) * 10000) / 100 : null
    } else {
      // Micro, Small, No data → IWM
      const p0 = lookupPrice(iwmMap, r.transaction_date)
      const p1 = lookupPrice(iwmMap, addDays(r.transaction_date, 180))
      bm_ret   = (p0 && p1) ? Math.round(((p1 - p0) / p0) * 10000) / 100 : null
    }
    r.size_matched_alpha_180d = (bm_ret != null) ? Math.round((r.return_180d - bm_ret) * 100) / 100 : null
  }

  // ── LOO track record (using size-matched alpha) ───────────────────────────
  // Group by (cls, dir, cik); LOO = sum-of-others / (n-1) using size_matched_alpha.
  console.log('\nComputing LOO track records (size-matched alpha)...')
  type CdcGroup = { idxs: number[]; alphas: (number | null)[] }
  const cdcGroups = new Map<string, CdcGroup>()

  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i]
    if (!r.insider_cik) continue
    const key = `${r.classification}|${r.direction}|${r.insider_cik}`
    if (!cdcGroups.has(key)) cdcGroups.set(key, { idxs: [], alphas: [] })
    const g = cdcGroups.get(key)!
    g.idxs.push(i); g.alphas.push(r.size_matched_alpha_180d)
  }

  const rowLoo = new Array<number | null>(allRows.length).fill(null)
  for (const { idxs, alphas } of cdcGroups.values()) {
    const valid  = alphas.filter((v): v is number => v != null)
    const total  = valid.reduce((a, b) => a + b, 0)
    for (let j = 0; j < idxs.length; j++) {
      const ri = idxs[j], my = alphas[j]
      if (valid.length === 0) { rowLoo[ri] = null }
      else if (my != null)    { rowLoo[ri] = valid.length > 1 ? (total - my) / (valid.length - 1) : null }
      else                    { rowLoo[ri] = valid.length > 0 ? total / valid.length : null }
    }
  }
  for (let i = 0; i < allRows.length; i++) {
    allRows[i].track_bucket = trackBucket(rowLoo[i])
  }

  // ── Cross-tab builder ─────────────────────────────────────────────────────

  const CLS_DIR: [string, string][] = [
    ['OPPORTUNISTIC',  'buy'],  ['OPPORTUNISTIC',  'sell'],
    ['ROUTINE',        'buy'],  ['ROUTINE',        'sell'],
    ['UNCLASSIFIABLE', 'buy'],  ['UNCLASSIFIABLE', 'sell'],
  ]

  type Cell = {
    factor: string; group: string; classification: string; direction: string
    count: number; win_rate: string
    mean_return_180d: string; median_return_180d: string
    mean_alpha_sizematched_180d: string; median_alpha_sizematched_180d: string
  }

  function makeCell(
    factor: string, group: string, cls: string, dir: string,
    rows: Row[]
  ): Cell | null {
    if (!rows.length) return null
    const rets   = rows.map(r => r.return_180d).filter((v): v is number => v != null)
    const alphas = rows.map(r => r.size_matched_alpha_180d).filter((v): v is number => v != null)
    const wr     = rets.length ? rets.filter(v => v > 0).length / rets.length : null
    return {
      factor, group, classification: cls, direction: dir,
      count:                          rows.length,
      win_rate:                       wr != null ? (Math.round(wr * 1000) / 10).toFixed(1) : '',
      mean_return_180d:               r2s(mean(rets)),
      median_return_180d:             r2s(median(rets)),
      mean_alpha_sizematched_180d:    r2s(mean(alphas)),
      median_alpha_sizematched_180d:  r2s(median(alphas)),
    }
  }

  const cells: Cell[] = []

  function addFactor(name: string, groupValues: string[], getGroup: (r: Row) => string) {
    // Pre-bucket by (group, cls|dir)
    const byGroup = new Map<string, Map<string, Row[]>>()
    for (const gv of groupValues) {
      const m = new Map<string, Row[]>()
      for (const [cls, dir] of CLS_DIR) m.set(`${cls}|${dir}`, [])
      byGroup.set(gv, m)
    }
    const gvSet = new Set(groupValues)
    for (const r of allRows) {
      const gv = getGroup(r)
      if (!gvSet.has(gv)) continue
      byGroup.get(gv)!.get(`${r.classification}|${r.direction}`)?.push(r)
    }
    for (const gv of groupValues) {
      for (const [cls, dir] of CLS_DIR) {
        const c = makeCell(name, gv, cls, dir, byGroup.get(gv)!.get(`${cls}|${dir}`)!)
        if (c) cells.push(c)
      }
    }
  }

  // ── Factor 1: Sector ──────────────────────────────────────────────────────
  console.log('Factor 1: Sector...')
  const sectors = [...new Set(allRows.map(r => r.sector || 'Unknown'))].sort()
  addFactor('Sector', sectors, r => r.sector || 'Unknown')

  // ── Factor 2: Role ────────────────────────────────────────────────────────
  console.log('Factor 2: Role...')
  addFactor('Role',
    ['CEO','CFO','President','Director','10% Owner','Co-Founder/Partner','Insider (other)','Other/EVP'],
    r => r.role_classified || 'Other/EVP')

  // ── Factor 3: PIT Market Cap ──────────────────────────────────────────────
  console.log('Factor 3: PIT Market Cap...')
  addFactor('MarketCapPIT',
    ['Micro <$300M','Small $300M-2B','Mid $2-10B','Large $10-200B','Mega >$200B','No data'],
    r => r.pit_tier)

  // ── Factor 4: Trade Size ──────────────────────────────────────────────────
  console.log('Factor 4: Trade Size...')
  addFactor('TradeSize',
    ['<$50K','$50K-100K','$100K-250K','$250K-500K','$500K-1M','$1M-5M','$5M-25M','$25M+','Unknown'],
    r => r.size_bucket || 'Unknown')

  // ── Factor 5: Stake Increase ──────────────────────────────────────────────
  console.log('Factor 5: Stake Increase...')
  addFactor('StakeIncrease',
    ['<10%','10-25%','25-50%','50-100%','>100% (doubled+)','New/Unknown','Unknown'],
    r => r.stake_bucket)

  // ── Factor 6: Track Record (LOO, size-matched) ────────────────────────────
  console.log('Factor 6: Track Record (LOO)...')
  addFactor('TrackRecord',
    ['No prior trades','Negative avg','0-10% avg','10-25% avg','>25% avg'],
    r => r.track_bucket)

  // ── Write CSV ──────────────────────────────────────────────────────────────
  const header = 'factor,group,classification,direction,count,win_rate,mean_return_180d,median_return_180d,mean_alpha_sizematched_180d,median_alpha_sizematched_180d'
  const dataLines = cells.map(c =>
    [c.factor, c.group, c.classification, c.direction,
     c.count, c.win_rate,
     c.mean_return_180d, c.median_return_180d,
     c.mean_alpha_sizematched_180d, c.median_alpha_sizematched_180d]
    .map(v => csvQ(String(v))).join(',')
  )
  fs.writeFileSync(CSV_OUT, [header, ...dataLines].join('\n') + '\n', 'utf-8')

  console.log(`\nWritten: ${CSV_OUT}`)
  console.log(`Data rows: ${cells.length}`)
  console.log('Benchmarks: Large/Mega→SPY (from CSV), Mid→MDY (fetched), Micro/Small/NoData→IWM (fetched)')

  // ── Sanity print: OPP BUY PIT tier ────────────────────────────────────────
  console.log('\nSanity — OPP BUY by PIT tier (size-matched):')
  const PIT_ORDER = ['Micro <$300M','Small $300M-2B','Mid $2-10B','Large $10-200B','Mega >$200B','No data']
  for (const tier of PIT_ORDER) {
    const c = cells.find(c => c.factor === 'MarketCapPIT' && c.group === tier && c.classification === 'OPPORTUNISTIC' && c.direction === 'buy')
    if (c) console.log(`  ${tier.padEnd(20)} n=${String(c.count).padStart(5)}  win=${c.win_rate}%  medRet=${c.median_return_180d}%  medAlpha=${c.median_alpha_sizematched_180d}%  meanAlpha=${c.mean_alpha_sizematched_180d}%`)
  }

  // ── Rows per factor ────────────────────────────────────────────────────────
  console.log('\nRows per factor:')
  const fc: Record<string, number> = {}
  for (const c of cells) fc[c.factor] = (fc[c.factor] ?? 0) + 1
  for (const [f, n] of Object.entries(fc)) console.log(`  ${f.padEnd(20)} ${n}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
