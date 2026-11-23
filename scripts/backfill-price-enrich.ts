// Bulk-enriches all insider_transactions rows WHERE price_on_day IS NULL
// (and old enough that every forward-return window has closed).
// Safe to re-run: only touches null rows, idempotent on already-enriched rows.
//
// Performance strategy — this is the one enrichment step that makes real
// external calls (Yahoo Finance), so it's throttled very differently from
// backfill-fundamental-score.ts / backfill-conviction-score.ts:
//   - Fetches each ticker's Yahoo history ONCE for the whole run (cached),
//     not once per row. The production route used to refetch every row.
//   - Fetches SPY history once per unique transaction date (cached).
//   - 600ms between distinct Yahoo calls (matches refresh-ticker-prices.ts's
//     learned pacing — 300ms triggered soft-blocks at scale).
//   - DB reads/writes stay bulk/concurrent; only the Yahoo calls are throttled.
//
// Usage:
//   npx tsx scripts/backfill-price-enrich.ts            # full run
//   npx tsx scripts/backfill-price-enrich.ts --dry-run  # enrich + print 20 of a 100-row sample, no writes
//   npx tsx scripts/backfill-price-enrich.ts --until 2026-11-08  # only rows up through this date (skip the recent/urgent-only slice)

import * as path from 'path'
import * as fs   from 'fs'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  fetchHistory,
  offsetDate,
  computePriceEnrichment,
  PRICE_ENRICH_CUTOFF_DAYS,
  type HistRow,
} from '../lib/scoring/priceEnrich'

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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

// ── Args ──────────────────────────────────────────────────────────────────────

const DRY_RUN    = process.argv.includes('--dry-run')
const BATCH_SIZE = 500
const YAHOO_DELAY_MS = 600

const untilArg = process.argv.find(a => a.startsWith('--until='))
  ?? (process.argv.includes('--until') ? process.argv[process.argv.indexOf('--until') + 1] : null)
