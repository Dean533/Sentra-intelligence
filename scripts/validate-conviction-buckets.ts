// Validates the 6-bucket conviction signal labels against actual backtest returns.
// Computes conviction_score locally from CSV inputs — no Supabase call needed.
// The CSV already has classification resolved + all scoring inputs (shares,
// shares_owned_after, total_value, officer_title, role). market_cap is absent
// so we pass null (neutral F4 = 4/8 pts), matching production behavior.
//
// Usage:
//   npx tsx scripts/validate-conviction-buckets.ts

import * as fs   from 'fs'
import * as path from 'path'
import { computeConvictionScore, ConvictionTrade } from '../lib/scoring/convictionScore'

// ── CSV parsing ───────────────────────────────────────────────────────────────

type CsvRow = {
  id:                    string
  ticker:                string
  insider_name:          string
  officer_title:         string
  role:                  string
  classification:        string
  direction:             string
  total_value:           number
  shares:                number | null
  shares_owned_after:    number | null
  price_per_share:       number | null
  transaction_date:      string
  return_90d:            number
  alpha_90d:             number
  direction_correct_90d: boolean
}

function parseCsv(filePath: string): CsvRow[] {
  const raw   = fs.readFileSync(filePath, 'utf-8')
  const lines = raw.split('\n')
  const headers = lines[0].split(',')

  const idx = (name: string): number => {
    const i = headers.indexOf(name)
    if (i === -1) throw new Error(`CSV missing column: ${name}`)
    return i
  }

  const iId        = idx('id')
  const iTicker    = idx('ticker')
  const iName      = idx('insider_name')
  const iOTitle    = idx('officer_title')
  const iRole      = idx('role')
  const iCls       = idx('classification')
  const iDir       = idx('direction')
  const iVal       = idx('total_value')
  const iShares    = idx('shares')
  const iAfter     = idx('shares_owned_after')
  const iPrice     = idx('price_per_share')
  const iDate      = idx('transaction_date')
  const iRet90     = idx('return_90d')
  const iAlpha90   = idx('alpha_90d')
  const iDirCorr90 = idx('direction_correct_90d')

  const result: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const cols = line.split(',')
    const sharesRaw = parseFloat(cols[iShares])
    const afterRaw  = parseFloat(cols[iAfter])
    const priceRaw  = parseFloat(cols[iPrice])
    result.push({
      id:                    cols[iId],
      ticker:                cols[iTicker],
      insider_name:          cols[iName] ?? '',
      officer_title:         cols[iOTitle] ?? '',
      role:                  cols[iRole] ?? '',
      classification:        cols[iCls],
      direction:             cols[iDir],
      total_value:           parseFloat(cols[iVal]),
      shares:                isNaN(sharesRaw) ? null : sharesRaw,
      shares_owned_after:    isNaN(afterRaw)  ? null : afterRaw,
      price_per_share:       isNaN(priceRaw)  ? null : priceRaw,
      transaction_date:      cols[iDate],
      return_90d:            parseFloat(cols[iRet90]),
      alpha_90d:             parseFloat(cols[iAlpha90]),
      direction_correct_90d: cols[iDirCorr90] === 'true',
    })
  }
  return result
}

// ── Conviction scoring ────────────────────────────────────────────────────────

function scoreRow(row: CsvRow): number | null {
  const cls = row.classification as 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null
  if (!cls || (cls !== 'OPPORTUNISTIC' && cls !== 'UNCLASSIFIABLE' && cls !== 'ROUTINE')) {
    return null
  }

  const trade: ConvictionTrade = {
    ticker:               row.ticker,
    insider_name:         row.insider_name,
    officer_title:        row.officer_title || null,
    role:                 row.role || null,
    total_value:          isNaN(row.total_value) ? null : row.total_value,
    price_per_share:      row.price_per_share,
    transaction_date:     row.transaction_date,
    is_opportunistic:     cls === 'OPPORTUNISTIC',
    is_local:             null,
    sector:               null,
    cluster_count:        0,         // not used in scoring formulas
    cluster_total_value:  0,
    insider_median_value: null,
    classification:       cls,
    shares:               row.shares,
    shares_owned_after:   row.shares_owned_after,
    market_cap:           null,      // absent from CSV; neutral F4 (4/8 pts)
    momentum_90d:         null,      // same as production behavior
  }

  try {
    const result = computeConvictionScore(trade, [], [], null)
    return result.score
  } catch {
    return null
  }
}

