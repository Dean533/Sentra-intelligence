// Refresh daily price metrics from Yahoo Finance quote() API.
//
// quote() accepts an array of symbols (1 HTTP request per batch of 20).
// ~2,900 tickers → ~145 requests → ~2-3 min at 300ms between batches.
//
// Updates these tickers columns (all nullable):
//   price, price_change_pct, volume, avg_volume_3m, ma_50, ma_200,
//   week_52_high, week_52_low, week_52_change_pct, market_cap, price_updated_at
//
// All percentage/ratio values stored as fractions:
//   price_change_pct: regularMarketChangePercent / 100  (0.0234 = +2.34%)
//   week_52_change_pct: fiftyTwoWeekChange as-is        (0.25   = +25%)
//
// Usage:
//   npx tsx scripts/refresh-ticker-prices.ts               # full run
//   npx tsx scripts/refresh-ticker-prices.ts --dry-run     # fetch Yahoo, print, no DB writes
//   npx tsx scripts/refresh-ticker-prices.ts --limit 100   # process first 100 tickers only

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ── Config ────────────────────────────────────────────────────────────────────

const BATCH_SIZE  = 20     // tickers per quote() call
const BATCH_DELAY = 600    // ms between batches (polite to Yahoo; 300ms triggered soft-blocks at scale)
const RETRY_MAX   = 3      // max retries per batch on network error
const RETRY_DELAY = 5_000  // base ms for retry backoff (doubles each attempt)
const RATE_LIMIT_PAUSE = 120_000  // ms to wait on HTTP 429 (30s was too short; blocks last >90s)

// ── Args ──────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const limitArg = process.argv.find(a => a.startsWith('--limit=')) ??
  (process.argv.includes('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : null)
const LIMIT = limitArg ? parseInt(String(limitArg).replace('--limit=', ''), 10) : null

// ── Env ───────────────────────────────────────────────────────────────────────

function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)
const yf = new YahooFinance()
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// Safely coerce a Yahoo value to number | null.
// NEVER returns 0 for a missing value — null is the only representation of "not present".
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? n : null
}

function bigint_(v: unknown): number | null {
  const n = num(v)
  return n !== null ? Math.round(n) : null
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: any
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      const msg = e.message ?? ''
      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('too many')
      const delay = isRateLimit ? RATE_LIMIT_PAUSE : RETRY_DELAY * Math.pow(2, attempt)
      console.warn(`  [retry ${attempt + 1}/${RETRY_MAX}] ${label}: ${msg.slice(0, 70)} — waiting ${Math.round(delay / 1000)}s`)
      await sleep(delay)
    }
  }
  throw lastErr
}

// ── Price extraction ──────────────────────────────────────────────────────────

type PriceUpdate = {
  symbol:             string
  price:              number | null
  price_change_pct:   number | null  // fraction (0.0234 = +2.34%)
  volume:             number | null
  avg_volume_3m:      number | null
  ma_50:              number | null
  ma_200:             number | null
  week_52_high:       number | null
  week_52_low:        number | null
  week_52_change_pct: number | null  // fraction (0.25 = +25%); Yahoo returns as fraction
  market_cap:         number | null
  price_updated_at:   string
}

