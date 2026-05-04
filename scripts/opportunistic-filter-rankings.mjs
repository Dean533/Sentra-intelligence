// Run with:  node scripts/opportunistic-filter-rankings.mjs
// Output:    output/opportunistic_filter_rankings.txt
//
// Combinatorial filter analysis on opportunistic trades (deep_analysis_v2.csv).
// Tests every combination of role × purchase size × sector × early drawdown cap,
// ranks by confidence-weighted score = avg_alpha_180d * ln(n).

import * as fs   from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const INPUT  = path.join(__dirname, '..', 'output', 'deep_analysis_v2.csv')
const OUTPUT = path.join(__dirname, '..', 'output', 'opportunistic_filter_rankings.txt')

// ─── CSV parse ────────────────────────────────────────────────────────────────

const VALID_ROLES = new Set([
  'Director', 'Co-Founder/Partner', '10% Owner', 'Other/EVP',
  'CFO', 'CEO', 'President', 'Insider (other)',
])
const VALID_SECTORS = new Set([
  'Industrials', 'Technology', 'Financial Services', 'Healthcare',
  'Consumer Cyclical', 'Utilities', 'Real Estate', 'Basic Materials',
  'Consumer Defensive', 'Communication Services',
])

function parseCSV(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim())
  const header = lines[0].split(',')
  const rows = []
  let skipped = 0
  for (const line of lines.slice(1)) {
    const vals = line.split(',')
    const obj  = {}
    header.forEach((h, i) => obj[h] = (vals[i] ?? '').trim())
    // Skip rows corrupted by a comma in insider_name (fields shift by 1+)
    if (!VALID_ROLES.has(obj.role_classified) || !VALID_SECTORS.has(obj.sector)) {
      skipped++
      continue
    }
    const alpha180  = obj.adjusted_return_180d !== '' ? parseFloat(obj.adjusted_return_180d) : null
    const maxDD     = obj.max_drawdown_30d     !== '' ? parseFloat(obj.max_drawdown_30d)     : null
    const totalVal  = parseFloat(obj.total_value)
    if (isNaN(totalVal)) { skipped++; continue }
    rows.push({
      role:      obj.role_classified,
      sector:    obj.sector,
      totalVal,
      alpha180,
      hit180:    obj.signal_correct_180d === 'true',
      maxDD,
    })
  }
  if (skipped) console.log(`  Skipped ${skipped} corrupted/incomplete rows`)
  return rows
}

// ─── Stats helpers ────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m]
}

function computeStats(rows) {
  // Only rows with valid 180d alpha count toward metrics
  const valid  = rows.filter(r => r.alpha180 != null)
  const n      = valid.length
  if (n === 0) return null
  const alphas = valid.map(r => r.alpha180)
  const hits   = valid.filter(r => r.hit180).length
  const avg    = alphas.reduce((a, b) => a + b, 0) / n
  const med    = median(alphas)
  const hit    = hits / n
  const score  = avg * Math.log(n)   // natural log — same formula as unclassifiable rankings
  return { n, avg, med, hit, score }
}

// ─── Filter dimensions ────────────────────────────────────────────────────────

const ROLES   = [null, 'CEO', 'CFO', 'Director', '10% Owner', 'President']
const VALUES  = [100_000, 250_000, 500_000, 1_000_000, 5_000_000, 25_000_000]
const SECTORS = [null, ...VALID_SECTORS]
// DD thresholds: null = no filter; -2 = max drawdown in first 30d < 2% (dd > -2); etc.
const DD_OPTS = [
  { label: 'any', threshold: null   },
  { label: '<2%', threshold: -2     },
  { label: '<5%', threshold: -5     },
]

// ─── Run combinations ─────────────────────────────────────────────────────────

console.log('Parsing CSV…')
const all = parseCSV(INPUT)
console.log(`Loaded ${all.length} clean rows`)