// ── Bucket definition ─────────────────────────────────────────────────────────

type BucketKey =
  | 'routine-under-50'
  | 'routine-over-50'
  | 'uncl-under-50'
  | 'uncl-over-50'
  | 'opp-under-50'
  | 'opp-over-50'

const BUCKET_LABELS: Record<BucketKey, string> = {
  'routine-under-50': 'No Signal',
  'routine-over-50':  'Low Signal',
  'uncl-under-50':    'Low Signal (UNCL)',
  'uncl-over-50':     'High Signal',
  'opp-under-50':     'Moderate Signal',
  'opp-over-50':      'Very High Signal',
}

const BUCKET_ORDER: BucketKey[] = [
  'routine-under-50',
  'routine-over-50',
  'uncl-under-50',
  'uncl-over-50',
  'opp-under-50',
  'opp-over-50',
]

function toBucket(cls: string, score: number): BucketKey {
  if (cls === 'ROUTINE')        return score < 50 ? 'routine-under-50' : 'routine-over-50'
  if (cls === 'UNCLASSIFIABLE') return score < 50 ? 'uncl-under-50'    : 'uncl-over-50'
  if (cls === 'OPPORTUNISTIC')  return score < 50 ? 'opp-under-50'     : 'opp-over-50'
  return 'routine-under-50'
}

// ── Stats accumulator ─────────────────────────────────────────────────────────

type Bucket = {
  n:          number
  sumRet90:   number
  sumAlpha90: number
  alphaWins:  number
  returnWins: number
  scores:     number[]
}

function emptyBucket(): Bucket {
  return { n: 0, sumRet90: 0, sumAlpha90: 0, alphaWins: 0, returnWins: 0, scores: [] }
}

// ── Table rendering ───────────────────────────────────────────────────────────

function pct(n: number): string { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }
function winPct(wins: number, n: number): string { return `${((wins / n) * 100).toFixed(1)}%` }