function extractPriceUpdate(symbol: string, q: any, updatedAt: string): PriceUpdate {
  const raw_change_pct = num(q?.regularMarketChangePercent)

  return {
    symbol,
    price:              num(q?.regularMarketPrice),
    price_change_pct:   raw_change_pct !== null ? raw_change_pct / 100 : null,
    volume:             bigint_(q?.regularMarketVolume),
    avg_volume_3m:      bigint_(q?.averageDailyVolume3Month),
    ma_50:              num(q?.fiftyDayAverage),
    ma_200:             num(q?.twoHundredDayAverage),
    week_52_high:       num(q?.fiftyTwoWeekHigh),
    week_52_low:        num(q?.fiftyTwoWeekLow),
    week_52_change_pct: num(q?.fiftyTwoWeekChange),
    market_cap:         num(q?.marketCap),
    price_updated_at:   updatedAt,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60))
  console.log(DRY_RUN ? '[DRY RUN] refresh-ticker-prices' : 'refresh-ticker-prices')
  if (LIMIT) console.log(`  limit: first ${LIMIT} tickers`)
  console.log('═'.repeat(60))

  // Load all ticker symbols
  process.stdout.write('\nLoading tickers from DB... ')
  const { data: tickerRows, error: tickerErr } = await sb
    .from('tickers')
    .select('symbol')
    .order('symbol', { ascending: true })

  if (tickerErr) {
    console.error(`\nFailed to load tickers: ${tickerErr.message}`)
    process.exit(1)
  }

  let symbols = (tickerRows ?? []).map((r: any) => r.symbol as string)
  if (LIMIT) symbols = symbols.slice(0, LIMIT)
  console.log(`${symbols.length} tickers`)

  const totalBatches = Math.ceil(symbols.length / BATCH_SIZE)
  const estMinutes   = Math.ceil(totalBatches * (BATCH_DELAY + 400) / 60_000)
  console.log(`\nBatch size: ${BATCH_SIZE} | Batches: ${totalBatches} | Estimated time: ~${estMinutes} min\n`)

  // Stats
  let updated  = 0  // successful Yahoo fetch + DB write
  let skipped  = 0  // Yahoo returned null/no data for the ticker
  let failed   = 0  // exception — ticker logged, run continues

  // Per-field counts (how many tickers actually had each field populated)
  const fieldFilled: Record<keyof Omit<PriceUpdate, 'symbol' | 'price_updated_at'>, number> = {
    price: 0, price_change_pct: 0, volume: 0, avg_volume_3m: 0,
    ma_50: 0, ma_200: 0, week_52_high: 0, week_52_low: 0,
    week_52_change_pct: 0, market_cap: 0,
  }

  const startTime   = Date.now()
  const updatedAt   = new Date().toISOString()

  // DRY RUN: print header
  if (DRY_RUN) {
    console.log('  Sample output (first 20 tickers):')
    console.log(`  ${'Symbol'.padEnd(7)} ${'Price'.padEnd(9)} ${'Chg%'.padEnd(8)} ${'Vol'.padEnd(12)} ${'Mkt Cap'.padEnd(14)} ${'MA50'.padEnd(9)} ${'MA200'.padEnd(9)} ${'52wk Hi'.padEnd(9)} ${'52wk Lo'.padEnd(9)} 52wkChg%`)
    console.log('  ' + '─'.repeat(105))
  }

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch    = symbols.slice(i, i + BATCH_SIZE)
    const batchNo  = Math.floor(i / BATCH_SIZE) + 1

    if (!DRY_RUN) {
      process.stdout.write(`  batch ${String(batchNo).padStart(3)}/${totalBatches}  [${batch[0]}…${batch[batch.length - 1]}]... `)
    }

    // ── Fetch from Yahoo ────────────────────────────────────────────────────
    let quotes: any[] = []
    try {
      const res = await withRetry(
        `batch ${batchNo}`,
        () => (yf.quote(batch as any, {}, { validateResult: false }) as Promise<any>)
      )
      quotes = Array.isArray(res) ? res : [res]
    } catch (e: any) {
      console.log(`FAILED — ${e.message?.slice(0, 80)}`)
      failed += batch.length
      if (i + BATCH_SIZE < symbols.length) await sleep(BATCH_DELAY)
      continue
    }

    // ── Extract updates ─────────────────────────────────────────────────────
    const updates: PriceUpdate[] = []

    for (let j = 0; j < batch.length; j++) {
      const sym  = batch[j]
      const q    = quotes[j] ?? null

      if (!q || !q.regularMarketPrice) {
        skipped++
        if (DRY_RUN && i + j < 20) {
          console.log(`  ${sym.padEnd(7)} (no data)`)
        }
        continue
      }

      const upd = extractPriceUpdate(sym, q, updatedAt)
      updates.push(upd)

      // Track field fill
      for (const key of Object.keys(fieldFilled) as Array<keyof typeof fieldFilled>) {
        if (upd[key] !== null) fieldFilled[key]++
      }

      if (DRY_RUN && i + j < 20) {
        const pchg = upd.price_change_pct !== null ? (upd.price_change_pct * 100).toFixed(2) + '%' : '—'
        const vol  = upd.volume !== null ? (upd.volume / 1e6).toFixed(1) + 'M' : '—'
        const mc   = upd.market_cap !== null ? '$' + (upd.market_cap / 1e9).toFixed(1) + 'B' : '—'
        const w52c = upd.week_52_change_pct !== null ? (upd.week_52_change_pct * 100).toFixed(1) + '%' : '—'
        console.log(
          `  ${sym.padEnd(7)}` +
          ` ${String(upd.price?.toFixed(2) ?? '—').padEnd(9)}` +
          ` ${pchg.padEnd(8)}` +
          ` ${vol.padEnd(12)}` +
          ` ${mc.padEnd(14)}` +
          ` ${String(upd.ma_50?.toFixed(2) ?? '—').padEnd(9)}` +
          ` ${String(upd.ma_200?.toFixed(2) ?? '—').padEnd(9)}` +
          ` ${String(upd.week_52_high?.toFixed(2) ?? '—').padEnd(9)}` +
          ` ${String(upd.week_52_low?.toFixed(2) ?? '—').padEnd(9)}` +
          ` ${w52c}`
        )
      }
    }

    // ── Write to DB ─────────────────────────────────────────────────────────
    if (!DRY_RUN && updates.length > 0) {
      const results = await Promise.allSettled(
        updates.map(upd => {
          const { symbol, ...fields } = upd
          return sb.from('tickers').update(fields).eq('symbol', symbol)
        })
      )
      let batchOk = 0
      for (let k = 0; k < results.length; k++) {
        const r = results[k]
        if (r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any).error)) {
          const msg = r.status === 'rejected'
            ? r.reason?.message
            : (r.value as any).error?.message
          console.warn(`  ⚠ DB error for ${updates[k].symbol}: ${msg}`)
          failed++
        } else {
          updated++
          batchOk++
        }
      }

      const elapsed    = Date.now() - startTime
      const rate       = updated / (elapsed / 1000)
      const remaining  = symbols.length - i - BATCH_SIZE
      const etaMs      = remaining > 0 ? (remaining / Math.max(rate, 1)) * 1000 : 0
      console.log(`ok (${batchOk}/${batch.length}) | ${rate.toFixed(0)}/s | ETA ${fmtDuration(etaMs)}`)
    } else if (!DRY_RUN) {
      const skippedInBatch = batch.length - updates.length
      console.log(`no data (${skippedInBatch}/${batch.length} skipped)`)
    }

    if (i + BATCH_SIZE < symbols.length) await sleep(BATCH_DELAY)
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const elapsed = Date.now() - startTime
  const total   = symbols.length

  console.log()
  console.log('═'.repeat(60))
  console.log(DRY_RUN ? '[DRY RUN] Complete — no writes made' : `Complete in ${fmtDuration(elapsed)}`)
  console.log('═'.repeat(60))
  console.log(`  Tickers processed : ${total}`)
  if (!DRY_RUN) console.log(`  Updated           : ${updated}`)
  console.log(`  Skipped (no data) : ${skipped}`)
  console.log(`  Failed            : ${failed}`)
  console.log()
  console.log('  Field fill rates (of tickers with any Yahoo data):')
  const denominator = total - skipped - failed
  const fieldOrder: Array<keyof typeof fieldFilled> = [
    'price', 'price_change_pct', 'volume', 'avg_volume_3m',
    'ma_50', 'ma_200', 'week_52_high', 'week_52_low', 'week_52_change_pct', 'market_cap',
  ]
  for (const f of fieldOrder) {
    const pct = denominator > 0 ? Math.round(fieldFilled[f] / denominator * 100) : 0
    const bar = '█'.repeat(Math.round(pct / 5))
    console.log(`    ${f.padEnd(22)} ${bar.padEnd(20)} ${String(pct).padStart(3)}%`)
  }

  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
