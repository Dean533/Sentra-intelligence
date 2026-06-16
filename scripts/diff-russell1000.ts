// Run with:  npx tsx scripts/diff-russell1000.ts
//
// Diffs IWB_holdings.csv (iShares Russell 1000) against the Supabase
// tickers table and writes net-new tickers to scripts/new_tickers.csv.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// ─── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env.local not found at', envPath)
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ─── CSV parser (handles quoted fields) ───────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      fields.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur.trim())
  return fields
}

// ─── Read and parse IWB CSV ───────────────────────────────────────────────────

const CSV_PATH = 'C:\\Users\\dzg16\\Downloads\\IWB_holdings.csv'

const rawLines = fs.readFileSync(CSV_PATH, 'utf-8').split('\n')

// Find the real header row (starts with "Ticker,")
const headerIdx = rawLines.findIndex(l => l.trimStart().startsWith('Ticker,') || l.trimStart().startsWith('"Ticker"'))
if (headerIdx === -1) {
  console.error('ERROR: could not find header row starting with "Ticker," in the CSV')
  process.exit(1)
}

const headers = parseCsvLine(rawLines[headerIdx])
const colTicker     = headers.indexOf('Ticker')
const colName       = headers.indexOf('Name')
const colSector     = headers.indexOf('Sector')
const colAssetClass = headers.indexOf('Asset Class')

if ([colTicker, colName, colSector, colAssetClass].includes(-1)) {
  console.error('ERROR: missing expected columns. Found headers:', headers)
  process.exit(1)
}

const INVALID_TICKER = /^[-\s]*$|[^A-Z0-9.\-]/  // blank, "-", or non-symbol chars

type Holding = { ticker: string; name: string; sector: string }

async function main() {
  const russell1000: Holding[] = []

  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) continue

    const fields     = parseCsvLine(line)
    const assetClass = fields[colAssetClass] ?? ''
    const ticker     = (fields[colTicker] ?? '').toUpperCase()
    const name       = fields[colName]   ?? ''
    const sector     = fields[colSector] ?? ''

    if (assetClass !== 'Equity') continue
    if (!ticker || ticker === '-' || INVALID_TICKER.test(ticker)) continue

    russell1000.push({ ticker, name, sector })
  }

  console.log(`\nRussell 1000 equities in CSV: ${russell1000.length}`)

  // ─── Pull existing tickers from Supabase ───────────────────────────────────

  const { data: dbRows, error } = await supabase
    .from('tickers')
    .select('symbol')

  if (error) {
    console.error('ERROR fetching tickers from Supabase:', error.message)
    process.exit(1)
  }

  const existing = new Set((dbRows ?? []).map((r: any) => (r.symbol as string).toUpperCase()))
  console.log(`Tickers already in Sentra DB: ${existing.size}`)

  // ─── Diff ──────────────────────────────────────────────────────────────────

  const netNew      = russell1000.filter(h => !existing.has(h.ticker))
  const alreadyHave = russell1000.filter(h =>  existing.has(h.ticker))

  console.log(`Already tracked:  ${alreadyHave.length}`)
  console.log(`Net-new tickers:  ${netNew.length}`)

  // ─── Write new_tickers.csv ─────────────────────────────────────────────────

  const outPath  = path.join(__dirname, 'new_tickers.csv')
  const csvLines = [
    'Ticker,Name,Sector',
    ...netNew.map(h => `${h.ticker},"${h.name.replace(/"/g, '""')}","${h.sector.replace(/"/g, '""')}"`)
  ]
  fs.writeFileSync(outPath, csvLines.join('\n') + '\n', 'utf-8')

  console.log(`\nWritten to: ${outPath}`)
  console.log('\nFirst 20 net-new tickers:')
  netNew.slice(0, 20).forEach(h => console.log(`  ${h.ticker.padEnd(8)} ${h.sector.padEnd(30)} ${h.name}`))
}

main().catch(err => { console.error(err); process.exit(1) })
