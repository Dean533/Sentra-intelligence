// Run with:  npx tsx scripts/score-unclassifiable.ts
// Requires:  .env.local in the project root with NEXT_PUBLIC_SUPABASE_URL
//            and NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY
//
// Scores every unclassifiable purchase (insiders not tagged OPPORTUNISTIC or ROUTINE)
// using computeConvictionScore and writes the result to insider_transactions.sentra_score.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { computeConvictionScore, type ConvictionTrade } from '../lib/scoring/convictionScore'

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

// ─── Config ───────────────────────────────────────────────────────────────────

const FETCH_PAGE  = 1_000   // rows per Supabase fetch page
const BATCH_SIZE  = 100     // rows per update batch
const LOG_EVERY   = 500     // print progress every N rows scored

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreBucket(score: number): '0-30' | '31-50' | '51-70' | '71-100' {
  if (score <= 30) return '0-30'
  if (score <= 50) return '31-50'
  if (score <= 70) return '51-70'
  return '71-100'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Fetch classified CIKs (OPPORTUNISTIC + ROUTINE) ──────────────────────
  console.log('Fetching classified insider CIKs…')
  const { data: clsRows, error: clsErr } = await supabase
    .from('insider_classifications')
    .select('insider_cik')
    .in('classification', ['OPPORTUNISTIC', 'ROUTINE'])
  if (clsErr) { console.error('Classification fetch error:', clsErr.message); process.exit(1) }

  const classifiedCiks = new Set<string>(
    (clsRows ?? []).map((r: any) => r.insider_cik as string).filter(Boolean)
  )
  console.log(`  ${classifiedCiks.size} classified CIKs loaded`)

  // ── 2. Fetch all purchases, paginated ────────────────────────────────────────
  console.log('Fetching all purchases from insider_transactions…')
  const allPurchases: any[] = []
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('insider_transactions')
      .select('id, ticker, insider_name, insider_cik, role, officer_title, total_value, price_per_share, transaction_date')
      .eq('transaction_code', 'P')
      .order('transaction_date', { ascending: true })
      .range(from, from + FETCH_PAGE - 1)
    if (error) { console.error('Fetch error:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    allPurchases.push(...data)
    if (data.length < FETCH_PAGE) break
  }
  console.log(`  ${allPurchases.length} total purchases fetched`)

  // ── 3. Filter to unclassifiable insiders ─────────────────────────────────────
  const unclassifiable = allPurchases.filter(
    (r) => !r.insider_cik || !classifiedCiks.has(r.insider_cik)
  )
  console.log(`  ${unclassifiable.length} unclassifiable purchases to score`)

  // ── 4. Build sector map — full tickers table scan (not limited to trade set) ───
  console.log('Loading sector data for all tickers…')
  const sectorMap = new Map<string, string>()

  for (let from = 0; ; from += FETCH_PAGE) {
    const { data: tickerRows, error: tickerErr } = await supabase
      .from('tickers')
      .select('symbol, sector')
      .range(from, from + FETCH_PAGE - 1)
    if (tickerErr) { console.error('Ticker fetch error:', tickerErr.message); process.exit(1) }
    if (!tickerRows || tickerRows.length === 0) break
    for (const t of tickerRows) {
      if (t.symbol && t.sector) sectorMap.set(t.symbol, t.sector)
    }
    if (tickerRows.length < FETCH_PAGE) break
  }
  console.log(`  ${sectorMap.size} tickers with sector data`)

  // ── 5. Score and update in batches ───────────────────────────────────────────
  const dist: Record<string, number> = { '0-30': 0, '31-50': 0, '51-70': 0, '71-100': 0 }
  let totalScored  = 0
  let qualifying   = 0
  let updateErrors = 0

  console.log(`\nScoring and writing in batches of ${BATCH_SIZE}…`)

  for (let i = 0; i < unclassifiable.length; i += BATCH_SIZE) {
    const batch = unclassifiable.slice(i, i + BATCH_SIZE)

    const updates: Promise<void>[] = batch.map(async (row) => {
      const trade: ConvictionTrade = {
        ticker:               row.ticker ?? '',
        insider_name:         row.insider_name ?? 'Unknown',
        officer_title:        row.officer_title ?? null,
        role:                 row.role ?? null,
        total_value:          row.total_value ?? null,
        price_per_share:      row.price_per_share ?? null,
        transaction_date:     row.transaction_date ?? '',
        is_opportunistic:     false,
        is_local:             null,
        sector:               sectorMap.get(row.ticker) ?? null,
        cluster_count:        0,
        cluster_total_value:  0,
        insider_median_value: null,
      }

      const { score } = computeConvictionScore(trade, [], [])

      const { error } = await supabase
        .from('insider_transactions')
        .update({ sentra_score: score })
        .eq('id', row.id)

      if (error) {
        updateErrors++
      } else {
        dist[scoreBucket(score)]++
        if (score >= 70) qualifying++
      }
    })

    await Promise.all(updates)

    totalScored += batch.length

    if (totalScored % LOG_EVERY < BATCH_SIZE || totalScored >= unclassifiable.length) {
      const pct = ((totalScored / unclassifiable.length) * 100).toFixed(1)
      console.log(`  ${totalScored} / ${unclassifiable.length} (${pct}%)${updateErrors ? ` — ${updateErrors} errors` : ''}`)
    }
  }

  // ── 6. Summary ───────────────────────────────────────────────────────────────
  const succeeded = totalScored - updateErrors
  console.log('\n─────────────────────────────────────────')
  console.log(`Total rows scored:    ${succeeded.toLocaleString()}`)
  if (updateErrors) console.log(`Update errors:        ${updateErrors}`)
  console.log('\nScore distribution:')
  for (const [range, count] of Object.entries(dist)) {
    const bar = '█'.repeat(Math.round((count / succeeded) * 40))
    console.log(`  ${range.padEnd(7)}  ${count.toLocaleString().padStart(7)}  ${bar}`)
  }
  console.log(`\nQualifying (≥ 70):   ${qualifying.toLocaleString()} trades  (${((qualifying / succeeded) * 100).toFixed(1)}%)`)
  console.log('─────────────────────────────────────────')
}

main().catch((err) => { console.error(err); process.exit(1) })
