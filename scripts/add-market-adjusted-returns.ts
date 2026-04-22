// Reads output/opportunistic_trades_enriched.csv, adds spy_return_90d and
// adjusted_return_90d columns, rewrites the CSV, and prints a summary.
// Run with:  npx tsx scripts/add-market-adjusted-returns.ts

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('.env.local not found'); process.exit(1) }
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

const yahooFinance = new YahooFinance()

const CSV_IN  = path.join(__dirname, '..', 'output', 'opportunistic_trades_enriched.csv')
const CSV_OUT = CSV_IN  // overwrite in place

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const [headerLine, ...dataLines] = content.trim().split('\n')
  const headers = headerLine.split(',')
  const rows = dataLines.map(line => {
    const cells: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    return cells
  })
  return { headers, rows }
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s
}

// ─── Price helpers ────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function buildPriceMap(quotes: any[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date == null || q?.close == null) continue
    map.set(isoDate(new Date(q.date)), q.close)
  }
  return map
}

// Nearest trading day on or after target, up to 7 days forward
function lookupPrice(map: Map<string, number>, target: Date): number | null {
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(target)
    d.setUTCDate(d.getUTCDate() + offset)
    const price = map.get(isoDate(d))
    if (price != null) return price
  }
  return null
}

function pct(entry: number, exit: number): number {
  return Math.round(((exit - entry) / entry) * 10000) / 100
}

// ─── Analysis printer ─────────────────────────────────────────────────────────

