import * as fs from 'fs'
import * as path from 'path'
import { computeConvictionScore, ConvictionTrade } from '../lib/scoring/convictionScore'

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

// ── output tee ────────────────────────────────────────────────────────────────

const lines: string[] = []
function out(s = '') { console.log(s); lines.push(s) }
function hr(char = '─', len = 80) { out(char.repeat(len)) }

// ── stats helpers ─────────────────────────────────────────────────────────────

function mean(v: number[]) { return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
function hitRate(v: number[]) { return v.length ? v.filter(x => x > 0).length / v.length : NaN }
function fmt(n: number) { return isNaN(n) ? '    N/A' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }
function fmtPct(n: number) { return isNaN(n) ? '  N/A' : `${(n * 100).toFixed(1)}%` }

// ── main ──────────────────────────────────────────────────────────────────────

function main() {
  const csvPath = path.join(__dirname, '..', 'output', 'deep_analysis_v2.csv')
  if (!fs.existsSync(csvPath)) { console.error('ERROR: deep_analysis_v2.csv not found'); process.exit(1) }

  const rawRows = parseCSV(fs.readFileSync(csvPath, 'utf-8'))

  // Filter to buy (code P) trades with both outcome columns
  const eligible = rawRows.filter(r =>
    r.transaction_code === 'P' &&
    r.transaction_direction === 'buy' &&
    r.adjusted_return_90d  !== '' &&
    r.adjusted_return_180d !== ''
  )

  out(`Loaded ${rawRows.length} total rows → ${eligible.length} eligible (buy, code P, with 90d+180d outcomes)`)
  out()

  // ── Pre-compute cluster counts and values per ticker+month ────────────────
  const clusterBuys   = new Map<string, Set<string>>()   // key -> insider names
  const clusterValues = new Map<string, number>()         // key -> total buy value

  for (const r of rawRows.filter(r => r.transaction_code === 'P' && r.transaction_direction === 'buy')) {
    const key = `${r.ticker}_${r.transaction_date.slice(0, 7)}`
    if (!clusterBuys.has(key))   clusterBuys.set(key, new Set())
    if (!clusterValues.has(key)) clusterValues.set(key, 0)
    clusterBuys.get(key)!.add(r.insider_name)
    clusterValues.set(key, clusterValues.get(key)! + (parseFloat(r.total_value) || 0))
  }

  // ── Pre-compute insider median trade values ───────────────────────────────
  const insiderValMap = new Map<string, number[]>()
  for (const r of rawRows.filter(r => r.transaction_code === 'P' && r.transaction_direction === 'buy')) {
    const cik = r.insider_cik
    if (!cik) continue
    if (!insiderValMap.has(cik)) insiderValMap.set(cik, [])
    insiderValMap.get(cik)!.push(parseFloat(r.total_value) || 0)
  }
  const insiderMedians = new Map<string, number>()
  for (const [cik, vals] of insiderValMap) {
    const s = vals.slice().sort((a, b) => a - b)
    const m = Math.floor(s.length / 2)
    const med = s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2
    if (med > 0) insiderMedians.set(cik, med)
  }

  // ── Score every eligible trade ────────────────────────────────────────────
  interface Result {
    score:       number
    alpha90:     number
    alpha180:    number
    role:        string
    factors:     string[]
    ticker:      string
    insider:     string
    date:        string
  }

  const results: Result[] = []

  for (const r of eligible) {
    const key = `${r.ticker}_${r.transaction_date.slice(0, 7)}`
    const clusterCount = clusterBuys.get(key)?.size ?? 1
    const clusterValue = clusterValues.get(key) ?? 0
    const insiderMedian = r.insider_cik ? (insiderMedians.get(r.insider_cik) ?? null) : null

    const trade: ConvictionTrade = {
      ticker:               r.ticker,
      insider_name:         r.insider_name,
      officer_title:        r.officer_title || null,
      role:                 r.role || null,
      total_value:          parseFloat(r.total_value) || 0,
      price_per_share:      r.price_per_share ? parseFloat(r.price_per_share) : null,
      transaction_date:     r.transaction_date,
      is_opportunistic:     true,    // CSV is all-opportunistic
      is_inferred_opportunistic: false,
      is_local:             null,    // not in CSV, fetched separately in live flow
      sector:               r.sector || null,
      cluster_count:        clusterCount,
      cluster_total_value:  clusterValue,
      insider_median_value: insiderMedian,
    }

    const spy = r.spy_return_90d ? parseFloat(r.spy_return_90d) : null

    const { score, role, factors } = computeConvictionScore(trade, [], [], spy)

    results.push({
      score,
      alpha90:  parseFloat(r.adjusted_return_90d),
      alpha180: parseFloat(r.adjusted_return_180d),
      role,
      factors,
      ticker:   r.ticker,
      insider:  r.insider_name,
      date:     r.transaction_date,
    })
  }

  const total = results.length

  // ── Score distribution ────────────────────────────────────────────────────
  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  out('BACKTEST — NEW CONVICTION SCORING vs 322 OPPORTUNISTIC TRADES (2015–2026)')
  out('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  out()
  out('Note: insiderHistory, tickerHistory, and is_local are all empty/null in this backtest.')
  out('Live scoring will be higher due to track-record and local-insider bonuses.')
  out()

  // Overall baseline
  const all90  = results.map(r => r.alpha90)
  const all180 = results.map(r => r.alpha180)
  out(`Overall baseline (n=${total}):  90d α=${fmt(mean(all90))}  180d α=${fmt(mean(all180))}  hit90=${fmtPct(hitRate(all90))}  hit180=${fmtPct(hitRate(all180))}`)
  out()

  const scoreRange = [
    Math.min(...results.map(r => r.score)),
    Math.max(...results.map(r => r.score)),
    mean(results.map(r => r.score)),
  ]
  out(`Score range: min=${scoreRange[0]}  max=${scoreRange[1]}  avg=${scoreRange[2].toFixed(1)}`)
  out()

  // ── Score bucket table ────────────────────────────────────────────────────
  hr('═')
  out('SCORE BUCKETS')
  hr('═')

  const buckets: [string, number, number][] = [
    ['< 55  (below base)',  0,  54],
    ['55–59 (base only)',  55,  59],
    ['60–64',             60,  64],
    ['65–69',             65,  69],
    ['70–74 ▶ TIER 1',   70,  74],
    ['75–79 ▶ TIER 1',   75,  79],
    ['80–84 ▶ TIER 1',   80,  84],
    ['85–89 ▶ TIER 1',   85,  89],
    ['90–100 ▶ TIER 1',  90, 100],
  ]

  const hdr =
    'Bucket'.padEnd(22) +
    'n'.padStart(5) + '  %'.padStart(6) +
    '  hit90'.padStart(8) + '  hit180'.padStart(9) +
    '  α90'.padStart(9) + '  α180'.padStart(9)
  out(hdr)
  hr()

  for (const [label, lo, hi] of buckets) {
    const sub   = results.filter(r => r.score >= lo && r.score <= hi)
    const n     = sub.length
    const pct   = n / total * 100
    const a90   = sub.map(r => r.alpha90)
    const a180  = sub.map(r => r.alpha180)
    out(
      label.padEnd(22) +
      n.toString().padStart(5) +
      `  ${pct.toFixed(1)}%`.padStart(6) +
      `  ${fmtPct(hitRate(a90))}`.padStart(8) +
      `  ${fmtPct(hitRate(a180))}`.padStart(9) +
      `  ${fmt(mean(a90))}`.padStart(9) +
      `  ${fmt(mean(a180))}`.padStart(9)
    )
  }

  hr()
  out(
    'TOTAL'.padEnd(22) +
    total.toString().padStart(5) +
    '  100%'.padStart(6) +
    `  ${fmtPct(hitRate(all90))}`.padStart(8) +
    `  ${fmtPct(hitRate(all180))}`.padStart(9) +
    `  ${fmt(mean(all90))}`.padStart(9) +
    `  ${fmt(mean(all180))}`.padStart(9)
  )

  // ── Classification distribution ───────────────────────────────────────────
  out()
  hr('═')
  out('CLASSIFICATION DISTRIBUTION')
  hr('═')

  const clsBuckets: [string, number, number, boolean][] = [
    ['HIGH_CONVICTION (≥70)',  70, 100, true],
    ['TAKE_TRADE (60–69)',     60,  69, true],
    ['MONITOR (50–59)',        50,  59, true],
    ['DO_NOT_TRADE (<50)',      0,  49, true],
  ]
  for (const [label, lo, hi] of clsBuckets) {
    const sub = results.filter(r => r.score >= lo && r.score <= hi)
    const a90 = sub.map(r => r.alpha90)
    out(
      `  ${label.padEnd(25)} n=${sub.length.toString().padStart(4)} (${(sub.length/total*100).toFixed(1)}%)` +
      `  α90=${fmt(mean(a90))}  hit90=${fmtPct(hitRate(a90))}`
    )
  }

  // ── Role distribution within scored trades ────────────────────────────────
  out()
  hr('═')
  out('ROLE DISTRIBUTION IN RESULTS')
  hr('═')

  const roleMap = new Map<string, Result[]>()
  for (const r of results) {
    if (!roleMap.has(r.role)) roleMap.set(r.role, [])
    roleMap.get(r.role)!.push(r)
  }
  out('  ' + 'Role'.padEnd(20) + 'n'.padStart(5) + '  avg score'.padStart(11) + '  α90'.padStart(9) + '  hit90'.padStart(8))
  hr()
  for (const [role, trades] of [...roleMap.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const avgScore = mean(trades.map(t => t.score))
    const a90 = trades.map(t => t.alpha90)
    out('  ' + role.padEnd(20) + trades.length.toString().padStart(5) + `  ${avgScore.toFixed(1)}`.padStart(11) + `  ${fmt(mean(a90))}`.padStart(9) + `  ${fmtPct(hitRate(a90))}`.padStart(8))
  }

  // ── Top 15 highest-scoring trades ─────────────────────────────────────────
  out()
  hr('═')
  out('TOP 15 HIGHEST-SCORING TRADES')
  hr('═')
  const top15 = [...results].sort((a, b) => b.score - a.score).slice(0, 15)
  for (const r of top15) {
    out(`  [${r.score.toString().padStart(3)}] ${r.ticker.padEnd(6)} ${r.date}  ${r.insider.slice(0, 22).padEnd(22)}  α90=${fmt(r.alpha90)}  α180=${fmt(r.alpha180)}`)
    out(`        ${r.factors.join(' · ')}`)
    out()
  }

  // ── Bottom 10 lowest-scoring (should have worst alpha) ────────────────────
  out()
  hr('═')
  out('BOTTOM 10 LOWEST-SCORING TRADES')
  hr('═')
  const bottom10 = [...results].sort((a, b) => a.score - b.score).slice(0, 10)
  for (const r of bottom10) {
    out(`  [${r.score.toString().padStart(3)}] ${r.ticker.padEnd(6)} ${r.date}  ${r.insider.slice(0, 22).padEnd(22)}  α90=${fmt(r.alpha90)}  α180=${fmt(r.alpha180)}`)
    out(`        ${r.factors.join(' · ')}`)
    out()
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  hr('═')
  const outPath = path.join(__dirname, '..', 'output', 'backtest-scoring.txt')
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
  console.log(`Saved → output/backtest-scoring.txt`)
}

main()
