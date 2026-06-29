// npx tsx scripts/backfill-issuer-buyback.ts
//
// Backfills insider_transactions.is_issuer_buyback = true where the insider_name
// closely matches the issuer's own company name (i.e., the company is filing as
// its own "insider" — typically a share buyback or company-entity holding).
//
// Rule (applied to ALL transactions, not just buys):
//   normalize(insider_name) ⊆ normalize(company_name)  OR
//   normalize(company_name) ⊆ normalize(insider_name)
//   AND the overlap covers ≥70% of the shorter string's words
//
// Normalization: lowercase → strip entity suffixes → strip punctuation → collapse spaces
//
// Safety: only sets is_issuer_buyback = true; never sets it to false (so manual
// overrides aren't clobbered). Re-running is idempotent.

import * as path from 'path'
import * as fs   from 'fs'
import { createClient } from '@supabase/supabase-js'
import { isIssuerBuyback, normalizeEntityName } from '../lib/insiderBuybackDetector'

function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!,
)


// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Paginate the full tickers table — PostgREST default cap is 1000 rows,
  //    but the table has ~1552+ entries (EQH, ARES, H, UBER, TEM are in there).
  console.log('Fetching all company names from tickers table (paginated)…')
  const nameMap = new Map<string, string>()
  {
    const PG = 1000
    let off = 0
    while (true) {
      const { data, error } = await supabase
        .from('tickers')
        .select('symbol, name')
        .range(off, off + PG - 1)
        .order('symbol')
      if (error) { console.error(error.message); process.exit(1) }
      if (!data || data.length === 0) break
      for (const r of data) {
        if ((r as any).name) nameMap.set((r as any).symbol, (r as any).name)
      }
      off += data.length
      if (data.length < PG) break
    }
  }
  console.log(`Loaded ${nameMap.size} company names.`)

  const candidateTickers = [...nameMap.keys()].filter(sym => normalizeEntityName(nameMap.get(sym)!).length > 0)
  console.log(`Scanning ${candidateTickers.length} tickers for name matches…`)

  const buybackIds: string[] = []
  const examples: { id: string; ticker: string; insider_name: string; company_name: string }[] = []

  // One ticker at a time, paginated — avoids PostgREST's 1000-row cap on .in() chunks.
  const PG2 = 1000
  let scanned = 0
  for (const sym of candidateTickers) {
    const companyName = nameMap.get(sym)!
    let off2 = 0
    while (true) {
      const { data, error } = await supabase
        .from('insider_transactions')
        .select('id, ticker, insider_name')
        .eq('ticker', sym)
        .range(off2, off2 + PG2 - 1)
        .order('id')
      if (error) { console.error(`${sym}: ${error.message}`); process.exit(1) }
      if (!data || data.length === 0) break

      for (const tx of data) {
        const t = tx as { id: string; ticker: string; insider_name: string }
        if (!t.insider_name) continue
        if (isIssuerBuyback(t.insider_name, companyName)) {
          buybackIds.push(t.id)
          if (examples.length < 20) {
            examples.push({ id: t.id, ticker: t.ticker, insider_name: t.insider_name, company_name: companyName })
          }
        }
      }

      off2 += data.length
      if (data.length < PG2) break
    }

    scanned++
    if (scanned % 100 === 0) process.stdout.write(`\r  ${scanned} / ${candidateTickers.length} tickers…`)
  }
  console.log()

  console.log(`\n\nMatched ${buybackIds.length} buyback transaction(s).`)

  // 4. Preview before writing
  console.log('\nFirst 20 matched rows (sample):')
  console.log(`  ${'Ticker'.padEnd(8)} ${'Insider name'.padEnd(45)} Company name`)
  console.log('  ' + '─'.repeat(100))
  for (const ex of examples) {
    console.log(`  ${ex.ticker.padEnd(8)} ${ex.insider_name.slice(0, 45).padEnd(45)} ${ex.company_name}`)
  }

  if (buybackIds.length === 0) {
    console.log('\nNothing to update.')
    return
  }

  // 5. Update in batches of 500 (PostgREST .in() limit)
  const BATCH = 500
  let updated = 0
  for (let i = 0; i < buybackIds.length; i += BATCH) {
    const batch = buybackIds.slice(i, i + BATCH)
    const { error } = await supabase
      .from('insider_transactions')
      .update({ is_issuer_buyback: true })
      .in('id', batch)
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed: ${error.message}`)
      process.exit(1)
    }
    updated += batch.length
    process.stdout.write(`\r  Updated ${updated} / ${buybackIds.length}…`)
  }
  console.log(`\n\nDone. ${updated} rows flagged as is_issuer_buyback = true.`)

  // 6. Spot-check: confirm a known 10% owner was NOT flagged
  console.log('\nSpot-check — confirming Berkshire Hathaway is NOT flagged on OXY:')
  const { data: ber } = await supabase
    .from('insider_transactions')
    .select('insider_name, ticker, is_issuer_buyback')
    .ilike('insider_name', '%berkshire%')
    .limit(3)
  for (const r of ber ?? []) {
    console.log(`  ${(r as any).ticker}  ${(r as any).insider_name}  → is_issuer_buyback=${(r as any).is_issuer_buyback}`)
  }

  console.log('\nFinal counts by direction:')
  const { data: counts } = await supabase
    .from('insider_transactions')
    .select('transaction_direction, is_issuer_buyback')
    .eq('is_issuer_buyback', true)
  const byDir = new Map<string, number>()
  for (const r of counts ?? []) {
    const d = (r as any).transaction_direction ?? 'unknown'
    byDir.set(d, (byDir.get(d) ?? 0) + 1)
  }
  for (const [dir, n] of [...byDir.entries()].sort()) {
    console.log(`  ${dir.padEnd(12)} ${n}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
