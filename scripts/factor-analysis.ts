import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// ── env ───────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const key = t.slice(0, eq).trim()
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}
loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ── output tee ────────────────────────────────────────────────────────────────

const lines: string[] = []
function out(s = '') { console.log(s); lines.push(s) }
function hr(char = '─', len = 90) { out(char.repeat(len)) }

// ── csv parser ────────────────────────────────────────────────────────────────

function parseLine(line: string): string[] {
  const res: string[] = []
  let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i+1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { res.push(cur); cur = '' }
    else cur += c
  }
  res.push(cur)
  return res
}

function parseCSV(content: string): Record<string, string>[] {
  const rows = content.split('\n').filter(l => l.trim())
  const headers = parseLine(rows[0])
  return rows.slice(1).map(line => {
    const vals = parseLine(line)
    const r: Record<string, string> = {}
    headers.forEach((h, i) => { r[h] = (vals[i] ?? '').trim() })
    return r
  })
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Trade {
  id: string
  ticker: string
  insider_name: string
  insider_cik: string
  officer_title: string
  role: string
  transaction_date: string
  total_value: number
  sector: string
  return_90d:  number | null
  return_180d: number | null
  adjusted_return_90d:  number | null
  adjusted_return_180d: number | null
  spy_return_90d:  number | null
  is_local?: boolean
}

// ── stats ─────────────────────────────────────────────────────────────────────

function n90(arr: Trade[])  { return arr.filter(t => t.adjusted_return_90d  != null).length }
function n180(arr: Trade[]) { return arr.filter(t => t.adjusted_return_180d != null).length }

function vals90a(arr: Trade[])  { return arr.map(t => t.adjusted_return_90d!).filter(x => x != null) }
function vals180a(arr: Trade[]) { return arr.map(t => t.adjusted_return_180d!).filter(x => x != null) }
function vals90r(arr: Trade[])  { return arr.map(t => t.return_90d!).filter(x => x != null) }
function vals180r(arr: Trade[]) { return arr.map(t => t.return_180d!).filter(x => x != null) }

function mean(v: number[]): number { return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
function hitRate(v: number[]): number { return v.length ? v.filter(x => x > 0).length / v.length : NaN }
function variance(v: number[], m: number): number {
  return v.length < 2 ? 0 : v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)
}
function tScore(a: number[], b: number[]): number | null {
  if (a.length < 3 || b.length < 3) return null
  const ma = mean(a), mb = mean(b)
  const se = Math.sqrt(variance(a, ma) / a.length + variance(b, mb) / b.length)
  return se === 0 ? null : (ma - mb) / se
}
function minOf(v: number[]): number { return v.length ? Math.min(...v) : NaN }
function maxOf(v: number[]): number { return v.length ? Math.max(...v) : NaN }
function median(v: number[]): number | null {
  if (!v.length) return null
  const s = v.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2
}
function fmt(n: number, d = 2): string {
  if (isNaN(n)) return '   N/A'
  return (n >= 0 ? '+' : '') + n.toFixed(d) + '%'
}
function fmtN(n: number, d = 2): string {
  if (isNaN(n)) return '   N/A'
  return (n >= 0 ? '+' : '') + n.toFixed(d)
}

// ── role normalizer ───────────────────────────────────────────────────────────

function normalizeRole(role: string, title: string): string {
  const t = (role + ' ' + title).toLowerCase()
  if (t.includes('10%') || (t.includes('owner') && !t.includes('co-owner'))) return '10% Owner'
  if (t.includes('chief executive') || t.includes('ceo')) return 'CEO'
  if (t.includes('president') && !t.includes('vice')) return 'President'
  if (t.includes('chief financial') || t.includes('cfo')) return 'CFO'
  if (t.includes('director')) return 'Director'
  return 'Other'
}

// ── block printer ─────────────────────────────────────────────────────────────

function printBlock(label: string, subset: Trade[], baseline: Trade[]) {
  const a90 = vals90a(subset), a180 = vals180a(subset)
  const r90 = vals90r(subset), r180 = vals180r(subset)
  const ba90 = vals90a(baseline)

  const t90 = tScore(a90, ba90)
  out(
    `  ${label.padEnd(30)}` +
    `n=${subset.length.toString().padStart(4)}` +
    `  n90=${n90(subset).toString().padStart(4)}` +
    `  n180=${n180(subset).toString().padStart(4)}` +
    `  hit90=${isNaN(hitRate(a90)) ? ' N/A ' : (hitRate(a90)*100).toFixed(1).padStart(4) + '%'}` +
    `  hit180=${isNaN(hitRate(a180)) ? ' N/A ' : (hitRate(a180)*100).toFixed(1).padStart(4) + '%'}` +
    `  raw90=${fmt(mean(r90))}` +
    `  α90=${fmt(mean(a90))}` +
    `  raw180=${fmt(mean(r180))}` +
    `  α180=${fmt(mean(a180))}` +
    `  t=${t90 != null ? fmtN(t90) : '  N/A'}` +
    `  min_α90=${fmt(minOf(a90))}` +
    `  max_α90=${fmt(maxOf(a90))}`
  )
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = path.join(__dirname, '..', 'output', 'deep_analysis_v2.csv')
  if (!fs.existsSync(csvPath)) { console.error('ERROR: deep_analysis_v2.csv not found'); process.exit(1) }

  const rawRows = parseCSV(fs.readFileSync(csvPath, 'utf-8'))

  const allRows: Trade[] = rawRows
    .filter(r => r.transaction_code === 'P' && r.transaction_direction === 'buy')
    .map(r => ({
      id:               r.id,
      ticker:           r.ticker,
      insider_name:     r.insider_name,
      insider_cik:      r.insider_cik ?? '',
      officer_title:    r.officer_title ?? '',
      role:             r.role ?? '',
      transaction_date: r.transaction_date,
      total_value:      parseFloat(r.total_value) || 0,
      sector:           r.sector || 'Unknown',
      return_90d:       r.return_90d  ? parseFloat(r.return_90d)  : null,
      return_180d:      r.return_180d ? parseFloat(r.return_180d) : null,
      adjusted_return_90d:  r.adjusted_return_90d  ? parseFloat(r.adjusted_return_90d)  : null,
      adjusted_return_180d: r.adjusted_return_180d ? parseFloat(r.adjusted_return_180d) : null,
      spy_return_90d:   r.spy_return_90d ? parseFloat(r.spy_return_90d) : null,
    }))

  // ── fetch is_local ───────────────────────────────────────────────────────────
  const localMap = new Map<string, boolean>()
  const ids = allRows.map(t => t.id).filter(Boolean)
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500)
    const { data } = await supabase.from('insider_transactions').select('id, is_local').in('id', batch)
    for (const row of data ?? []) { if (row.id) localMap.set(row.id, row.is_local ?? false) }
  }
  for (const t of allRows) { t.is_local = localMap.get(t.id) }

  // ── compute insider medians for relative-size factor ─────────────────────────
  const insiderVals = new Map<string, number[]>()
  for (const t of allRows) {
    if (!t.insider_cik) continue
    if (!insiderVals.has(t.insider_cik)) insiderVals.set(t.insider_cik, [])
    insiderVals.get(t.insider_cik)!.push(t.total_value)
  }
  const insiderMedians = new Map<string, number>()
  for (const [cik, vals] of insiderVals) {
    const m = median(vals); if (m && m > 0) insiderMedians.set(cik, m)
  }

  // ── compute cluster counts ────────────────────────────────────────────────────
  const clusterMap = new Map<string, Set<string>>()
  for (const t of allRows) {
    const key = `${t.ticker}_${t.transaction_date.slice(0, 7)}`
    if (!clusterMap.has(key)) clusterMap.set(key, new Set())
    clusterMap.get(key)!.add(t.insider_name)
  }
  function clusterSize(t: Trade): number {
    return clusterMap.get(`${t.ticker}_${t.transaction_date.slice(0, 7)}`)?.size ?? 1
  }

  const oppo = allRows.filter(t => t.adjusted_return_90d != null && t.adjusted_return_180d != null)

  // ═════════════════════════════════════════════════════════════════════════════
  hr('═')
  out('FULL FACTOR ANALYSIS — SENTRA CONVICTION SCORING')
  out(`Generated: ${new Date().toISOString()}`)
  hr('═')

  // ── 9. Dataset totals ────────────────────────────────────────────────────────
  out()
  out('━━ DATASET TOTALS')
  out(`  Total rows in CSV (all codes):           ${rawRows.length}`)
  out(`  Buy (code P) trades:                     ${allRows.length}`)
  out(`  Trades with 90d outcome data:            ${allRows.filter(t => t.adjusted_return_90d != null).length}`)
  out(`  Trades with 180d outcome data:           ${allRows.filter(t => t.adjusted_return_180d != null).length}`)
  out(`  Trades with both 90d + 180d outcomes:    ${oppo.length}`)
  out(`  is_local resolved from Supabase:         ${localMap.size}`)
  out(`  Unique tickers:                          ${new Set(allRows.map(t => t.ticker)).size}`)
  out(`  Unique insiders:                         ${new Set(allRows.map(t => t.insider_name)).size}`)
  out(`  Date range:                              ${allRows.map(t => t.transaction_date).sort()[0]} → ${allRows.map(t => t.transaction_date).sort().at(-1)}`)

  const ba90  = vals90a(oppo)
  const ba180 = vals180a(oppo)
  out()
  out(`  BASELINE (all ${oppo.length} trades with outcomes):`)
  out(`    hit rate 90d:   ${(hitRate(ba90)*100).toFixed(2)}%`)
  out(`    hit rate 180d:  ${(hitRate(ba180)*100).toFixed(2)}%`)
  out(`    avg raw 90d:    ${fmt(mean(vals90r(oppo)))}`)
  out(`    avg alpha 90d:  ${fmt(mean(ba90))}`)
  out(`    avg raw 180d:   ${fmt(mean(vals180r(oppo)))}`)
  out(`    avg alpha 180d: ${fmt(mean(ba180))}`)
  out(`    min alpha 90d:  ${fmt(minOf(ba90))}`)
  out(`    max alpha 90d:  ${fmt(maxOf(ba90))}`)

  const COL_HDR = '  ' + 'Label'.padEnd(30) +
    'n    ' + 'n90  ' + 'n180 ' +
    'hit90     ' + 'hit180    ' +
    'raw90     ' + 'α90       ' +
    'raw180    ' + 'α180      ' +
    't         ' + 'min_α90   ' + 'max_α90'

  // ═══ 1. ROLE ═══════════════════════════════════════════════════════════════
  out()
  hr('═')
  out('1. ROLE BREAKDOWN')
  hr('═')
  out(COL_HDR)
  hr()

  const roleMap = new Map<string, Trade[]>()
  for (const t of oppo) {
    const r = normalizeRole(t.role, t.officer_title)
    if (!roleMap.has(r)) roleMap.set(r, [])
    roleMap.get(r)!.push(t)
  }
  for (const [role, trades] of [...roleMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
    printBlock(role, trades, oppo)
  }
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 2. TRADE SIZE ═════════════════════════════════════════════════════════
  out()
  hr('═')
  out('2. TRADE SIZE BREAKDOWN')
  hr('═')
  out(COL_HDR)
  hr()

  const sizeBuckets: [string, (v: number) => boolean][] = [
    ['<$250K',       v => v < 250_000],
    ['$250K–$500K',  v => v >= 250_000   && v < 500_000],
    ['$500K–$1M',    v => v >= 500_000   && v < 1_000_000],
    ['$1M–$5M',      v => v >= 1_000_000 && v < 5_000_000],
    ['$5M–$25M',     v => v >= 5_000_000 && v < 25_000_000],
    ['>$25M',        v => v >= 25_000_000],
  ]
  for (const [label, fn] of sizeBuckets) {
    printBlock(label, oppo.filter(t => fn(t.total_value)), oppo)
  }
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 3. SECTOR ═════════════════════════════════════════════════════════════
  out()
  hr('═')
  out('3. SECTOR BREAKDOWN')
  hr('═')
  out(COL_HDR)
  hr()

  const sectorMap = new Map<string, Trade[]>()
  for (const t of oppo) {
    if (!sectorMap.has(t.sector)) sectorMap.set(t.sector, [])
    sectorMap.get(t.sector)!.push(t)
  }
  for (const [sector, trades] of [...sectorMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
    printBlock(sector, trades, oppo)
  }
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 4. CLUSTER ════════════════════════════════════════════════════════════
  out()
  hr('═')
  out('4. CLUSTER SIZE BREAKDOWN')
  hr('═')
  out(COL_HDR)
  hr()

  const clusterBuckets: [string, (c: number) => boolean][] = [
    ['1 insider',    c => c === 1],
    ['2–3 insiders', c => c >= 2 && c <= 3],
    ['4+ insiders',  c => c >= 4],
  ]
  for (const [label, fn] of clusterBuckets) {
    printBlock(label, oppo.filter(t => fn(clusterSize(t))), oppo)
  }
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 5. MARKET CONDITION ═══════════════════════════════════════════════════
  out()
  hr('═')
  out('5. MARKET CONDITION (SPY 90d return in same period)')
  hr('═')
  out(COL_HDR)
  hr()

  const mktBuckets: [string, (s: number) => boolean][] = [
    ['SPY <−15%',    s => s < -15],
    ['SPY −15%–−10%', s => s >= -15 && s < -10],
    ['SPY −10%–−5%', s => s >= -10 && s < -5],
    ['SPY −5%–0%',   s => s >= -5  && s < 0],
    ['SPY 0%–5%',    s => s >= 0   && s < 5],
    ['SPY 5%–10%',   s => s >= 5   && s < 10],
    ['SPY >10%',     s => s >= 10],
  ]
  for (const [label, fn] of mktBuckets) {
    const sub = oppo.filter(t => t.spy_return_90d != null && fn(t.spy_return_90d!))
    printBlock(label, sub, oppo)
  }
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 6. LOCAL VS NON-LOCAL ═════════════════════════════════════════════════
  out()
  hr('═')
  out('6. LOCAL INSIDER vs NON-LOCAL')
  hr('═')
  out(COL_HDR)
  hr()

  const localTrades    = oppo.filter(t => t.is_local === true)
  const nonLocalTrades = oppo.filter(t => t.is_local === false)
  const unknownLocal   = oppo.filter(t => t.is_local == null)
  printBlock('Local',            localTrades, oppo)
  printBlock('Non-local',        nonLocalTrades, oppo)
  printBlock('is_local unknown', unknownLocal, oppo)
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 7. RELATIVE SIZE ══════════════════════════════════════════════════════
  out()
  hr('═')
  out('7. TRADE SIZE RELATIVE TO INSIDER\'S OWN MEDIAN')
  hr('═')
  out(COL_HDR)
  hr()

  const relBuckets: [string, (r: number) => boolean][] = [
    ['<0.5× median',  r => r < 0.5],
    ['0.5×–1× median', r => r >= 0.5 && r < 1],
    ['1×–2× median',  r => r >= 1 && r < 2],
    ['2×–5× median',  r => r >= 2 && r < 5],
    ['>5× median',    r => r >= 5],
  ]
  for (const [label, fn] of relBuckets) {
    const sub = oppo.filter(t => {
      if (!t.insider_cik) return false
      const med = insiderMedians.get(t.insider_cik)
      if (!med) return false
      return fn(t.total_value / med)
    })
    printBlock(label, sub, oppo)
  }
  const noMedian = oppo.filter(t => !t.insider_cik || !insiderMedians.get(t.insider_cik))
  printBlock('No median (only 1 trade)', noMedian, oppo)
  out()
  printBlock('BASELINE (all)', oppo, oppo)

  // ═══ 8. COMBINED FILTERS ═══════════════════════════════════════════════════
  out()
  hr('═')
  out('8. COMBINED FILTERS (n ≥ 5 only)')
  hr('═')
  out(COL_HDR)
  hr()

  const targetRoles = ['CEO', '10% Owner', 'CFO', 'Director', 'Other', 'President']
  const sectors     = [...new Set(oppo.map(t => t.sector))].sort()

  // Role × Sector
  out()
  out('  ── Role × Sector ──')
  for (const role of targetRoles) {
    for (const sector of sectors) {
      const sub = oppo.filter(t => normalizeRole(t.role, t.officer_title) === role && t.sector === sector)
      if (sub.length >= 5) printBlock(`${role} × ${sector}`, sub, oppo)
    }
  }

  // Role × Size bucket
  out()
  out('  ── Role × Trade Size ──')
  for (const role of targetRoles) {
    for (const [sizeLabel, sizeFn] of sizeBuckets) {
      const sub = oppo.filter(t => normalizeRole(t.role, t.officer_title) === role && sizeFn(t.total_value))
      if (sub.length >= 5) printBlock(`${role} × ${sizeLabel}`, sub, oppo)
    }
  }

  // Role × Cluster
  out()
  out('  ── Role × Cluster ──')
  for (const role of targetRoles) {
    for (const [cLabel, cFn] of clusterBuckets) {
      const sub = oppo.filter(t => normalizeRole(t.role, t.officer_title) === role && cFn(clusterSize(t)))
      if (sub.length >= 5) printBlock(`${role} × ${cLabel}`, sub, oppo)
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  out()
  hr('═')
  out('END OF REPORT')
  hr('═')

  const outPath = path.join(__dirname, '..', 'output', 'full-factor-analysis.txt')
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`\nSaved to output/full-factor-analysis.txt`)
}

main().catch(err => { console.error(err); process.exit(1) })
