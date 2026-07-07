// Bulk-scores all insider_transactions rows WHERE conviction_score IS NULL.
// Safe to re-run: only touches null rows; already-scored rows are untouched.
//
// Performance: no per-row DB queries.
//   - insider_classifications and tickers are bulk-fetched once
//   - cluster_count is NOT used in convictionScore formulas — no precomputation needed
//   - momentum_90d = null for all rows (matching production behavior in /api/insider/conviction)
//   - 20 concurrent DB updates per 1,000-row batch
//
// Expected runtime: ~10–15 minutes for 410K rows
//
// Usage:
//   npx tsx scripts/backfill-conviction-score.ts            # full run
//   npx tsx scripts/backfill-conviction-score.ts --dry-run  # score 1,000 rows, print 20, no writes

import * as path from 'path'
import * as fs   from 'fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { computeConvictionScore, ConvictionTrade } from '../lib/scoring/convictionScore'

// ── Env loading ───────────────────────────────────────────────────────────────

function loadEnv(): void {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) return
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

async function fetchAll<T>(
  sb:     SupabaseClient<any, any, any>,
  table:  string,
  cols:   string,
  filter: (q: any) => any,
  label:  string
): Promise<T[]> {
  const PAGE    = 1_000
  const results: T[] = []
  let   from    = 0
  process.stdout.write(`  Loading ${label}... `)
  while (true) {
    const { data, error } = await filter(sb.from(table).select(cols)).range(from, from + PAGE - 1) as any
    if (error) { console.error(`\n  Error:`, (error as any).message); break }
    if (!data || (data as any[]).length === 0) break
    results.push(...(data as T[]))
    if ((data as any[]).length < PAGE) break
    from += PAGE
  }
  console.log(`${results.length.toLocaleString()} rows`)
  return results
}

// ── Classification resolution ─────────────────────────────────────────────────
// Mirrors app/api/insider/conviction/[ticker]/route.ts and
// app/api/insider/signals-monthly/route.ts exactly.
//
// Priority:
//   1. Confirmed classification from insider_classifications (most recent year)
//   2. Inferred-opportunistic: CEO/President/10% + ≥$1M trade + CIK absent from table
//   3. null (gray, no signal context)

function resolveClassification(
  row: {
    insider_cik:   string | null
    officer_title: string | null
    role:          string | null
    total_value:   number | null
  },
  classMap:       Map<string, string>,
  classifiedCiks: Set<string>
): 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null {
  const cik = row.insider_cik
  if (!cik) return null

  const confirmed = classMap.get(cik)
  if (confirmed) return confirmed as 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE'

  // Inferred-opportunistic: CIK not in classification table, but meets CEO+$1M criteria.
  // ROUTINE is never inferred — any explicitly classified ROUTINE insider is excluded above.
  if (classifiedCiks.has(cik)) return null  // classified as something else (shouldn't happen)
  const val  = row.total_value ?? 0
  const text = ((row.officer_title ?? '') + ' ' + (row.role ?? '')).toLowerCase()
  if (
    val >= 1_000_000 &&
    (text.includes('ceo') || text.includes('chief executive') ||
     text.includes('president') || text.includes('10%'))
  ) return 'OPPORTUNISTIC'

  return null
}

