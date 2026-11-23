// Run with:  npx tsx scripts/diff-russell2000.ts
//
// Diffs IWM_holdings.csv (iShares Russell 2000) against the Supabase
// tickers table and writes net-new tickers to scripts/new_tickers_r2000.csv.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

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

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = '', inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = '' }
    else cur += ch
  }
  fields.push(cur.trim())
  return fields
}

const CSV_PATH = 'C:\\Users\\dzg16\\Downloads\\IWM_holdings.csv'
const OUT_PATH = path.join(__dirname, 'new_tickers_r2000.csv')

const INVALID_TICKER = /^[-\s]*$|[^A-Z0-9.\-]/

type Holding = { ticker: string; name: string; sector: string }

async function main() {
  const rawLines = fs.readFileSync(CSV_PATH, 'utf-8').split('\n')

  const headerIdx = rawLines.findIndex(l =>
    l.trimStart().startsWith('Ticker,') || l.trimStart().startsWith('"Ticker"')
  )
  if (headerIdx === -1) {
    console.error('ERROR: could not find header row starting with "Ticker,"')
    process.exit(1)
  }

  const headers     = parseCsvLine(rawLines[headerIdx])
  const colTicker   = headers.indexOf('Ticker')
  const colName     = headers.indexOf('Name')
  const colSector   = headers.indexOf('Sector')
  const colAsset    = headers.indexOf('Asset Class')

  if ([colTicker, colName, colSector, colAsset].includes(-1)) {
    console.error('ERROR: missing expected columns. Found:', headers)
    process.exit(1)
  }

  const holdings: Holding[] = []
  for (let i = headerIdx + 1; i < rawLines.length; i++) {
    const line = rawLines[i].trim()
    if (!line) continue
    const f          = parseCsvLine(line)
    const assetClass = f[colAsset] ?? ''
    const ticker     = (f[colTicker] ?? '').toUpperCase()
    const name       = f[colName]   ?? ''
    const sector     = f[colSector] ?? ''

    if (assetClass !== 'Equity') continue
    if (!ticker || ticker === '-' || INVALID_TICKER.test(ticker)) continue

    holdings.push({ ticker, name, sector })
  }

  console.log(`\nIWM equities in CSV: ${holdings.length}`)

  // Fetch all existing symbols (paginate to avoid row cap)
  const existing = new Set<string>()
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('tickers')
      .select('symbol')
      .range(from, from + 999)
    if (error) { console.error('DB error:', error.message); process.exit(1) }
    for (const r of data ?? []) existing.add((r as any).symbol.toUpperCase())
    if ((data ?? []).length < 1000) break
    from += 1000
  }
  console.log(`Tickers already in DB: ${existing.size}`)

  const alreadyHave = holdings.filter(h =>  existing.has(h.ticker))
  const netNew      = holdings.filter(h => !existing.has(h.ticker))

  console.log(`Already tracked:  ${alreadyHave.length}`)
  console.log(`Net-new tickers:  ${netNew.length}`)

  const csvLines = [
    'Ticker,Name,Sector',
    ...netNew.map(h => `${h.ticker},"${h.name.replace(/"/g, '""')}","${h.sector.replace(/"/g, '""')}"`)
  ]
  fs.writeFileSync(OUT_PATH, csvLines.join('\n') + '\n', 'utf-8')
  console.log(`\nWritten to: ${OUT_PATH}`)

  console.log('\nFirst 20 net-new tickers:')
  netNew.slice(0, 20).forEach(h =>
    console.log(`  ${h.ticker.padEnd(8)} ${h.sector.padEnd(30)} ${h.name}`)
  )
}

main().catch(err => { console.error(err); process.exit(1) })