async function printSummary(
  rows:      string[][],
  headers:   string[],
  sectorMap: Record<string, string>
) {
  const idx = (col: string) => headers.indexOf(col)
  const num = (row: string[], col: string) => {
    const v = row[idx(col)]; return v === '' ? null : parseFloat(v)
  }
  const str = (row: string[], col: string) => row[idx(col)] ?? ''

  const withReturn = rows.filter(r => num(r, 'adjusted_return_90d') !== null)
  const winners    = withReturn.filter(r => (num(r, 'adjusted_return_90d') ?? 0) > 0)
  const losers     = withReturn.filter(r => (num(r, 'adjusted_return_90d') ?? 0) < 0)

  const avg = (arr: string[][], col: string) =>
    arr.length === 0 ? null : arr.reduce((s, r) => s + (num(r, col) ?? 0), 0) / arr.length
  const sum = (arr: string[][], col: string) =>
    arr.reduce((s, r) => s + (num(r, col) ?? 0), 0)

  const avgWin  = avg(winners,     'adjusted_return_90d')
  const avgLoss = avg(losers,      'adjusted_return_90d')
  const avgAll  = avg(withReturn,  'adjusted_return_90d')
  const avgRaw  = avg(withReturn,  'return_90d')
  const avgSpy  = avg(withReturn,  'spy_return_90d')

  const sorted   = [...withReturn].sort((a,b) => (num(b,'adjusted_return_90d')??0) - (num(a,'adjusted_return_90d')??0))
  const bigWin   = sorted[0]
  const bigLoss  = sorted[sorted.length - 1]

  const winDollars   = sum(winners, 'total_value')
  const lossDollars  = sum(losers,  'total_value')
  const totalDollars = winDollars + lossDollars
  const winDollarPct  = totalDollars > 0 ? (winDollars  / totalDollars * 100).toFixed(1) : 'n/a'
  const lossDollarPct = totalDollars > 0 ? (lossDollars / totalDollars * 100).toFixed(1) : 'n/a'

  const fmv = (n: number) =>
    n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` :
    n >= 1e6 ? `$${(n/1e6).toFixed(1)}M` : `$${(n/1e3).toFixed(0)}K`
  const fm = (n: number | null) =>
    n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(2) + '%'

  // By sector
  const bySector: Record<string, { wins: number; total: number; totalReturn: number }> = {}
  for (const r of withReturn) {
    const sector = sectorMap[str(r, 'ticker')] ?? 'Unknown'
    if (!bySector[sector]) bySector[sector] = { wins: 0, total: 0, totalReturn: 0 }
    bySector[sector].total++
    bySector[sector].totalReturn += num(r, 'adjusted_return_90d') ?? 0
    if ((num(r, 'adjusted_return_90d') ?? 0) > 0) bySector[sector].wins++
  }
  const sectorTable = Object.entries(bySector)
    .filter(([, s]) => s.total >= 2)
    .map(([sector, s]) => ({
      sector,
      wins: s.wins,
      total: s.total,
      winRate: (s.wins / s.total * 100).toFixed(0) + '%',
      avgReturn: (s.totalReturn / s.total).toFixed(2) + '%',
    }))
    .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))

  console.log('\n══════════════════════════════════════════════════════════')
  console.log('  OPPORTUNISTIC INSIDER SIGNAL — MARKET-ADJUSTED 90-DAY BACKTEST')
  console.log('══════════════════════════════════════════════════════════')
  console.log(`  Trades with 90d data        : ${withReturn.length}  (${winners.length} beat market / ${losers.length} underperformed)`)
  console.log(`  Market-adjusted win rate    : ${(winners.length / withReturn.length * 100).toFixed(1)}%`)
  console.log()
  console.log('── CONTEXT ────────────────────────────────────────────────')
  console.log(`  Avg raw return (90d)        : ${fm(avgRaw)}`)
  console.log(`  Avg SPY return (same window): ${fm(avgSpy)}`)
  console.log(`  Avg alpha (adjusted)        : ${fm(avgAll)}`)
  console.log()
  console.log('── ADJUSTED RETURNS ───────────────────────────────────────')
  console.log(`  Avg alpha (winners)         : ${fm(avgWin)}`)
  console.log(`  Avg alpha (losers)          : ${fm(avgLoss)}`)
  console.log(`  Biggest outperformer        : ${fm(num(bigWin,'adjusted_return_90d'))}  ${str(bigWin,'ticker')} (${str(bigWin,'transaction_date')})`)
  console.log(`  Biggest underperformer      : ${fm(num(bigLoss,'adjusted_return_90d'))}  ${str(bigLoss,'ticker')} (${str(bigLoss,'transaction_date')})`)
  console.log()
  console.log('── DOLLAR SPLIT ───────────────────────────────────────────')
  console.log(`  Capital that beat market    : ${winDollarPct}%  (${fmv(winDollars)})`)
  console.log(`  Capital that lagged market  : ${lossDollarPct}%  (${fmv(lossDollars)})`)
  console.log()
  console.log('── BY SECTOR (≥2 trades, sorted by alpha win rate) ────────')
  for (const s of sectorTable) {
    const pad = s.sector.padEnd(28)
    console.log(`  ${pad} win rate ${s.winRate.padStart(4)}  avg alpha ${s.avgReturn.padStart(8)}  (n=${s.total})`)
  }
  console.log('══════════════════════════════════════════════════════════\n')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_IN)) {
    console.error(`CSV not found: ${CSV_IN}`)
    process.exit(1)
  }

  const { headers, rows } = parseCsv(fs.readFileSync(CSV_IN, 'utf-8'))
  const idx = (col: string) => headers.indexOf(col)

  // Rows that already have a 90d return (i.e. the window has closed)
  const enrichableRows = rows.filter(r => r[idx('return_90d')] !== '')
  const unenrichableRows = rows.filter(r => r[idx('return_90d')] === '')

  if (enrichableRows.length === 0) {
    console.log('No rows with return_90d data found.')
    process.exit(0)
  }

  // Date range for SPY: min transaction_date → max transaction_date + 95 days
  const dates = enrichableRows.map(r => r[idx('transaction_date')]).filter(Boolean).sort()
  const spyStart = new Date(dates[0])
  const spyEnd   = addDays(dates[dates.length - 1], 95)

  console.log(`Fetching SPY prices: ${isoDate(spyStart)} → ${isoDate(spyEnd)}...`)

  let spyMap = new Map<string, number>()
  try {
    const chart: any = await yahooFinance.chart('SPY', {
      period1:  spyStart,
      period2:  spyEnd,
      interval: '1d',
    })
    spyMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    console.log(`  ${spyMap.size} SPY price points loaded`)
  } catch (err: any) {
    console.error('Failed to fetch SPY:', err.message)
    process.exit(1)
  }

  // Add new columns to headers if not already present
  const newCols = ['spy_return_90d', 'adjusted_return_90d']
  const outHeaders = [...headers.filter(h => !newCols.includes(h)), ...newCols]
  const spyIdx = (col: string) => outHeaders.indexOf(col)

  // Build output rows
  const outRows: string[][] = []

  for (const row of rows) {
    const outRow: string[] = outHeaders.map(h => {
      const i = headers.indexOf(h)
      return i >= 0 ? row[i] : ''
    })

    const return90d      = row[idx('return_90d')]
    const txDate         = row[idx('transaction_date')]

    if (return90d === '' || !txDate) {
      // No 90d return available — leave new cols empty
      outRows.push(outRow)
      continue
    }

    const entryDate  = new Date(txDate)
    const exit90Date = addDays(txDate, 90)

    const spyEntry = lookupPrice(spyMap, entryDate)
    const spyExit  = lookupPrice(spyMap, exit90Date)

    const spyReturn90d =
      spyEntry != null && spyExit != null ? pct(spyEntry, spyExit) : null

    const adjustedReturn90d =
      spyReturn90d != null ? Math.round((parseFloat(return90d) - spyReturn90d) * 100) / 100 : null

    outRow[spyIdx('spy_return_90d')]      = csvCell(spyReturn90d)
    outRow[spyIdx('adjusted_return_90d')] = csvCell(adjustedReturn90d)
    outRows.push(outRow)
  }

  // Write updated CSV
  const csvContent = [
    outHeaders.join(','),
    ...outRows.map(r => r.map(csvCell).join(',')),
  ].join('\n')
  fs.writeFileSync(CSV_OUT, csvContent, 'utf-8')
  console.log(`CSV updated: ${outRows.length} rows → ${CSV_OUT}`)
  console.log()

  // Fetch sector map for summary
  const tickers = [...new Set(enrichableRows.map(r => r[idx('ticker')]))]
  const { data: tickerMeta } = await supabase.from('tickers').select('symbol, sector').in('symbol', tickers)
  const sectorMap: Record<string, string> = {}
  for (const t of tickerMeta ?? []) sectorMap[(t as any).symbol] = (t as any).sector ?? 'Unknown'

  await printSummary(outRows, outHeaders, sectorMap)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
