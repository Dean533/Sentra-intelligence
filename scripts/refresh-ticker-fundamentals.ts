// Refresh weekly fundamental metrics from Yahoo Finance quoteSummary() API.
//
// quoteSummary() cannot be batched — 1 HTTP request per ticker.
// ~2,900 tickers at 600ms delay → ~29 min, but failures are fast
// and you can use --limit / split across days (e.g., 1,000/day = 3 days).
//
// Updates these tickers columns (all nullable):
//   revenue, profit_margin, beta, debt_to_equity, return_on_equity,
//   ebitda, fundamentals_updated_at
//
// Storage convention: fractions, not percentages.
//   profit_margin 0.12 = 12%  |  return_on_equity 0.15 = 15%
//   debt_to_equity is a plain ratio (1.5 = 150% of equity, not divided by 100)
//
// Usage:
//   npx tsx scripts/refresh-ticker-fundamentals.ts                # full run
//   npx tsx scripts/refresh-ticker-fundamentals.ts --dry-run      # print, no DB writes
//   npx tsx scripts/refresh-ticker-fundamentals.ts --limit 200    # first 200 tickers
//   npx tsx scripts/refresh-ticker-fundamentals.ts --offset 1000  # start at ticker 1001

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ── Config ────────────────────────────────────────────────────────────────────

const TICKER_DELAY   = 600    // ms between requests (350ms triggered soft-blocks at scale; ~100/min)
const RETRY_MAX      = 3      // max retries on network error (not on 404/no-data)
const RETRY_DELAY_MS = 8_000  // base backoff, doubles each retry
const RATE_LIMIT_PAUSE = 120_000  // ms to wait on HTTP 429 (must exceed Yahoo's block duration)

// ── Args ──────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')

const limitArg = process.argv.find(a => a.startsWith('--limit=')) ??
  (process.argv.includes('--limit')
    ? process.argv[process.argv.indexOf('--limit') + 1]
    : null)
const LIMIT = limitArg ? parseInt(String(limitArg).replace('--limit=', ''), 10) : null

const offsetArg = process.argv.find(a => a.startsWith('--offset=')) ??
  (process.argv.includes('--offset')
    ? process.argv[process.argv.indexOf('--offset') + 1]
    : null)
const OFFSET = offsetArg ? parseInt(String(offsetArg).replace('--offset=', ''), 10) : 0

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
const yf    = new YahooFinance()
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60)  return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

// NEVER coerce missing values to 0. null means "Yahoo didn't return this".
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? n : null
}

// ── Fundamentals extraction ───────────────────────────────────────────────────

type FundamentalsUpdate = {
  symbol:                   string
  revenue:                  number | null
  profit_margin:            number | null  // fraction (0.12 = 12%)
  beta:                     number | null
  debt_to_equity:           number | null  // ratio (1.5 = 150% of equity)
  return_on_equity:         number | null  // fraction (0.15 = 15%)
  ebitda:                   number | null
  fundamentals_updated_at:  string
}

const QS_MODULES = ['summaryDetail', 'financialData'] as const

