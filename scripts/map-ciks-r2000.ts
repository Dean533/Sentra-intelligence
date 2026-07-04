// Run with:  npx tsx scripts/map-ciks-r2000.ts
//
// Maps scripts/new_tickers_r2000.csv to SEC exact ticker strings via
// company_tickers.json. Writes scripts/new_tickers_r2000_seed.csv.

import * as fs   from 'fs'
import * as path from 'path'

const INPUT_CSV  = path.join(__dirname, 'new_tickers_r2000.csv')
const OUTPUT_CSV = path.join(__dirname, 'new_tickers_r2000_seed.csv')

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

function normalize(t: string): string {
  return t.replace(/[\s.\-]/g, '').toUpperCase()
}

async function main() {
  // Read input CSV
  const lines   = fs.readFileSync(INPUT_CSV, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const colTicker = headers.indexOf('Ticker')
  const colName   = headers.indexOf('Name')
  const colSector = headers.indexOf('Sector')

  if ([colTicker, colName, colSector].includes(-1)) {
    console.error('ERROR: missing columns in input CSV. Found:', headers)
    process.exit(1)
  }

  type ISharesRow = { iwbTicker: string; name: string; sector: string }
  const inputRows: ISharesRow[] = []
  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line)
    inputRows.push({
      iwbTicker: f[colTicker] ?? '',
      name:      f[colName]   ?? '',
      sector:    f[colSector] ?? '',
    })
  }
  console.log(`\nInput tickers to resolve: ${inputRows.length}`)

  // Fetch SEC company_tickers.json
  console.log('Fetching https://www.sec.gov/files/company_tickers.json ...')
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': 'Sentra contact@sentrasignals.com' },
  })
  if (!res.ok) { console.error(`ERROR: SEC fetch failed ${res.status}`); process.exit(1) }

  const secRaw: Record<string, { cik_str: string; ticker: string; title: string }> = await res.json()

  // normalized → exact SEC ticker
  const secMap = new Map<string, string>()
  for (const entry of Object.values(secRaw)) {
    secMap.set(normalize(entry.ticker), entry.ticker)
  }
  console.log(`SEC ticker map: ${secMap.size} entries`)

  // Match
  type Resolved   = { secTicker: string; name: string; sector: string }
  const resolved:   Resolved[]   = []
  const unresolved: ISharesRow[] = []

  for (const row of inputRows) {
    const secTicker = secMap.get(normalize(row.iwbTicker))
    if (secTicker) resolved.push({ secTicker, name: row.name, sector: row.sector })
    else           unresolved.push(row)
  }

  console.log(`\nMatched to SEC ticker:   ${resolved.length}`)
  console.log(`No SEC match:            ${unresolved.length}`)

  // Write seed CSV
  const csvLines = [
    'symbol,name,sector',
    ...resolved.map(r =>
      `${r.secTicker},"${r.name.replace(/"/g, '""')}","${r.sector.replace(/"/g, '""')}"`
    ),
  ]
  fs.writeFileSync(OUTPUT_CSV, csvLines.join('\n') + '\n', 'utf-8')
  console.log(`\nWritten: ${OUTPUT_CSV}`)

  if (unresolved.length > 0) {
    console.log('\nUnresolved (no SEC entry — likely foreign issuers or delisted):')
    unresolved.forEach(r => console.log(`  ${r.iwbTicker.padEnd(8)} ${r.name}`))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
