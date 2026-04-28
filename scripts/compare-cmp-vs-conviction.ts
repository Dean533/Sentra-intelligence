// Compare CMP directional signals vs. conviction scoring system.
// Usage:  npx tsx scripts/compare-cmp-vs-conviction.ts
//    or:  npx ts-node --esm scripts/compare-cmp-vs-conviction.ts

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  computeConvictionScore,
  ConvictionTrade,
  TradeOutcome,
} from '../lib/scoring/convictionScore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ── 2. CSV helpers ────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"')              inQ = !inQ
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else                         cur += ch
  }
  out.push(cur)
  return out
}

function readCSV(filePath: string): Record<string, string>[] {
  const lines   = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim())
  const headers = parseCSVLine(lines[0])
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    if (vals.length !== headers.length) continue
    const row: Record<string, string> = {}
    headers.forEach((h, j) => { row[h] = vals[j] })
    rows.push(row)
  }
  return rows
}

// ── 3. Numeric / stat helpers ─────────────────────────────────────────────────

function num(v: string | undefined): number | null {
  if (!v || v === '' || v === 'NA' || v === 'null') return null
  const f = parseFloat(v)
  return isNaN(f) ? null : f
}

function monthKey(d: string): string { return d.slice(0, 7) }  // "YYYY-MM"

