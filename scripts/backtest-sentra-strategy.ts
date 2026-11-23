// Run with:  npx tsx scripts/backtest-sentra-strategy.ts
//
// Backtest of the Sentra conviction strategy for the presentation slide deck:
//   Universe: OPPORTUNISTIC buys from backtest-universe.csv
//   Filter:   conviction_score >= 80 (joined from DB; OPP-all shown as comparison)
//   Hold:     180 days
//   Exit:     approximate stop-loss -10% / take-profit +20% via return cap
//
// ⚠ DISCLOSED LIMITATIONS:
//   1. CMP classification is retroactive (2026 labels applied to all history)
//   2. conviction_score sparse for older trades if backfill not run
//   3. Stop/take-profit approximated by capping return_180d at [-10%, +20%]
//      — does not capture intraperiod path timing
//
// Outputs:
//   output/backtest-sentra-strategy.json

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

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

const yf = new YahooFinance()
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

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
  const f = parseFloat(v)
  return isNaN(f) ? null : f
}

function avg(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

async function main() {
  const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')
  const OUT_PATH = path.join(__dirname, '..', 'output', 'backtest-sentra-strategy.json')

  if (!fs.existsSync(CSV_PATH)) {
    console.error('ERROR: output/backtest-universe.csv not found. Run backtest-universe.ts first.')
    process.exit(1)
  }

  console.log('Reading backtest-universe.csv...')
  const lines   = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx     = (n: string) => headers.indexOf(n)

  const C = {
    id:               idx('id'),
    ticker:           idx('ticker'),
    classification:   idx('classification'),
    direction:        idx('direction'),
    transaction_date: idx('transaction_date'),
    return_180d:      idx('return_180d'),
    spy_return_180d:  idx('spy_return_180d'),
    total_value:      idx('total_value'),
    insider_name:     idx('insider_name'),
    role_classified:  idx('role_classified'),
    sector:           idx('sector'),
  }

  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing CSV columns:', missing); process.exit(1) }

  type CsvRow = {
    id: string; ticker: string; classification: string; direction: string
    transaction_date: string; return_180d: number | null; spy_return_180d: number | null
    total_value: number | null; insider_name: string; role_classified: string; sector: string
  }

  const allRows: CsvRow[] = lines.slice(1).map(l => {
    const f = parseCsvLine(l)
    return {
      id:               f[C.id]              ?? '',
      ticker:           f[C.ticker]          ?? '',
      classification:   f[C.classification]  ?? '',
      direction:        f[C.direction]        ?? '',
      transaction_date: f[C.transaction_date] ?? '',
      return_180d:      pn(f[C.return_180d]),
      spy_return_180d:  pn(f[C.spy_return_180d]),
      total_value:      pn(f[C.total_value]),
      insider_name:     f[C.insider_name]    ?? '',
      role_classified:  f[C.role_classified] ?? '',
      sector:           f[C.sector]          ?? '',
    }
  })

  const oppBuys = allRows.filter(r =>
    r.classification === 'OPPORTUNISTIC' &&
    r.direction === 'buy' &&
    r.return_180d != null &&
    r.spy_return_180d != null
  )
  console.log(`  ${allRows.length.toLocaleString()} total rows → ${oppBuys.length.toLocaleString()} OPP buys with complete 180d data`)

  // ── Fetch conviction scores from DB ───────────────────────────────────────
  console.log('\nFetching conviction scores from insider_transactions...')
  const ids = oppBuys.map(r => r.id).filter(Boolean)
  const scoreMap = new Map<string, number | null>()

  // Use small batches (100) to stay within PostgREST URL length limits.
  // 1000 UUIDs × 36 chars ≈ 36KB URL → 400 Bad Request. 100 UUIDs ≈ 3.6KB → fine.
  const SCORE_PAGE = 100
  for (let from = 0; from < ids.length; from += SCORE_PAGE) {
    const chunk = ids.slice(from, from + SCORE_PAGE)
    const { data, error } = await supabase
      .from('insider_transactions')
      .select('id, conviction_score')
      .in('id', chunk)
    if (error) {
      console.warn(`  Warning: score fetch error: ${error.message}`)
      continue
    }
    for (const r of data ?? []) {
      scoreMap.set((r as any).id, (r as any).conviction_score ?? null)
    }
    if ((from / SCORE_PAGE) % 10 === 0)
      process.stdout.write(`  fetched ${Math.min(from + SCORE_PAGE, ids.length)}/${ids.length}...\r`)
  }
  const scoredCount = [...scoreMap.values()].filter(v => v != null).length
  console.log(`\n  ${scoredCount.toLocaleString()} of ${ids.length.toLocaleString()} OPP buys have conviction_score`)

  // ── Enrich with scores + effective return ─────────────────────────────────
  type EnrichedRow = CsvRow & { conviction_score: number | null; effective_return: number }

  const enriched: EnrichedRow[] = oppBuys.map(r => ({
    ...r,
    conviction_score: scoreMap.get(r.id) ?? null,
    // Approximate stop-loss -10% / take-profit +20% by capping return_180d
    effective_return: Math.max(-10, Math.min(20, r.return_180d!)),
  }))

  const oppAll    = enriched
  const oppScored = enriched.filter(r => r.conviction_score != null)
  const opp80     = enriched.filter(r => (r.conviction_score ?? -1) >= 80)

  console.log(`\n  All OPP buys:          ${oppAll.length}`)
  console.log(`  OPP buys (scored):     ${oppScored.length}`)
  console.log(`  OPP buys, score ≥ 80:  ${opp80.length}`)

  // ── Russell 3000 benchmark (IWB ETF) ─────────────────────────────────────
  // Fetch IWB to replace SPY as the market comparison for conviction 80+ subset.
  // IWB covers the full Russell 3000 (large + mid + small cap) — more appropriate
  // than SPY alone for a mixed-cap insider universe.
  console.log('\nFetching IWB (Russell 3000 ETF) for market benchmark...')
  const allDates  = oppBuys.map(r => r.transaction_date).sort()
  const fetchStart = new Date(allDates[0])
  fetchStart.setUTCDate(fetchStart.getUTCDate() - 5)
  const fetchEnd  = new Date(allDates[allDates.length - 1])
  fetchEnd.setUTCDate(fetchEnd.getUTCDate() + 195)

  const iwbMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('IWB', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    const quotes: any[] = Array.isArray(ch?.quotes) ? ch.quotes : []
    for (const q of quotes) {
      if (q?.date != null && (q?.adjClose ?? q?.close) != null)
        iwbMap.set(new Date(q.date).toISOString().split('T')[0], q.adjClose ?? q.close)
    }
    console.log(`  ${iwbMap.size} IWB trading days`)
  } catch (e: any) {
    console.warn(`  IWB fetch failed (${e.message}) — will fall back to SPY`)
  }

  function lookupIwb(dateStr: string): number | null {
    for (let i = 0; i <= 7; i++) {
      const d = new Date(dateStr); d.setUTCDate(d.getUTCDate() + i)
      const p = iwbMap.get(d.toISOString().split('T')[0])
      if (p != null) return p
    }
    return null
  }

  function addDays(s: string, n: number): string {
    const d = new Date(s); d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().split('T')[0]
  }

  // Compute IWB 180d return for each OPP buy (null if IWB unavailable or incomplete window)
  const iwbReturnMap = new Map<string, number | null>()
  for (const r of oppBuys) {
    const p0 = lookupIwb(r.transaction_date)
    const p1 = lookupIwb(addDays(r.transaction_date, 180))
    iwbReturnMap.set(r.id, (p0 && p1) ? Math.round(((p1 - p0) / p0) * 10000) / 100 : null)
  }
  const iwbComplete = [...iwbReturnMap.values()].filter(v => v != null).length
  console.log(`  IWB return computed for ${iwbComplete} of ${oppBuys.length} signals`)

  // ── Stats ─────────────────────────────────────────────────────────────────
  type Stats = {
    label: string; n: number
    avg_raw_return: number | null; median_raw_return: number | null
    avg_eff_return: number | null; median_eff_return: number | null
    avg_spy: number | null; avg_alpha_spy: number | null
    avg_iwb: number | null; avg_alpha_iwb: number | null; median_alpha_iwb: number | null
    win_rate: number | null; pct_of_all_opp: number | null
  }

  function computeStats(rows: EnrichedRow[], label: string): Stats {
    if (!rows.length) return {
      label, n: 0,
      avg_raw_return: null, median_raw_return: null,
      avg_eff_return: null, median_eff_return: null,
      avg_spy: null, avg_alpha_spy: null,
      avg_iwb: null, avg_alpha_iwb: null, median_alpha_iwb: null,
      win_rate: null, pct_of_all_opp: null,
    }
    const raws   = rows.map(r => r.return_180d!)
    const effs   = rows.map(r => r.effective_return)
    const spys   = rows.map(r => r.spy_return_180d!)

    // IWB comparison — only rows where IWB return is available
    const iwbPairs = rows
      .map(r => ({ eff: r.effective_return, raw: r.return_180d!, iwb: iwbReturnMap.get(r.id) ?? null }))
      .filter(p => p.iwb != null)
    const iwbAlphas = iwbPairs.map(p => p.raw - p.iwb!)
    const iwbVals   = iwbPairs.map(p => p.iwb!)

    return {
      label, n: rows.length,
      avg_raw_return:    avg(raws),
      median_raw_return: median(raws),
      avg_eff_return:    avg(effs),
      median_eff_return: median(effs),
      avg_spy:           avg(spys),
      avg_alpha_spy:     avg(effs.map((e, i) => e - spys[i])),
      avg_iwb:           avg(iwbVals) ?? null,
      avg_alpha_iwb:     avg(iwbAlphas) ?? null,
      median_alpha_iwb:  median(iwbAlphas) ?? null,
      win_rate:          raws.filter(v => v > 0).length / raws.length,
      pct_of_all_opp:    rows.length / oppAll.length,
    }
  }

  const statsAll    = computeStats(oppAll,    'All OPPORTUNISTIC buys')
  const statsScored = computeStats(oppScored, 'OPPORTUNISTIC, scored')
  const stats80     = computeStats(opp80,     'OPPORTUNISTIC, score ≥ 80')

  // Print summary
  const fmt1 = (v: number | null) => v == null ? 'N/A' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
  const fmtP = (v: number | null) => v == null ? 'N/A' : (v * 100).toFixed(0) + '%'
  console.log('\n' + '═'.repeat(70))
  for (const s of [statsAll, statsScored, stats80]) {
    console.log(`\n  ${s.label}  (n=${s.n})`)
    console.log(`    Avg uncapped 180d return:                ${fmt1(s.avg_raw_return)}`)
    console.log(`    Avg effective return (capped -10/+20):  ${fmt1(s.avg_eff_return)}`)
    console.log(`    Avg SPY return (same 180d window):       ${fmt1(s.avg_spy)}`)
    console.log(`    Avg IWB (Russell 3000) return:           ${fmt1(s.avg_iwb)}`)
    console.log(`    Avg alpha vs Russell 3000 (uncapped):    ${fmt1(s.avg_alpha_iwb)}`)
    console.log(`    Median alpha vs Russell 3000:            ${fmt1(s.median_alpha_iwb)}`)
    console.log(`    Win rate (raw return > 0):               ${fmtP(s.win_rate)}`)
  }
  console.log('\n' + '═'.repeat(70))

  // ── Quarterly aggregates — correct chart for a slide deck ─────────────────
  // For each quarter, compute avg effective_return and avg SPY return for signals
  // starting in that quarter. Shows repeated-bet expected value, not compounding.
  function quarterlyAgg(rows: EnrichedRow[]): Array<{
    quarter: string; n: number; avg_return: number | null; avg_spy: number | null; avg_alpha: number | null
  }> {
    const m = new Map<string, EnrichedRow[]>()
    for (const r of rows) {
      const d = r.transaction_date
      const y = d.slice(0, 4)
      const mo = parseInt(d.slice(5, 7), 10)
      const q = `${y}-Q${Math.ceil(mo / 3)}`
      if (!m.has(q)) m.set(q, [])
      m.get(q)!.push(r)
    }
    return [...m.entries()].sort().map(([quarter, rs]) => ({
      quarter, n: rs.length,
      avg_return: avg(rs.map(r => r.effective_return)),
      avg_spy:    avg(rs.map(r => r.spy_return_180d!)),
      avg_alpha:  avg(rs.map(r => r.effective_return - r.spy_return_180d!)),
    }))
  }

  const curveAll = quarterlyAgg(oppAll)
  const curve80  = opp80.length >= 10 ? quarterlyAgg(opp80) : null

  // ── Year-by-year breakdown ─────────────────────────────────────────────────
  function byYear(rows: EnrichedRow[]): Array<{ year: string; n: number; avg_alpha: number | null; win_rate: number | null }> {
    const m = new Map<string, EnrichedRow[]>()
    for (const r of rows) {
      const y = r.transaction_date.slice(0, 4)
      if (!m.has(y)) m.set(y, [])
      m.get(y)!.push(r)
    }
    return [...m.entries()].sort().map(([year, rs]) => ({
      year, n: rs.length,
      avg_alpha: avg(rs.map(r => r.effective_return - r.spy_return_180d!)),
      win_rate:  rs.filter(r => r.effective_return > 0).length / rs.length,
    }))
  }

  // ── Top trades ─────────────────────────────────────────────────────────────
  const targetUniverse = opp80.length >= 10 ? opp80 : oppAll
  const topTrades = [...targetUniverse]
    .sort((a, b) => b.effective_return - a.effective_return)
    .slice(0, 10)
    .map(r => ({
      date:             r.transaction_date,
      ticker:           r.ticker,
      insider:          r.insider_name,
      role:             r.role_classified,
      score:            r.conviction_score,
      total_value:      r.total_value,
      effective_return: r.effective_return,
      return_180d:      r.return_180d,
      alpha:            r.effective_return - r.spy_return_180d!,
    }))

  // ── Equity curve trades list (all conviction 80+ in exit-date order) ───────
  // Each trade: entry_date, exit_date (entry + 180d), effective_return, iwb_return.
  // The chart plots cumulative P&L of all CLOSED trades over time.
  function addDaysStr(s: string, n: number): string {
    const d = new Date(s); d.setUTCDate(d.getUTCDate() + n)
    return d.toISOString().split('T')[0]
  }

  const equityTrades = [...opp80]
    .map(r => ({
      entry:    r.transaction_date,
      exit:     addDaysStr(r.transaction_date, 180),
      raw_ret:  r.return_180d,                              // uncapped 180d return (signal quality)
      eff_ret:  r.effective_return,                          // capped -10/+20
      iwb_ret:  iwbReturnMap.get(r.id) ?? null,
      ticker:   r.ticker,
      score:    r.conviction_score,
    }))
    .filter(t => t.iwb_ret != null)
    .sort((a, b) => a.exit.localeCompare(b.exit))

  // ── Output ─────────────────────────────────────────────────────────────────
  const output = {
    generated_at: new Date().toISOString(),
    window: {
      start: oppAll[0]?.transaction_date ?? 'N/A',
      end:   oppAll[oppAll.length - 1]?.transaction_date ?? 'N/A',
    },
    limitations: [
      'CMP classification is retroactive (2026 labels applied to all historical trades) — this is an optimistic ceiling, not live performance',
      opp80.length < oppAll.length * 0.1
        ? `conviction_score ≥ 80 filter covers only ${opp80.length} of ${oppAll.length} OPP buys — backfill may not have run for older trades`
        : `conviction_score ≥ 80 filter: ${opp80.length} of ${oppAll.length} OPP buys (${(opp80.length / oppAll.length * 100).toFixed(0)}%)`,
      'Stop-loss -10% / take-profit +20% approximated by capping return_180d — intraperiod path timing not modeled',
    ],
    stats: {
      all:    statsAll,
      scored: statsScored,
      hi80:   stats80,
    },
    curves: {
      all:  curveAll,
      hi80: curve80,
    },
    by_year: {
      all:  byYear(oppAll),
      hi80: opp80.length >= 10 ? byYear(opp80) : null,
    },
    top_trades:    topTrades,
    equity_trades: equityTrades,
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2))
  console.log(`\nOutput → output/backtest-sentra-strategy.json`)

  if (opp80.length < 10) {
    console.log('\n⚠ NOTICE: Too few trades in OPP + score ≥ 80 universe to be meaningful.')
    console.log('  This likely means conviction_score was not backfilled for historical trades.')
    console.log('  Steps to fix:')
    console.log('  1. Apply supabase/migrations/20260728_add_classification_column.sql')
    console.log('  2. npx tsx scripts/backfill-conviction-score.ts --dry-run')
    console.log('  3. npx tsx scripts/backfill-conviction-score.ts')
    console.log('  4. Re-run this script')
    console.log('\n  Until then, the artifact will show OPP-all as the primary universe.')
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