function buildConvictionTrade(
  row: any,
  cls: 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null,
  mc:  number | null
): ConvictionTrade {
  return {
    ticker:               row.ticker,
    insider_name:         (row.insider_name as string | null) ?? '',
    officer_title:        (row.officer_title as string | null) ?? null,
    role:                 (row.role as string | null) ?? null,
    total_value:          (row.total_value  as number | null) ?? null,
    price_per_share:      (row.price_per_share as number | null) ?? null,
    transaction_date:     row.transaction_date as string,
    is_opportunistic:     cls === 'OPPORTUNISTIC',
    is_local:             null,
    sector:               null,
    cluster_count:        0,        // not used in conviction scoring formulas
    cluster_total_value:  0,        // not used in conviction scoring formulas
    insider_median_value: null,
    classification:       cls,
    shares:               (row.shares as number | null) ?? null,
    shares_owned_after:   (row.shares_owned_after as number | null) ?? null,
    market_cap:           mc,
    momentum_90d:         null,     // matches production: /api/insider/conviction uses null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const DRY_RUN     = process.argv.includes('--dry-run')
const BATCH_SIZE  = 1_000
const CONCURRENCY = 20

async function main(): Promise<void> {
  loadEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const sb = createClient(url, key)

  console.log('═'.repeat(60))
  console.log(DRY_RUN ? '[DRY RUN] Backfill conviction_score' : 'Backfill conviction_score')
  console.log('═'.repeat(60))

  // ── 1. Load insider_classifications ──────────────────────────────────────
  // Prefer most recent classified_year per CIK, matching signals-monthly fallback logic.
  console.log('\n[1/3] Loading insider_classifications...')
  const clsRows = await fetchAll<{ insider_cik: string; classification: string; classified_year: number | null }>(
    sb, 'insider_classifications',
    'insider_cik, classification, classified_year',
    q => q.order('classified_year', { ascending: false }),
    'classifications'
  )

  const classMap     = new Map<string, string>()   // cik → most-recent classification
  const classifiedCiks = new Set<string>()
  for (const r of clsRows) {
    if (!classMap.has(r.insider_cik)) classMap.set(r.insider_cik, r.classification)
    classifiedCiks.add(r.insider_cik)
  }

  const distByType: Record<string, number> = {}
  for (const cls of classMap.values()) distByType[cls] = (distByType[cls] ?? 0) + 1
  console.log(`  ${classMap.size.toLocaleString()} unique CIKs: ${
    Object.entries(distByType).map(([k, v]) => `${k}=${v}`).join(', ')
  }`)

  // ── 2. Load market caps ───────────────────────────────────────────────────
  console.log('\n[2/3] Loading market caps...')
  const tickerRows = await fetchAll<{ symbol: string; market_cap: number | null }>(
    sb, 'tickers', 'symbol, market_cap',
    q => q, 'tickers'
  )
  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerRows) marketCapMap[t.symbol] = t.market_cap ?? null

  // ── 3. Count backlog ──────────────────────────────────────────────────────
  console.log('\n[3/3] Scoring unscored rows...')
  const { count: totalNull } = await sb
    .from('insider_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('transaction_code', 'P')
    .is('conviction_score', null)

  const total = totalNull ?? 0
  console.log(`  Backlog: ${total.toLocaleString()} rows`)
  if (total === 0) { console.log('  Nothing to do.'); return }

  // ── Dry-run: score first 1,000, print 20, exit ───────────────────────────
  if (DRY_RUN) {
    const { data: sample } = await sb
      .from('insider_transactions')
      .select('id, ticker, insider_name, insider_cik, officer_title, role, total_value, price_per_share, shares, shares_owned_after, transaction_date')
      .eq('transaction_code', 'P')
      .is('conviction_score', null)
      .order('transaction_date', { ascending: false })
      .limit(1_000)

    if (!sample || sample.length === 0) { console.log('  No rows found.'); return }

    console.log('\n  [DRY RUN] Sample — 20 rows (not written):\n')
    const hdr = '  Ticker    Date        Score  Color      Classification    Insider'
    console.log(hdr)
    console.log('  ' + '-'.repeat(hdr.length - 2))

    for (const row of (sample as any[]).slice(0, 20)) {
      const cls    = resolveClassification(row, classMap, classifiedCiks)
      const mc     = marketCapMap[row.ticker] ?? null
      const trade  = buildConvictionTrade(row, cls, mc)
      const result = computeConvictionScore(trade, [], [], null)
      console.log(
        `  ${(row.ticker as string).padEnd(9)}` +
        `${row.transaction_date}  ` +
        `${String(result.score).padStart(5)}  ` +
        `${result.color.padEnd(10)} ` +
        `${(cls ?? 'null').padEnd(17)} ` +
        `${(row.insider_name as string | null) ?? '—'}`
      )
    }

    // Score distribution of the full 1,000-row sample
    const dist: Record<string, number> = { green: 0, yellow: 0, red: 0, gray: 0 }
    for (const row of sample as any[]) {
      const cls    = resolveClassification(row, classMap, classifiedCiks)
      const mc     = marketCapMap[row.ticker] ?? null
      const trade  = buildConvictionTrade(row, cls, mc)
      const result = computeConvictionScore(trade, [], [], null)
      dist[result.color] = (dist[result.color] ?? 0) + 1
    }
    console.log(`\n  Sample color distribution (n=${sample.length}): ` +
      `green=${dist.green} yellow=${dist.yellow} red=${dist.red} gray=${dist.gray}`)
    console.log(`\n  [DRY RUN] ${total.toLocaleString()} rows would be scored. Run without --dry-run to commit.`)
    return
  }

  // ── Full run ──────────────────────────────────────────────────────────────
  let processed   = 0
  let errors      = 0
  let batchNum    = 0
  const startTime = Date.now()

  while (true) {
    batchNum++

    // Always fetch from the head of the null set — scored rows fall out naturally.
    const { data: rows, error: fetchErr } = await sb
      .from('insider_transactions')
      .select('id, ticker, insider_name, insider_cik, officer_title, role, total_value, price_per_share, shares, shares_owned_after, transaction_date')
      .eq('transaction_code', 'P')
      .is('conviction_score', null)
      .order('transaction_date', { ascending: false })
      .limit(BATCH_SIZE)

    if (fetchErr) {
      console.error(`\n  [batch ${batchNum}] fetch error: ${fetchErr.message}`)
      errors++
      await new Promise(r => setTimeout(r, 2_000))
      continue
    }
    if (!rows || rows.length === 0) break

    const updates = (rows as any[]).map(row => {
      const cls    = resolveClassification(row, classMap, classifiedCiks)
      const mc     = marketCapMap[row.ticker] ?? null
      const trade  = buildConvictionTrade(row, cls, mc)
      const result = computeConvictionScore(trade, [], [], null)
      return { id: row.id as string, conviction_score: result.score }
    })

    // Write in concurrent chunks
    for (let i = 0; i < updates.length; i += CONCURRENCY) {
      const chunk = updates.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map(u =>
          sb.from('insider_transactions')
            .update({ conviction_score: u.conviction_score })
            .eq('id', u.id)
        )
      )
      for (const r of results) {
        if (r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any).error)) errors++
      }
    }

    processed += rows.length
    const elapsed   = Date.now() - startTime
    const rate      = processed / (elapsed / 1000)
    const remaining = Math.max(0, total - processed)
    const etaMs     = remaining / rate * 1000

    process.stdout.write(
      `\r  Batch ${batchNum}: ${processed.toLocaleString()}/${total.toLocaleString()} scored` +
      ` | ${rate.toFixed(0)} rows/s` +
      ` | ETA ${fmtDuration(etaMs)}` +
      (errors > 0 ? ` | ${errors} errors` : '') +
      '   '
    )

    if (rows.length < BATCH_SIZE) break
  }

  const elapsed = Date.now() - startTime
  console.log('\n')
  console.log('═'.repeat(60))
  console.log(`Done in ${fmtDuration(elapsed)}`)
  console.log(`  Processed: ${processed.toLocaleString()} rows`)
  console.log(`  Errors:    ${errors}`)
  if (errors > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