function printTable(buckets: Record<BucketKey, Bucket>, noScoreCount: number): void {
  const LINE = '─'.repeat(100)
  const DLINE = '═'.repeat(100)
  const cols   = ['Bucket', 'Label', 'N', 'Avg 90d Ret', 'Avg Alpha', 'Alpha Win%', 'Ret Win%', 'Score median']
  const widths = [18, 19, 7, 12, 12, 11, 9, 12]

  function row(cells: string[]): string {
    return '  ' + cells.map((c, i) => c.padStart(widths[i])).join('  ')
  }

  console.log('\n' + DLINE)
  console.log('  Conviction Bucket Validation — 90-day forward returns (market_cap=null → neutral F4)')
  console.log(DLINE)
  console.log(row(cols))
  console.log(LINE)

  for (const key of BUCKET_ORDER) {
    const b = buckets[key]
    if (b.n === 0) {
      console.log(row([key, BUCKET_LABELS[key], '0', '—', '—', '—', '—', '—']))
      continue
    }
    const avgRet   = b.sumRet90   / b.n
    const avgAlpha = b.sumAlpha90 / b.n
    const sorted   = b.scores.slice().sort((a, z) => a - z)
    const median   = sorted[Math.floor(sorted.length / 2)]
    console.log(row([
      key,
      BUCKET_LABELS[key],
      b.n.toLocaleString(),
      pct(avgRet),
      pct(avgAlpha),
      winPct(b.alphaWins,  b.n),
      winPct(b.returnWins, b.n),
      `${sorted[0]}–${median}–${sorted[sorted.length - 1]}`,
    ]))
  }

  console.log(LINE)

  const all       = Object.values(buckets)
  const totalN    = all.reduce((s, b) => s + b.n, 0)
  const totalRet  = all.reduce((s, b) => s + b.sumRet90,   0)
  const totalAlph = all.reduce((s, b) => s + b.sumAlpha90, 0)
  const totalAW   = all.reduce((s, b) => s + b.alphaWins,  0)
  const totalRW   = all.reduce((s, b) => s + b.returnWins, 0)
  if (totalN > 0) {
    console.log(row([
      'ALL BUCKETS', '',
      totalN.toLocaleString(),
      pct(totalRet  / totalN),
      pct(totalAlph / totalN),
      winPct(totalAW, totalN),
      winPct(totalRW, totalN),
      '',
    ]))
  }

  console.log(DLINE)

  if (noScoreCount > 0) {
    console.log(`\n  Note: ${noScoreCount.toLocaleString()} buy rows had null/unknown classification and were excluded.`)
  }
  console.log('  Alpha Win% = fraction of trades where alpha_90d > 0 (outperformed SPY).')
  console.log('  Ret Win%   = fraction of trades where return_90d > 0 (raw positive return).')
  console.log('  Score median = min–median–max of conviction_score within bucket.')
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const csvPath = path.join(__dirname, '..', 'output', 'backtest-universe.csv')
  process.stdout.write(`Loading ${csvPath}...\n`)
  const allRows = parseCsv(csvPath)
  const buyRows = allRows.filter(r => r.direction === 'buy')
  console.log(`  ${allRows.length.toLocaleString()} total rows → ${buyRows.length.toLocaleString()} buys`)

  // ── Score every buy row locally ───────────────────────────────────────────
  process.stdout.write('  Computing conviction scores from CSV inputs...')
  let computed = 0
  let failed   = 0
  const buckets: Record<BucketKey, Bucket> = {
    'routine-under-50': emptyBucket(),
    'routine-over-50':  emptyBucket(),
    'uncl-under-50':    emptyBucket(),
    'uncl-over-50':     emptyBucket(),
    'opp-under-50':     emptyBucket(),
    'opp-over-50':      emptyBucket(),
  }
  let noScore = 0

  for (const row of buyRows) {
    const score = scoreRow(row)
    if (score == null) { noScore++; continue }

    const key = toBucket(row.classification, score)
    const b   = buckets[key]
    const ret90   = row.return_90d
    const alpha90 = row.alpha_90d
    if (isNaN(ret90) || isNaN(alpha90)) { noScore++; continue }

    b.n++
    b.sumRet90   += ret90
    b.sumAlpha90 += alpha90
    if (alpha90  > 0) b.alphaWins++
    if (ret90    > 0) b.returnWins++
    b.scores.push(score)
    computed++
  }
  console.log(` done (${computed.toLocaleString()} scored, ${failed} errors, ${noScore} excluded)`)

  // ── Score distribution per classification ─────────────────────────────────
  console.log('\n  Score distribution within buckets:')
  for (const key of BUCKET_ORDER) {
    const b = buckets[key]
    if (b.n === 0) { console.log(`    ${key.padEnd(20)}: no data`); continue }
    const sorted = b.scores.slice().sort((a, z) => a - z)
    const p25 = sorted[Math.floor(sorted.length * 0.25)]
    const p75 = sorted[Math.floor(sorted.length * 0.75)]
    const med = sorted[Math.floor(sorted.length / 2)]
    console.log(`    ${key.padEnd(20)}: n=${b.n.toString().padStart(5)}  p25=${p25}  median=${med}  p75=${p75}  max=${sorted[sorted.length-1]}`)
  }

  printTable(buckets, noScore)
}

main()
