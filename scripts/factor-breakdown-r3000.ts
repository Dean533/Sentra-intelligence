// Run with:  npx tsx scripts/factor-breakdown-r3000.ts
//
// Generates output/factor-breakdown-r3000.csv:
// For each of 6 factors × every group × every (classification × direction) cell:
//   factor, group, classification, direction, count, win_rate,
//   median_return_180d, median_alpha_180d
//
// Uses PIT (point-in-time) market cap via price-ratio scaling for Factor 3.
// Covers ALL classification × direction combinations (not just opp buys).
// LOO track record computed within each (classification, direction, cik) bucket.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

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
  if (!v || v === '') return null
  const f = parseFloat(v); return isNaN(f) ? null : f
}

// ─── Bucket helpers ───────────────────────────────────────────────────────────

function mcPITTier(mc: number | null): string {
  if (mc == null)    return 'No data'
  if (mc < 300e6)    return 'Micro <$300M'
  if (mc < 2e9)      return 'Small $300M-2B'
  if (mc < 10e9)     return 'Mid $2-10B'
  if (mc < 200e9)    return 'Large $10-200B'
  return               'Mega >$200B'
}

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

function r2(v: number | null): string {
  if (v == null) return ''
  return (Math.round(v * 100) / 100).toFixed(2)
}

// ─── CSV output helpers ───────────────────────────────────────────────────────

function csvQ(v: string): string {
  return v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
}

type Cell = {
  factor: string; group: string; classification: string; direction: string
  count: number; win_rate: string; median_return_180d: string; median_alpha_180d: string
}