const baseStats = computeStats(all)
console.log(`Baseline: n=${baseStats.n}  avg=${baseStats.avg.toFixed(1)}%  hit=${(baseStats.hit * 100).toFixed(0)}%  score=${baseStats.score.toFixed(2)}`)

console.log('Running combinations…')
const results = []

for (const role    of ROLES)   {
for (const minVal  of VALUES)  {
for (const sector  of SECTORS) {
for (const ddOpt   of DD_OPTS) {
  const filtered = all.filter(r =>
    (role    === null || r.role   === role)   &&
    (sector  === null || r.sector === sector) &&
    r.totalVal >= minVal &&
    (ddOpt.threshold === null || (r.maxDD != null && r.maxDD > ddOpt.threshold))
  )
  const s = computeStats(filtered)
  if (!s || s.n < 5) continue
  results.push({ role: role ?? 'all', sector: sector ?? 'all sectors', minVal, dd: ddOpt.label, ...s })
}}}}

results.sort((a, b) => b.score - a.score)
console.log(`${results.length} combinations with n ≥ 5`)

// ─── Format output ────────────────────────────────────────────────────────────

function fmtVal(v) {
  if (v >= 25_000_000) return '$25M+'
  if (v >=  5_000_000) return '$5M+'
  if (v >=  1_000_000) return '$1M+'
  if (v >=    500_000) return '$500K+'
  if (v >=    250_000) return '$250K+'
  return '$100K+'
}

function fmtPct(v) {
  if (v == null) return '   n/a'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

const today = new Date().toISOString().split('T')[0]
const W = 115

const out = []
out.push('='.repeat(W))
out.push('  OPPORTUNISTIC INSIDER BACKTEST — Filter Rankings by Confidence-Weighted Score')
out.push(`  Score = avg_alpha_180d × ln(n)  |  min n = 5  |  ${results.length} combinations ranked`)
out.push(`  Source: output/deep_analysis_v2.csv  |  Clean rows: ${all.length}  |  Run: ${today}`)
out.push('='.repeat(W))
out.push('')
out.push(
  `  Baseline (all trades, no filter): n=${baseStats.n}` +
  `  avg=+${baseStats.avg.toFixed(1)}%` +
  `  med=+${baseStats.med.toFixed(1)}%` +
  `  hit=${(baseStats.hit * 100).toFixed(0)}%` +
  `  score=${baseStats.score.toFixed(2)}`
)
out.push('')
out.push(
  `  ${'Rank'.padStart(5)}  ` +
  `${'Role'.padEnd(20)}  ` +
  `${'Sector'.padEnd(26)}  ` +
  `${'Size'.padEnd(7)}  ` +
  `${'DD'.padEnd(4)}  ` +
  `${'n'.padStart(5)}  ` +
  `${'Hit180'.padStart(7)}  ` +
  `${'Avg180α'.padStart(9)}  ` +
  `${'Med180α'.padStart(9)}  ` +
  `${'Score'.padStart(8)}`
)
out.push('  ' + '─'.repeat(W - 2))

results.forEach((r, i) => {
  out.push(
    `  ${String(i + 1).padStart(5)}  ` +
    `${r.role.padEnd(20)}  ` +
    `${r.sector.padEnd(26)}  ` +
    `${fmtVal(r.minVal).padEnd(7)}  ` +
    `${r.dd.padEnd(4)}  ` +
    `${String(r.n).padStart(5)}  ` +
    `${`${(r.hit * 100).toFixed(0)}%`.padStart(7)}  ` +
    `${fmtPct(r.avg).padStart(9)}  ` +
    `${fmtPct(r.med).padStart(9)}  ` +
    `${r.score.toFixed(2).padStart(8)}`
  )
})

out.push('')
out.push('='.repeat(W))

fs.writeFileSync(OUTPUT, out.join('\n'), 'utf-8')
console.log(`\nWritten to ${OUTPUT}`)