const UNTIL_DATE = untilArg ? String(untilArg).replace('--until=', '') : null

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const sb = createClient(url, key)

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - PRICE_ENRICH_CUTOFF_DAYS)
  const cutoffStr = UNTIL_DATE ?? cutoff.toISOString().split('T')[0]

  console.log('═'.repeat(70))
  console.log(DRY_RUN ? '[DRY RUN] Backfill price enrichment' : 'Backfill price enrichment')
  console.log(`  rows with transaction_date <= ${cutoffStr} and price_on_day IS NULL`)
  console.log('═'.repeat(70))

  // ── 1. Load market caps once ──────────────────────────────────────────────
  console.log('\n[1/2] Loading market caps...')
  const tickerRows = await fetchAll<{ symbol: string; market_cap: number | null }>(
    sb, 'tickers', 'symbol, market_cap', q => q, 'tickers'
  )
  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerRows) marketCapMap[t.symbol] = t.market_cap ?? null

  // ── 2. Count backlog ───────────────────────────────────────────────────────
  console.log('\n[2/2] Enriching backlog...')
  const { count: totalNull } = await sb
    .from('insider_transactions')
    .select('id', { count: 'exact', head: true })
    .not('transaction_date', 'is', null)
    .lte('transaction_date', cutoffStr)
    .is('price_on_day', null)

  const total = totalNull ?? 0
  console.log(`  Backlog: ${total.toLocaleString()} rows`)
  if (total === 0) { console.log('  Nothing to do.'); return }

  // Caches live for the whole run — a ticker or date seen in batch 1 is free in batch 50.
  const tickerHistoryCache = new Map<string, HistRow[]>()
  const spyCache           = new Map<string, HistRow[]>()
  let yahooCalls = 0

  async function getTickerHistory(ticker: string, txDate: Date): Promise<HistRow[]> {
    if (tickerHistoryCache.has(ticker)) return tickerHistoryCache.get(ticker)!
    const hist = await fetchHistory(ticker, offsetDate(txDate, -10), offsetDate(txDate, 16))
    tickerHistoryCache.set(ticker, hist)
    yahooCalls++
    await sleep(YAHOO_DELAY_MS)
    return hist
  }

  async function getSpyHistory(dateStr: string): Promise<HistRow[]> {
    if (spyCache.has(dateStr)) return spyCache.get(dateStr)!
    const base = new Date(dateStr)
    const hist = await fetchHistory('SPY', offsetDate(base, -10), offsetDate(base, 16))
    spyCache.set(dateStr, hist)
    yahooCalls++
    await sleep(YAHOO_DELAY_MS)
    return hist
  }

  // ── Dry-run: sample 100, enrich + print 20, no writes ─────────────────────
  if (DRY_RUN) {
    const { data: sample } = await sb
      .from('insider_transactions')
      .select('id, ticker, transaction_date, total_value')
      .not('transaction_date', 'is', null)
      .lte('transaction_date', cutoffStr)
      .is('price_on_day', null)
      .order('transaction_date', { ascending: false })
      .limit(100)

    if (!sample || sample.length === 0) { console.log('  No rows found.'); return }

    console.log('\n  [DRY RUN] Sample — 20 of 100 rows (not written):\n')
    const hdr = '  Ticker    Date          Price0   Ret5d%   AdjRet5d%'
    console.log(hdr)
    console.log('  ' + '-'.repeat(hdr.length - 2))

    let shown = 0
    for (const row of sample as any[]) {
      const txDate  = new Date(row.transaction_date)
      const history = await getTickerHistory(row.ticker, txDate)
      if (history.length === 0) continue
      const spyHistory = await getSpyHistory(row.transaction_date)
      const result = computePriceEnrichment(row, history, spyHistory, marketCapMap[row.ticker] ?? null)
      if (!result) continue
      if (shown < 20) {
        console.log(
          `  ${(row.ticker as string).padEnd(9)}` +
          `${row.transaction_date}  ` +
          `${String(result.price_on_day).padStart(7)}  ` +
          `${String(result.actual_return_5d ?? '—').padStart(7)}  ` +
          `${String(result.adjusted_return_5d ?? '—').padStart(9)}`
        )
        shown++
      }
    }
    console.log(`\n  [DRY RUN] ${total.toLocaleString()} rows in backlog, ${yahooCalls} Yahoo calls for this 100-row sample (${tickerHistoryCache.size} tickers + ${spyCache.size} SPY dates).`)
    console.log(`  Run without --dry-run to commit.`)
    return
  }

  // ── Full run ──────────────────────────────────────────────────────────────
  let processed  = 0
  let enriched   = 0
  let failed     = 0
  let batchNum   = 0
  const startTime = Date.now()

  while (true) {
    batchNum++

    const { data: rows, error: fetchErr } = await sb
      .from('insider_transactions')
      .select('id, ticker, transaction_date, total_value')
      .not('transaction_date', 'is', null)
      .lte('transaction_date', cutoffStr)
      .is('price_on_day', null)
      .order('transaction_date', { ascending: false })
      .limit(BATCH_SIZE)

    if (fetchErr) {
      console.error(`\n  [batch ${batchNum}] fetch error: ${fetchErr.message}`)
      await sleep(2_000)
      continue
    }
    if (!rows || rows.length === 0) break

    for (const row of rows as any[]) {
      try {
        const txDate  = new Date(row.transaction_date)
        const history = await getTickerHistory(row.ticker, txDate)
        if (history.length === 0) { failed++; continue }

        const spyHistory = await getSpyHistory(row.transaction_date)
        const result = computePriceEnrichment(row, history, spyHistory, marketCapMap[row.ticker] ?? null)
        if (!result) { failed++; continue }

        const { error: updateErr } = await sb
          .from('insider_transactions')
          .update(result)
          .eq('id', row.id)

        if (updateErr) { failed++; continue }
        enriched++
      } catch {
        failed++
      }
    }

    processed += rows.length
    const elapsed   = Date.now() - startTime
    const rate      = processed / (elapsed / 1000)
    const remaining = Math.max(0, total - processed)
    const etaMs     = remaining / rate * 1000

    process.stdout.write(
      `\r  Batch ${batchNum}: ${processed.toLocaleString()}/${total.toLocaleString()} processed` +
      ` | ${enriched} enriched, ${failed} failed` +
      ` | ${tickerHistoryCache.size} tickers + ${spyCache.size} dates cached` +
      ` | ETA ${fmtDuration(etaMs)}   `
    )

    if (rows.length < BATCH_SIZE) break
  }

  const elapsed = Date.now() - startTime
  console.log('\n')
  console.log('═'.repeat(70))
  console.log(`Done in ${fmtDuration(elapsed)}`)
  console.log(`  Processed:   ${processed.toLocaleString()} rows`)
  console.log(`  Enriched:    ${enriched.toLocaleString()}`)
  console.log(`  Failed:      ${failed.toLocaleString()}`)
  console.log(`  Yahoo calls: ${yahooCalls} (${tickerHistoryCache.size} tickers + ${spyCache.size} SPY dates)`)
}

main().catch(e => { console.error(e); process.exit(1) })