function makeCell(
  factor: string, group: string, cls: string, dir: string,
  rows: { return_180d: number | null; alpha_180d: number | null }[]
): Cell | null {
  if (!rows.length) return null
  const rets   = rows.map(r => r.return_180d).filter((v): v is number => v != null)
  const alphas = rows.map(r => r.alpha_180d).filter((v): v is number => v != null)
  const wr     = rets.length ? rets.filter(v => v > 0).length / rets.length : null
  return {
    factor, group, classification: cls, direction: dir,
    count:             rows.length,
    win_rate:          wr != null ? (Math.round(wr * 1000) / 10).toFixed(1) : '',
    median_return_180d: r2(median(rets)),
    median_alpha_180d:  r2(median(alphas)),
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_IN  = path.join(__dirname, '..', 'output', 'backtest-universe.csv')
  const CSV_OUT = path.join(__dirname, '..', 'output', 'factor-breakdown-r3000.csv')

  // ── Load backtest CSV ──────────────────────────────────────────────────────

  console.log('Reading backtest CSV...')
  const lines   = fs.readFileSync(CSV_IN, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx     = (n: string) => headers.indexOf(n)

  const C = {
    insider_cik:        idx('insider_cik'),
    direction:          idx('direction'),
    classification:     idx('classification'),
    ticker:             idx('ticker'),
    role_classified:    idx('role_classified'),
    size_bucket:        idx('size_bucket'),
    sector:             idx('sector'),
    price_entry:        idx('price_entry'),
    shares:             idx('shares'),
    shares_owned_after: idx('shares_owned_after'),
    return_180d:        idx('return_180d'),
    alpha_180d:         idx('alpha_180d'),
  }

  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing columns:', missing); process.exit(1) }

  type Row = {
    insider_cik: string; direction: string; classification: string
    ticker: string; role_classified: string; size_bucket: string; sector: string
    price_entry: number | null; shares: number | null; shares_owned_after: number | null
    return_180d: number | null; alpha_180d: number | null
    // computed later:
    pit_tier?: string; stake_bucket?: string; track_bucket?: string
  }

  const allRows: Row[] = lines.slice(1).map(l => {
    const f = parseCsvLine(l)
    return {
      insider_cik:        f[C.insider_cik]        ?? '',
      direction:          f[C.direction]           ?? '',
      classification:     f[C.classification]      ?? '',
      ticker:             f[C.ticker]              ?? '',
      role_classified:    f[C.role_classified]     ?? '',
      size_bucket:        f[C.size_bucket]         ?? '',
      sector:             f[C.sector]              ?? '',
      price_entry:        pn(f[C.price_entry]),
      shares:             pn(f[C.shares]),
      shares_owned_after: pn(f[C.shares_owned_after]),
      return_180d:        pn(f[C.return_180d]),
      alpha_180d:         pn(f[C.alpha_180d]),
    }
  })

  console.log(`Loaded ${allRows.length.toLocaleString()} rows`)

  // ── Fetch market caps ──────────────────────────────────────────────────────

  console.log('Fetching market caps...')
  const mcMap = new Map<string, number | null>()
  const tickers = [...new Set(allRows.map(r => r.ticker))]
  for (let i = 0; i < tickers.length; i += 500) {
    const { data } = await supabase.from('tickers').select('symbol,market_cap').in('symbol', tickers.slice(i, i + 500))
    for (const r of data ?? []) mcMap.set((r as any).symbol, (r as any).market_cap ?? null)
  }
  console.log(`Market caps: ${[...mcMap.values()].filter(v => v != null).length}/${tickers.length} tickers`)

  // ── Compute PIT market cap per row ─────────────────────────────────────────
  // Latest price_entry per ticker = proxy for current price
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
    if (mc_today != null && p_today != null && p_today > 0 && r.price_entry != null && r.price_entry > 0) {
      mc_pit = (mc_today / p_today) * r.price_entry
    }
    r.pit_tier = mcPITTier(mc_pit)
  }

  // ── Compute stake bucket per row ───────────────────────────────────────────

  for (const r of allRows) {
    r.stake_bucket = stakeBucket(r.shares, r.shares_owned_after)
  }

  // ── Compute LOO track record per row ───────────────────────────────────────
  // LOO is computed within (classification, direction, insider_cik) group.
  // Uses sum-of-returns trick: loo[i] = (totalSum - ret[i]) / (n - 1)

  console.log('Computing LOO track records...')
  type CdcKey = string   // `${cls}|${dir}|${cik}`
  const cdcGroups = new Map<CdcKey, { rows: Row[]; idxs: number[] }>()

  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i]
    if (!r.insider_cik) continue
    const key: CdcKey = `${r.classification}|${r.direction}|${r.insider_cik}`
    if (!cdcGroups.has(key)) cdcGroups.set(key, { rows: [], idxs: [] })
    cdcGroups.get(key)!.rows.push(r)
    cdcGroups.get(key)!.idxs.push(i)
  }

  const rowLoo = new Array<number | null>(allRows.length).fill(null)
  for (const { rows, idxs } of cdcGroups.values()) {
    const rets  = rows.map(r => r.return_180d)
    const valid = rets.filter((v): v is number => v != null)
    const total = valid.reduce((a, b) => a + b, 0)
    for (let j = 0; j < rows.length; j++) {
      const ri = idxs[j]
      const my = rets[j]
      if (valid.length === 0 || (valid.length === 1 && my != null)) {
        rowLoo[ri] = null   // only self, no others
      } else if (my != null) {
        rowLoo[ri] = (total - my) / (valid.length - 1)
      } else {
        rowLoo[ri] = total / valid.length
      }
    }
  }

  for (let i = 0; i < allRows.length; i++) {
    allRows[i].track_bucket = trackBucket(rowLoo[i])
  }

  // ── Build cross-tab cells ─────────────────────────────────────────────────

  const CLS_DIR: [string, string][] = [
    ['OPPORTUNISTIC',  'buy'],  ['OPPORTUNISTIC',  'sell'],
    ['ROUTINE',        'buy'],  ['ROUTINE',        'sell'],
    ['UNCLASSIFIABLE', 'buy'],  ['UNCLASSIFIABLE', 'sell'],
  ]

  // Group rows by (classification, direction) up front for efficiency
  const cdMap = new Map<string, Row[]>()
  for (const [cls, dir] of CLS_DIR) cdMap.set(`${cls}|${dir}`, [])
  for (const r of allRows) {
    const k = `${r.classification}|${r.direction}`
    if (cdMap.has(k)) cdMap.get(k)!.push(r)
  }

  const cells: Cell[] = []

  function addFactor(
    factorName: string,
    groupValues: string[],
    getGroup: (r: Row) => string
  ) {
    // Pre-group by (group_value, cls, dir)
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
      const m = byGroup.get(gv)!
      const k = `${r.classification}|${r.direction}`
      m.get(k)?.push(r)
    }
    for (const gv of groupValues) {
      const m = byGroup.get(gv)!
      for (const [cls, dir] of CLS_DIR) {
        const cell = makeCell(factorName, gv, cls, dir, m.get(`${cls}|${dir}`)!)
        if (cell) cells.push(cell)
      }
    }
  }

  // ── Factor 1: Sector ─────────────────────────────────────────────────────

  console.log('Factor 1: Sector...')
  const sectors = [...new Set(allRows.map(r => r.sector || 'Unknown'))].sort()
  addFactor('Sector', sectors, r => r.sector || 'Unknown')

  // ── Factor 2: Role ───────────────────────────────────────────────────────

  console.log('Factor 2: Role...')
  const ROLE_ORDER = ['CEO','CFO','President','Director','10% Owner','Co-Founder/Partner','Insider (other)','Other/EVP']
  addFactor('Role', ROLE_ORDER, r => r.role_classified || 'Other/EVP')

  // ── Factor 3: PIT Market Cap ─────────────────────────────────────────────

  console.log('Factor 3: PIT Market Cap...')
  const PIT_ORDER = ['Micro <$300M','Small $300M-2B','Mid $2-10B','Large $10-200B','Mega >$200B','No data']
  addFactor('MarketCapPIT', PIT_ORDER, r => r.pit_tier ?? 'No data')

  // ── Factor 4: Trade Size ─────────────────────────────────────────────────

  console.log('Factor 4: Trade Size...')
  const SIZE_ORDER = ['<$50K','$50K-100K','$100K-250K','$250K-500K','$500K-1M','$1M-5M','$5M-25M','$25M+','Unknown']
  addFactor('TradeSize', SIZE_ORDER, r => r.size_bucket || 'Unknown')

  // ── Factor 5: Stake Increase ─────────────────────────────────────────────

  console.log('Factor 5: Stake Increase...')
  const STAKE_ORDER = ['<10%','10-25%','25-50%','50-100%','>100% (doubled+)','New/Unknown','Unknown']
  addFactor('StakeIncrease', STAKE_ORDER, r => r.stake_bucket ?? 'Unknown')

  // ── Factor 6: Track Record ───────────────────────────────────────────────

  console.log('Factor 6: Track Record (LOO)...')
  const TRACK_ORDER = ['No prior trades','Negative avg','0-10% avg','10-25% avg','>25% avg']
  addFactor('TrackRecord', TRACK_ORDER, r => r.track_bucket ?? 'No prior trades')

  // ── Write CSV ──────────────────────────────────────────────────────────────

  const header = 'factor,group,classification,direction,count,win_rate,median_return_180d,median_alpha_180d'
  const dataLines = cells.map(c =>
    [c.factor, c.group, c.classification, c.direction,
     c.count, c.win_rate, c.median_return_180d, c.median_alpha_180d]
    .map(v => csvQ(String(v))).join(',')
  )
  fs.writeFileSync(CSV_OUT, [header, ...dataLines].join('\n') + '\n', 'utf-8')

  console.log(`\nWritten: ${CSV_OUT}`)
  console.log(`Data rows: ${cells.length}`)
  console.log(`(PIT market cap tiers confirmed: Micro <$300M, Small $300M-2B, Mid $2-10B, Large $10-200B, Mega >$200B)`)

  // ── Quick sanity check: opp buy PIT tier summary ─────────────────────────
  console.log('\nSanity — OPP BUY PIT market cap tier counts:')
  for (const tier of PIT_ORDER) {
    const c = cells.find(c => c.factor === 'MarketCapPIT' && c.group === tier && c.classification === 'OPPORTUNISTIC' && c.direction === 'buy')
    if (c) console.log(`  ${tier.padEnd(20)} n=${c.count}  win=${c.win_rate}%  medRet=${c.median_return_180d}%  medAlpha=${c.median_alpha_180d}%`)
  }

  // Factor row count breakdown
  console.log('\nRows per factor:')
  const factorCounts: Record<string, number> = {}
  for (const c of cells) factorCounts[c.factor] = (factorCounts[c.factor] ?? 0) + 1
  for (const [f, n] of Object.entries(factorCounts)) console.log(`  ${f.padEnd(20)} ${n}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
