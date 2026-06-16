// Run with:  npx tsx scripts/seed-tickers.ts
//
// Seeds scripts/new_tickers_seed.csv into the Supabase tickers table.
// Upserts on symbol with ignoreDuplicates so existing rows are skipped.

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

// ─── Main ─────────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 200

async function main() {
  // 1. Read new_tickers_seed.csv
  const csvPath = path.join(__dirname, 'new_tickers_seed.csv')
  const lines   = fs.readFileSync(csvPath, 'utf-8').split('\n')
  const [headerLine, ...dataLines] = lines

  const headers   = parseCsvLine(headerLine)
  const colSymbol = headers.indexOf('symbol')
  const colName   = headers.indexOf('name')
  const colSector = headers.indexOf('sector')

  if ([colSymbol, colName, colSector].includes(-1)) {
    console.error('ERROR: missing expected columns. Found:', headers)
    process.exit(1)
  }

  type Row = { symbol: string; name: string; sector: string }
  const rows: Row[] = []
  for (const line of dataLines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const fields = parseCsvLine(trimmed)
    const symbol = fields[colSymbol]?.trim()
    if (!symbol) continue
    rows.push({
      symbol,
      name:   fields[colName]   ?? '',
      sector: fields[colSector] ?? '',
    })
  }
  console.log(`\nRows to seed: ${rows.length}`)

  // 2. Upsert in chunks of 200
  let inserted = 0
  let skipped  = 0

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE)

    // Count how many already exist before upsert to derive skipped count
    const symbols = chunk.map(r => r.symbol)
    const { count: existingCount } = await supabase
      .from('tickers')
      .select('symbol', { count: 'exact', head: true })
      .in('symbol', symbols)

    const { error } = await supabase
      .from('tickers')
      .upsert(chunk, { onConflict: 'symbol', ignoreDuplicates: true })

    if (error) {
      console.error(`ERROR upserting chunk ${i}–${i + chunk.length - 1}:`, error.message)
      process.exit(1)
    }

    const alreadyExisted = existingCount ?? 0
    skipped  += alreadyExisted
    inserted += chunk.length - alreadyExisted

    console.log(`  chunk ${i + 1}–${i + chunk.length}: ${chunk.length - alreadyExisted} inserted, ${alreadyExisted} skipped`)
  }

  // 3. Print final row count
  const { count: totalCount, error: countErr } = await supabase
    .from('tickers')
    .select('*', { count: 'exact', head: true })

  if (countErr) {
    console.error('ERROR fetching total count:', countErr.message)
  }

  console.log(`\nDone.`)
  console.log(`  Inserted: ${inserted}`)
  console.log(`  Skipped (already existed): ${skipped}`)
  console.log(`  Total rows in tickers table: ${totalCount ?? 'unknown'}`)
}

main().catch(err => { console.error(err); process.exit(1) })