function medianOf(arr: number[]): number | null {
  if (!arr.length) return null
  const s = arr.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type Stats = { n: number; hitRate: number; avgAlpha: number }

function calcStats(alphas: number[]): Stats {
  if (!alphas.length) return { n: 0, hitRate: 0, avgAlpha: 0 }
  return {
    n:        alphas.length,
    hitRate:  alphas.filter(a => a > 0).length / alphas.length,
    avgAlpha: alphas.reduce((s, a) => s + a, 0) / alphas.length,
  }
}

function fmt(s: Stats, label: string, indent = '   ') {
  if (s.n === 0) { console.log(`${indent}${label}: (no data)`); return }
  const hit   = (s.hitRate  * 100).toFixed(1)
  const alpha = s.avgAlpha.toFixed(2)
  const sign  = s.avgAlpha >= 0 ? '+' : ''
  console.log(`${indent}${label}: ${String(s.n).padStart(4)} trades   hit rate ${hit.padStart(5)}%   avg alpha ${sign}${alpha}%`)
}

// ── 4. Main ───────────────────────────────────────────────────────────────────

async function main() {
  // ── 5a. Load opportunistic CIKs from Supabase ──────────────────────────────
  console.log('Fetching classifications from Supabase…')
  const { data: cls, error: clsErr } = await supabase
    .from('insider_classifications')
    .select('insider_cik, classification')
  if (clsErr) { console.error(clsErr.message); process.exit(1) }

  const opportunisticCiks = new Set(
    (cls ?? [])
      .filter((c: any) => c.classification === 'OPPORTUNISTIC')
      .map((c: any) => c.insider_cik as string)
  )
  console.log(`Opportunistic insiders: ${opportunisticCiks.size}`)

  // ── 5b. Load CSV ────────────────────────────────────────────────────────────
  const csvPath = path.join(__dirname, '..', 'output', 'deep_analysis_v2.csv')
  if (!fs.existsSync(csvPath)) {
    console.error('Missing output/deep_analysis_v2.csv — run the enrichment scripts first.')
    process.exit(1)
  }
  const all = readCSV(csvPath)
  console.log(`Loaded ${all.length} rows from deep_analysis_v2.csv`)

  // Filter: opportunistic buys with at least 90d outcome
  const rows = all.filter(r =>
    r.transaction_direction === 'buy' &&
    r.insider_cik &&
    opportunisticCiks.has(r.insider_cik) &&
    num(r.adjusted_return_90d) !== null
  )
  console.log(`Opportunistic buys with 90d outcome: ${rows.length}\n`)

  if (rows.length === 0) {
    console.error('No qualifying rows found. Check CIK matching and CSV columns.')
    process.exit(1)
  }

  // ── 5c. Pre-compute cluster context per ticker+month ───────────────────────
  type Cluster = { count: number; totalValue: number }
  const clusterMap = new Map<string, Cluster>()
  for (const r of rows) {
    const key = `${r.ticker}|${monthKey(r.transaction_date)}`
    const val = num(r.total_value) ?? 0
    if (!clusterMap.has(key)) clusterMap.set(key, { count: 0, totalValue: 0 })
    const c = clusterMap.get(key)!
    c.count++
    c.totalValue += val
  }

  // ── 5d. Pre-compute per-insider history (sorted by date) ───────────────────
  type PastTx = { date: string; alpha90: number; value: number }
  const insiderMap = new Map<string, PastTx[]>()
  for (const r of rows) {
    const a90 = num(r.adjusted_return_90d)
    if (!r.insider_cik || a90 === null) continue
    if (!insiderMap.has(r.insider_cik)) insiderMap.set(r.insider_cik, [])
    insiderMap.get(r.insider_cik)!.push({
      date:    r.transaction_date,
      alpha90: a90,
      value:   num(r.total_value) ?? 0,
    })
  }
  for (const h of insiderMap.values()) h.sort((a, b) => a.date.localeCompare(b.date))

  // ── 5e. Score every trade via conviction engine ────────────────────────────
  type Scored = { score: number; alpha90: number; alpha180: number | null; clusterCount: number }
  const scored: Scored[] = []

  for (const r of rows) {
    const val     = num(r.total_value) ?? 0
    const key     = `${r.ticker}|${monthKey(r.transaction_date)}`
    const cluster = clusterMap.get(key) ?? { count: 1, totalValue: val }

    const past         = insiderMap.get(r.insider_cik) ?? []
    const priorTrades  = past.filter(h => h.date < r.transaction_date)
    const insiderHist: TradeOutcome[] = priorTrades.map(h => ({ isPositive: h.alpha90 > 0 }))
    const medianValue  = medianOf(priorTrades.map(h => h.value))

    const trade: ConvictionTrade = {
      ticker:                    r.ticker,
      insider_name:              r.insider_name   ?? '',
      officer_title:             r.officer_title  || null,
      role:                      r.role           || null,
      total_value:               val > 0 ? val : null,
      price_per_share:           num(r.price_per_share) ?? num(r.price_entry),
      transaction_date:          r.transaction_date,
      is_opportunistic:          true,
      is_inferred_opportunistic: false,
      is_local:                  null,
      sector:                    r.sector         || null,
      cluster_count:             cluster.count,
      cluster_total_value:       cluster.totalValue,
      insider_median_value:      medianValue,
    }

    const { score } = computeConvictionScore(trade, insiderHist, [])

    scored.push({
      score,
      alpha90:      num(r.adjusted_return_90d)!,
      alpha180:     num(r.adjusted_return_180d),
      clusterCount: cluster.count,
    })
  }

  // ── 5f. Print results ─────────────────────────────────────────────────────
  const line = '═'.repeat(62)
  console.log(line)
  console.log('  Conviction Score — Backtest Results')
  console.log(`  Dataset: ${scored.length} opportunistic buys, 2015–2026`)
  console.log(line)

  console.log('\n▶  All Opportunistic Trades  (no score filter)')
  fmt(calcStats(scored.map(s => s.alpha90)),                                   ' 90d alpha')
  fmt(calcStats(scored.map(s => s.alpha180).filter((a): a is number => a != null)), '180d alpha')

  const tiers: Array<{ label: string; min: number; max?: number }> = [
    { label: 'Score  ≥60  (Tier 2 + Tier 1)',   min: 60 },
    { label: 'Score  ≥70  (Tier 1)',             min: 70 },
    { label: 'Score  ≥85  (High Conviction)',    min: 85 },
  ]

  for (const tier of tiers) {
    const sub = scored.filter(s => s.score >= tier.min)
    console.log(`\n▶  ${tier.label}`)
    fmt(calcStats(sub.map(s => s.alpha90)),                                        ' 90d alpha')
    fmt(calcStats(sub.map(s => s.alpha180).filter((a): a is number => a != null)), '180d alpha')
  }

  // Score distribution table
  console.log('\n▶  Score Distribution')
  console.log('   ' + '─'.repeat(55))
  const buckets = [
    { label: '≥85',   f: (s: Scored) => s.score >= 85 },
    { label: '70–84', f: (s: Scored) => s.score >= 70 && s.score < 85 },
    { label: '60–69', f: (s: Scored) => s.score >= 60 && s.score < 70 },
    { label: '50–59', f: (s: Scored) => s.score >= 50 && s.score < 60 },
    { label: '<50',   f: (s: Scored) => s.score < 50 },
  ]
  for (const b of buckets) {
    const sub = scored.filter(b.f)
    const st  = calcStats(sub.map(s => s.alpha90))
    const bar = '█'.repeat(Math.min(20, Math.round(sub.length / Math.max(scored.length / 20, 1))))
    const hit  = st.n ? (st.hitRate  * 100).toFixed(0) : '--'
    const alp  = st.n ? ((st.avgAlpha >= 0 ? '+' : '') + st.avgAlpha.toFixed(1) + '%') : '--'
    console.log(
      `   ${b.label.padEnd(6)}  ${String(sub.length).padStart(4)} trades` +
      `   hit ${String(hit).padStart(3)}%` +
      `   alpha ${alp.padStart(7)}   ${bar}`
    )
  }

  // Cluster breakdown
  console.log('\n▶  Cluster Effect on Conviction ≥70')
  const t70 = scored.filter(s => s.score >= 70)
  const t70c1 = t70.filter(s => s.clusterCount === 1)
  const t70c2 = t70.filter(s => s.clusterCount >= 2 && s.clusterCount < 4)
  const t70c4 = t70.filter(s => s.clusterCount >= 4)
  fmt(calcStats(t70c1.map(s => s.alpha90)), '1 insider     90d')
  fmt(calcStats(t70c2.map(s => s.alpha90)), '2–3 insiders  90d')
  fmt(calcStats(t70c4.map(s => s.alpha90)), '4+ insiders   90d')

  console.log(`\n${line}\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