async function fetchFundamentals(symbol: string): Promise<FundamentalsUpdate | null> {
  let qs: any
  let lastErr: any

  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      qs = await (yf.quoteSummary(
        symbol,
        { modules: [...QS_MODULES] as any },
        { validateResult: false } as any
      ) as Promise<any>)
      break  // success
    } catch (e: any) {
      lastErr = e
      const msg = e.message ?? ''

      // 404 / "No fundamentals data found" — this ticker doesn't have data.
      // Don't retry; return null so caller can mark as skipped.
      const isNoData = msg.includes('404') || msg.includes('No fundamentals') ||
        msg.includes('not found') || msg.toLowerCase().includes('invalid ticker')
      if (isNoData) return null

      const isRateLimit = msg.includes('429') || msg.toLowerCase().includes('too many')
      const delay = isRateLimit ? RATE_LIMIT_PAUSE : RETRY_DELAY_MS * Math.pow(2, attempt)

      if (attempt < RETRY_MAX - 1) {
        process.stdout.write(` [retry ${attempt + 1} in ${Math.round(delay / 1000)}s]`)
        await sleep(delay)
      }
    }
  }

  if (!qs) throw lastErr  // let caller catch and count as failure

  const sd = qs?.summaryDetail ?? null
  const fd = qs?.financialData  ?? null

  // Beta: prefer summaryDetail (more consistently populated than defaultKeyStatistics)
  const beta = num(sd?.beta) ?? num(fd?.beta)

  return {
    symbol,
    revenue:                 num(fd?.totalRevenue),
    profit_margin:           num(fd?.profitMargins),
    beta,
    debt_to_equity:          num(fd?.debtToEquity),
    return_on_equity:        num(fd?.returnOnEquity),
    ebitda:                  num(fd?.ebitda),
    fundamentals_updated_at: new Date().toISOString(),
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(60))
  console.log(DRY_RUN ? '[DRY RUN] refresh-ticker-fundamentals' : 'refresh-ticker-fundamentals')
  if (OFFSET) console.log(`  offset: starting at ticker ${OFFSET + 1}`)
  if (LIMIT)  console.log(`  limit:  ${LIMIT} tickers`)
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

  let allSymbols = (tickerRows ?? []).map((r: any) => r.symbol as string)
  let symbols    = allSymbols.slice(OFFSET, LIMIT ? OFFSET + LIMIT : undefined)
  console.log(`${allSymbols.length} total, processing ${symbols.length}`)

  const estMs  = symbols.length * (TICKER_DELAY + 600)  // 600ms avg network time
  console.log(`\nModules: ${QS_MODULES.join(', ')}`)
  console.log(`Delay: ${TICKER_DELAY}ms between requests`)
  console.log(`Estimated time: ~${fmtDuration(estMs)}`)
  console.log()

  // Stats
  let updated  = 0
  let skipped  = 0  // no fundamentals data from Yahoo
  let failed   = 0  // network error after retries

  const fieldFilled: Record<keyof Omit<FundamentalsUpdate, 'symbol' | 'fundamentals_updated_at'>, number> = {
    revenue: 0, profit_margin: 0, beta: 0,
    debt_to_equity: 0, return_on_equity: 0, ebitda: 0,
  }

  const failedSymbols: string[] = []
  const startTime = Date.now()

  // DRY RUN: print header
  if (DRY_RUN) {
    console.log(`  ${'Symbol'.padEnd(7)} ${'Revenue'.padEnd(13)} ${'Margin'.padEnd(8)} ${'Beta'.padEnd(7)} ${'D/E'.padEnd(7)} ${'ROE'.padEnd(8)} ${'EBITDA'.padEnd(13)}`)
    console.log('  ' + '─'.repeat(80))
  }

  for (let i = 0; i < symbols.length; i++) {
    const sym    = symbols[i]
    const lineNo = `[${String(i + 1).padStart(String(symbols.length).length)}/${symbols.length}]`

    if (!DRY_RUN) {
      process.stdout.write(`  ${lineNo} ${sym.padEnd(6)}... `)
    }

    // Delay before each request (except the first)
    if (i > 0) await sleep(TICKER_DELAY)

    // Fetch
    let upd: FundamentalsUpdate | null = null
    try {
      upd = await fetchFundamentals(sym)
    } catch (e: any) {
      if (!DRY_RUN) console.log(`FAILED — ${e.message?.slice(0, 70)}`)
      failed++
      failedSymbols.push(sym)
      continue
    }

    if (!upd) {
      if (!DRY_RUN) console.log('no data')
      skipped++
      continue
    }

    // Track field fill counts
    for (const key of Object.keys(fieldFilled) as Array<keyof typeof fieldFilled>) {
      if ((upd as any)[key] !== null) fieldFilled[key]++
    }

    // DRY RUN: print and continue
    if (DRY_RUN) {
      const fmtBillion = (v: number | null) =>
        v !== null ? '$' + (v / 1e9).toFixed(2) + 'B' : '—'
      const fmtPct = (v: number | null) =>
        v !== null ? (v * 100).toFixed(1) + '%' : '—'
      const fmtRatio = (v: number | null) =>
        v !== null ? v.toFixed(2) : '—'

      if (i < 30) {
        console.log(
          `  ${sym.padEnd(7)}` +
          ` ${fmtBillion(upd.revenue).padEnd(13)}` +
          ` ${fmtPct(upd.profit_margin).padEnd(8)}` +
          ` ${fmtRatio(upd.beta).padEnd(7)}` +
          ` ${fmtRatio(upd.debt_to_equity).padEnd(7)}` +
          ` ${fmtPct(upd.return_on_equity).padEnd(8)}` +
          ` ${fmtBillion(upd.ebitda)}`
        )
      } else if (i === 30) {
        console.log(`  … (showing first 30 — ${symbols.length - 30} more)`)
      }
      updated++
      continue
    }

    // Write to DB
    const { symbol, ...fields } = upd
    const { error: dbErr } = await sb
      .from('tickers')
      .update(fields)
      .eq('symbol', symbol)

    if (dbErr) {
      console.log(`DB error — ${dbErr.message}`)
      failed++
      failedSymbols.push(sym)
      continue
    }

    updated++
    const elapsed   = Date.now() - startTime
    const rate      = updated / (elapsed / 1000)  // tickers/sec
    const remaining = symbols.length - i - 1
    const etaMs     = remaining > 0 ? (remaining / Math.max(rate, 0.1)) * 1000 : 0

    const filledStr = Object.keys(fieldFilled)
      .filter(k => (upd! as any)[k] !== null)
      .map(k => k.replace(/_/g, ''))
      .join(',')

    console.log(`ok [${filledStr || 'all null'}] | ETA ${fmtDuration(etaMs)}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const elapsed = Date.now() - startTime
  console.log()
  console.log('═'.repeat(60))
  console.log(DRY_RUN ? '[DRY RUN] Complete — no writes made' : `Complete in ${fmtDuration(elapsed)}`)
  console.log('═'.repeat(60))
  console.log(`  Tickers processed : ${symbols.length}`)
  if (!DRY_RUN) console.log(`  Updated           : ${updated}`)
  console.log(`  Skipped (no data) : ${skipped}`)
  console.log(`  Failed            : ${failed}`)

  if (failedSymbols.length > 0) {
    console.log(`\n  Failed tickers:`)
    console.log(`    ${failedSymbols.join(', ')}`)
  }

  console.log()
  console.log('  Field fill rates (of tickers with any Yahoo data):')
  const denominator = symbols.length - skipped - failed
  const fieldOrder: Array<keyof typeof fieldFilled> = [
    'revenue', 'profit_margin', 'beta', 'debt_to_equity', 'return_on_equity', 'ebitda',
  ]
  for (const f of fieldOrder) {
    const pct = denominator > 0 ? Math.round(fieldFilled[f] / denominator * 100) : 0
    const bar = '█'.repeat(Math.round(pct / 5))
    console.log(`    ${f.padEnd(22)} ${bar.padEnd(20)} ${String(pct).padStart(3)}%`)
  }

  // Suggest splitting if not all tickers were run
  if (LIMIT && LIMIT < allSymbols.length) {
    const nextOffset = OFFSET + symbols.length
    if (nextOffset < allSymbols.length) {
      console.log()
      console.log(`  Next chunk:`)
      console.log(`    npx tsx scripts/refresh-ticker-fundamentals.ts --offset ${nextOffset} --limit ${LIMIT}`)
    }
  }

  if (failed > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
