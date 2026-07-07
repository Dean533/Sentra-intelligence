// Bulk-scores all insider_transactions rows WHERE fundamental_score IS NULL.
// Safe to re-run: only touches null rows, idempotent on already-scored rows.
//
// Performance strategy:
//   - Loads ALL P-code transactions once for cluster precomputation (avoids 410K per-row queries)
//   - Loads ALL market caps once
//   - Streams NULL rows in 1,000-row batches; always fetches from the head of the null set
//     (no offset drift as rows get scored)
//   - Runs 20 concurrent DB updates per batch
//
// Expected runtime: ~20-30 minutes for 410K rows
//
// Usage:
//   npx tsx scripts/backfill-fundamental-score.ts            # full run
//   npx tsx scripts/backfill-fundamental-score.ts --dry-run  # score + print 20 rows, no writes

import * as path from 'path'
import * as fs   from 'fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { computeFundamentalScore } from '../lib/scoring/fundamentalScore'

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

// ── Cluster precomputation ────────────────────────────────────────────────────
// Loads all P transactions once and builds a Map<rowId, clusterCount> in memory.
// clusterCount = distinct OTHER insiders who bought the same ticker in the 30 days
// BEFORE this transaction (matches the route's per-row cluster query exactly).

type ClusterRow = {
  id:               string
  ticker:           string
  insider_name:     string | null
  transaction_date: string
}

function buildClusterMap(allRows: ClusterRow[]): Map<string, number> {
  const byTicker = new Map<string, ClusterRow[]>()
  for (const row of allRows) {
    if (!byTicker.has(row.ticker)) byTicker.set(row.ticker, [])
    byTicker.get(row.ticker)!.push(row)
  }

  const WINDOW_MS = 30 * 24 * 60 * 60 * 1000
  const map       = new Map<string, number>()

  for (const trades of byTicker.values()) {
    trades.sort((a, b) => a.transaction_date.localeCompare(b.transaction_date))
    for (let i = 0; i < trades.length; i++) {
      const tx      = trades[i]
      const cutoffMs = new Date(tx.transaction_date).getTime() - WINDOW_MS
      const others   = new Set<string>()
      for (let j = i - 1; j >= 0; j--) {
        if (new Date(trades[j].transaction_date).getTime() < cutoffMs) break
        if (trades[j].insider_name) others.add(trades[j].insider_name!)
      }
      map.set(tx.id, others.size)
    }
  }

  return map
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
  console.log(DRY_RUN ? '[DRY RUN] Backfill fundamental_score' : 'Backfill fundamental_score')
  console.log('═'.repeat(60))

  // ── 1. Load all P transactions for cluster map ────────────────────────────
  console.log('\n[1/4] Loading all P transactions for cluster precomputation...')
  const clusterData = await fetchAll<ClusterRow>(
    sb, 'insider_transactions',
    'id, ticker, insider_name, transaction_date',
    q => q.eq('transaction_code', 'P').order('transaction_date', { ascending: true }),
    'P transactions'
  )

  // ── 2. Build cluster count map (in memory) ────────────────────────────────
  console.log('\n[2/4] Computing cluster counts...')
  const t0 = Date.now()
  const clusterMap = buildClusterMap(clusterData)
  console.log(`  Done in ${fmtDuration(Date.now() - t0)}`)

  // ── 3. Load all market caps ───────────────────────────────────────────────
  console.log('\n[3/4] Loading market caps...')
  const tickerRows = await fetchAll<{ symbol: string; market_cap: number | null }>(
    sb, 'tickers', 'symbol, market_cap',
    q => q, 'tickers'
  )
  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerRows) marketCapMap[t.symbol] = t.market_cap ?? null

  // ── 4. Count backlog ──────────────────────────────────────────────────────
  console.log('\n[4/4] Scoring unscored rows...')
  const { count: totalNull } = await sb
    .from('insider_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('transaction_code', 'P')
    .not('total_value', 'is', null)
    .is('fundamental_score', null)

  const total = totalNull ?? 0
  console.log(`  Backlog: ${total.toLocaleString()} rows`)

  if (total === 0) {
    console.log('  Nothing to do.')
    return
  }

  // ── Dry-run: sample first 1,000, print 20, quit ───────────────────────────
  if (DRY_RUN) {
    const { data: sample } = await sb
      .from('insider_transactions')
      .select('id, ticker, insider_name, officer_title, role, purchase_pct_market_cap, total_value, transaction_date')
      .eq('transaction_code', 'P')
      .not('total_value', 'is', null)
      .is('fundamental_score', null)
      .order('transaction_date', { ascending: false })
      .limit(1_000)

    if (!sample || sample.length === 0) { console.log('  No rows found.'); return }

    console.log('\n  [DRY RUN] Sample — 20 rows (not written):\n')
    const hdr = '  Ticker    Date          Score  Move%  Cluster  $Value'
    console.log(hdr)
    console.log('  ' + '-'.repeat(hdr.length - 2))
    for (const row of (sample as any[]).slice(0, 20)) {
      const cluster = clusterMap.get(row.id) ?? 0
      const mc      = marketCapMap[row.ticker] ?? null
      const { fundamental_score, expected_move } = computeFundamentalScore(row, cluster, mc)
      console.log(
        `  ${(row.ticker as string).padEnd(9)}` +
        `${row.transaction_date}  ` +
        `${String(fundamental_score).padStart(5)}  ` +
        `${String(expected_move).padStart(5)}%  ` +
        `${String(cluster).padStart(7)}  ` +
        `$${Number(row.total_value ?? 0).toLocaleString()}`
      )
    }
    console.log(`\n  [DRY RUN] ${total.toLocaleString()} rows would be scored. Run without --dry-run to commit.`)
    return
  }

  // ── Full run ──────────────────────────────────────────────────────────────
  let processed  = 0
  let errors     = 0
  let batchNum   = 0
  const startTime = Date.now()

  while (true) {
    batchNum++

    // Always fetch the HEAD of the null set — as rows get scored they drop out,
    // so no offset drift even if the cron also scores rows concurrently.
    const { data: rows, error: fetchErr } = await sb
      .from('insider_transactions')
      .select('id, ticker, officer_title, role, purchase_pct_market_cap, total_value, transaction_date')
      .eq('transaction_code', 'P')
      .not('total_value', 'is', null)
      .is('fundamental_score', null)
      .order('transaction_date', { ascending: false })
      .limit(BATCH_SIZE)

    if (fetchErr) {
      console.error(`\n  [batch ${batchNum}] fetch error: ${fetchErr.message}`)
      errors++
      await new Promise(r => setTimeout(r, 2_000))
      continue
    }
    if (!rows || rows.length === 0) break

    // Score every row using precomputed cluster counts + market cap
    const updates = (rows as any[]).map(row => {
      const cluster = clusterMap.get(row.id as string) ?? 0
      const mc      = marketCapMap[row.ticker] ?? null
      return {
        id: row.id as string,
        ...computeFundamentalScore(row, cluster, mc),
      }
    })

    // Write in concurrent chunks
    for (let i = 0; i < updates.length; i += CONCURRENCY) {
      const chunk = updates.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(
        chunk.map(u =>
          sb.from('insider_transactions')
            .update({ fundamental_score: u.fundamental_score, expected_move: u.expected_move })
            .eq('id', u.id)
        )
      )
      for (const r of results) {
        if (r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error)) errors++
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
