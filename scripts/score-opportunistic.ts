// Run with:  npx tsx scripts/score-opportunistic.ts
// Requires:  .env.local in the project root with NEXT_PUBLIC_SUPABASE_URL
//            and NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY
//
// Scores every OPPORTUNISTIC purchase using output/opportunistic_score_lookup.json
// and writes the result to insider_transactions.sentra_score.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { classifyRole } from '../lib/scoring/convictionScore'

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

// ─── Lookup table ─────────────────────────────────────────────────────────────

type LookupEntry = {
  rank:             number
  sentra_score:     number
  role:             string | null
  sector:           string | null
  min_value:        number
  max_drawdown_30d: number | null
  n:                number
  avg_alpha_180d:   number
  hit_rate_180d:    number
  conf_score:       number
}

const LOOKUP_PATH = path.join(__dirname, '..', 'output', 'opportunistic_score_lookup.json')
const ALL_FILTERS: LookupEntry[] = (
  JSON.parse(fs.readFileSync(LOOKUP_PATH, 'utf-8')) as { filters: LookupEntry[] }
).filters

// Only entry-time filters — no drawdown constraint (not observable at trade entry).
const ENTRY_FILTERS = ALL_FILTERS.filter(f => f.max_drawdown_30d === null)

// ─── Scoring function ─────────────────────────────────────────────────────────

function lookupOpportunisticScore(
  role:        string | null,
  officerTitle: string | null,
  sector:      string | null,
  totalValue:  number | null,
): number {
  const val = totalValue ?? 0
  if (val < 250_000) return 0

  const tradeRole = classifyRole({ role, officer_title: officerTitle })

  const match = ENTRY_FILTERS.find(f =>
    (f.role   === null || f.role   === tradeRole) &&
    (f.sector === null || f.sector === sector)    &&
    val >= f.min_value
  )

  const base = match?.sentra_score ?? 1
  return Math.min(Math.round(base * 1.25), 100)
}

// ─── Config ───────────────────────────────────────────────────────────────────

const FETCH_PAGE = 1_000
const BATCH_SIZE = 100
const LOG_EVERY  = 500

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreBucket(score: number): '0-30' | '31-50' | '51-70' | '71-100' {
  if (score <= 30) return '0-30'
  if (score <= 50) return '31-50'
  if (score <= 70) return '51-70'
  return '71-100'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Loaded ${ENTRY_FILTERS.length} entry-time filters from opportunistic_score_lookup.json`)

  // ── 1. Fetch OPPORTUNISTIC CIKs ───────────────────────────────────────────────
  console.log('Fetching OPPORTUNISTIC insider CIKs…')
  const { data: clsRows, error: clsErr } = await supabase
    .from('insider_classifications')
    .select('insider_cik')
    .eq('classification', 'OPPORTUNISTIC')
  if (clsErr) { console.error('Classification fetch error:', clsErr.message); process.exit(1) }

  const opportunisticCiks = new Set<string>(
    (clsRows ?? []).map((r: any) => r.insider_cik as string).filter(Boolean)
  )
  console.log(`  ${opportunisticCiks.size} OPPORTUNISTIC CIKs loaded`)

  // ── 2. Fetch all purchases, paginated ─────────────────────────────────────────
  console.log('Fetching all purchases from insider_transactions…')
  const allPurchases: any[] = []
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await supabase
      .from('insider_transactions')
      .select('id, ticker, insider_cik, role, officer_title, total_value, transaction_date')
      .eq('transaction_code', 'P')
      .order('transaction_date', { ascending: true })
      .range(from, from + FETCH_PAGE - 1)
    if (error) { console.error('Fetch error:', error.message); process.exit(1) }
    if (!data || data.length === 0) break
    allPurchases.push(...data)
    if (data.length < FETCH_PAGE) break
  }
  console.log(`  ${allPurchases.length} total purchases fetched`)

  // ── 3. Filter to OPPORTUNISTIC insiders ───────────────────────────────────────
  const opportunistic = allPurchases.filter(
    (r) => r.insider_cik && opportunisticCiks.has(r.insider_cik)
  )
  console.log(`  ${opportunistic.length} OPPORTUNISTIC purchases to score`)

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

  // ── 5. Score and update in batches ────────────────────────────────────────────
  const dist: Record<string, number> = { '0-30': 0, '31-50': 0, '51-70': 0, '71-100': 0 }
  let totalScored  = 0
  let qualifying   = 0
  let updateErrors = 0

  console.log(`\nScoring and writing in batches of ${BATCH_SIZE}…`)

  for (let i = 0; i < opportunistic.length; i += BATCH_SIZE) {
    const batch = opportunistic.slice(i, i + BATCH_SIZE)

    const updates: Promise<void>[] = batch.map(async (row) => {
      const sector = sectorMap.get(row.ticker) ?? null
      const score  = lookupOpportunisticScore(row.role, row.officer_title, sector, row.total_value)

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

    if (totalScored % LOG_EVERY < BATCH_SIZE || totalScored >= opportunistic.length) {
      const pct = ((totalScored / opportunistic.length) * 100).toFixed(1)
      console.log(`  ${totalScored} / ${opportunistic.length} (${pct}%)${updateErrors ? ` — ${updateErrors} errors` : ''}`)
    }
  }

  // ── 6. Summary ────────────────────────────────────────────────────────────────
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
