// Run with:  npx tsx scripts/map-ciks.ts
//
// Reads scripts/new_tickers.csv (iShares tickers), fetches SEC company_tickers.json,
// normalizes both sides for matching, then writes scripts/new_tickers_seed.csv
// using SEC's EXACT ticker string as the symbol so ingestion's exact-match works.

import * as fs   from 'fs'
import * as path from 'path'

// ─── Paths ────────────────────────────────────────────────────────────────────

const INPUT_CSV  = path.join(__dirname, 'new_tickers.csv')
const OUTPUT_CSV = path.join(__dirname, 'new_tickers_seed.csv')

// ─── CSV helpers ──────────────────────────────────────────────────────────────

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

// Normalize ticker for matching only — strips dots, dashes, spaces, uppercases.
// NOT used in output; the exact SEC ticker string is written to the seed file.
function normalizeTicker(t: string): string {
  return t.replace(/[\s.\-]/g, '').toUpperCase()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Read new_tickers.csv
  const lines = fs.readFileSync(INPUT_CSV, 'utf-8').split('\n')
  const [headerLine, ...dataLines] = lines
  const headers   = parseCsvLine(headerLine)
  const colTicker = headers.indexOf('Ticker')
  const colName   = headers.indexOf('Name')
  const colSector = headers.indexOf('Sector')

  if ([colTicker, colName, colSector].includes(-1)) {
    console.error('ERROR: missing expected columns in new_tickers.csv. Found:', headers)
    process.exit(1)
  }

  type ISharesRow = { iwbTicker: string; name: string; sector: string }
  const newTickers: ISharesRow[] = []
  for (const line of dataLines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const fields = parseCsvLine(trimmed)
    newTickers.push({
      iwbTicker: fields[colTicker] ?? '',
      name:      fields[colName]   ?? '',
      sector:    fields[colSector] ?? '',
    })
  }
  console.log(`\nNew tickers to resolve: ${newTickers.length}`)

  // 2. Fetch SEC company_tickers.json
  console.log('Fetching https://www.sec.gov/files/company_tickers.json ...')
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': 'Sentra contact@sentrasignals.com' },
  })
  if (!res.ok) {
    console.error(`ERROR: SEC fetch failed with status ${res.status}`)
    process.exit(1)
  }

  // Format: { "0": { cik_str: "789019", ticker: "MSFT", title: "..." }, ... }
  const secRaw: Record<string, { cik_str: string; ticker: string; title: string }> = await res.json()

  // 3. Build normalized lookup: normalizedTicker -> exact SEC ticker string
  //    We store the exact SEC ticker (not the normalized form) so we can
  //    write it verbatim to the seed file for ingestion's exact-match.
  const secMap = new Map<string, string>() // normalizedTicker -> exact SEC ticker
  for (const entry of Object.values(secRaw)) {
    secMap.set(normalizeTicker(entry.ticker), entry.ticker)
  }
  console.log(`SEC ticker map loaded: ${secMap.size} entries`)

  // 4. Match each iShares ticker to its exact SEC ticker string
  type Resolved   = { secTicker: string; name: string; sector: string }
  type Unresolved = ISharesRow

  const resolved:   Resolved[]   = []
  const unresolved: Unresolved[] = []

  for (const row of newTickers) {
    const secTicker = secMap.get(normalizeTicker(row.iwbTicker))
    if (secTicker) {
      resolved.push({ secTicker, name: row.name, sector: row.sector })
    } else {
      unresolved.push(row)
    }
  }

  console.log(`\nMatched to SEC ticker:  ${resolved.length}`)
  console.log(`No SEC match (foreign?): ${unresolved.length}`)

  // 5. Write new_tickers_seed.csv
  //    symbol = SEC's exact ticker string (ingestion will find it via exact-match)
  //    name   = iShares name (cleaner than SEC title)
  //    sector = iShares sector (needed for scoring)
  const csvLines = [
    'symbol,name,sector',
    ...resolved.map(r =>
      `${r.secTicker},"${r.name.replace(/"/g, '""')}","${r.sector.replace(/"/g, '""')}"`
    ),
  ]
  fs.writeFileSync(OUTPUT_CSV, csvLines.join('\n') + '\n', 'utf-8')
  console.log(`\nWritten to: ${OUTPUT_CSV}`)

  // 6. List unresolved (likely foreign issuers — no Form 4 obligation)
  if (unresolved.length > 0) {
    console.log('\nUnresolved (no SEC entry — likely foreign issuers or delisted):')
    unresolved.forEach(r => console.log(`  ${r.iwbTicker.padEnd(8)} ${r.name}`))
  }
}

main().catch(err => { console.error(err); process.exit(1) })
