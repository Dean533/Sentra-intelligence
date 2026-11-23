// Run with:  npx tsx scripts/fetch-market-caps.ts
// Fetches current market cap from Yahoo Finance for every ticker in the
// tickers table and writes it back to the market_cap column.
// Resume-safe: completed symbols saved to output/market-cap-progress.json.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)
const yf = new YahooFinance()

// ─── Constants ────────────────────────────────────────────────────────────────

const DELAY_MS    = 200
const PROGRESS_F  = path.join(__dirname, '..', 'output', 'market-cap-progress.json')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Fetch market cap ─────────────────────────────────────────────────────────

async function fetchMarketCap(symbol: string): Promise<number | null> {
  // quote() is one round-trip and returns marketCap directly
  const q = await yf.quote(symbol, {}, { validateResult: false }) as any
  const mc = q?.marketCap ?? null
  return typeof mc === 'number' && mc > 0 ? mc : null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(path.dirname(PROGRESS_F), { recursive: true })

  // ── Load resume state ──────────────────────────────────────────────────────

  const done = new Map<string, number | null>() // symbol → marketCap (null = failed)
  if (fs.existsSync(PROGRESS_F)) {
    const saved = JSON.parse(fs.readFileSync(PROGRESS_F, 'utf-8')) as Record<string, number | null>
    for (const [sym, mc] of Object.entries(saved)) done.set(sym, mc)
    console.log(`Resuming: ${done.size} symbols already processed`)
  }

  // ── Fetch all symbols from tickers (paginate to bypass 1000-row cap) ──────

  const symbols: string[] = []
  let symFrom = 0
  while (true) {
    const { data: rows, error } = await supabase
      .from('tickers')
      .select('symbol')
      .order('symbol', { ascending: true })
      .range(symFrom, symFrom + 999)
    if (error) { console.error('Failed to fetch tickers:', error.message); process.exit(1) }
    for (const r of rows ?? []) symbols.push((r as any).symbol)
    if ((rows ?? []).length < 1000) break
    symFrom += 1000
  }
  console.log(`Tickers in DB: ${symbols.length}`)

  const pending = symbols.filter(s => !done.has(s))
  console.log(`To fetch: ${pending.length}  (${done.size} cached)\n`)

  const saveProgress = () =>
    fs.writeFileSync(PROGRESS_F, JSON.stringify(Object.fromEntries(done), null, 2))

  // ── Fetch loop ─────────────────────────────────────────────────────────────

  for (let i = 0; i < pending.length; i++) {
    const symbol = pending[i]
    const total  = done.size + i + 1

    process.stdout.write(`[${total}/${symbols.length}] ${symbol.padEnd(8)} `)

    await sleep(DELAY_MS)
    let mc: number | null = null
    try {
      mc = await fetchMarketCap(symbol)
      if (mc != null) {
        process.stdout.write(`$${(mc / 1e9).toFixed(2)}B\n`)
      } else {
        process.stdout.write(`no market cap returned\n`)
      }
    } catch (err: any) {
      process.stdout.write(`FAIL: ${err.message?.slice(0, 60)}\n`)
    }

    done.set(symbol, mc)
    if ((i + 1) % 50 === 0) saveProgress()
  }

  saveProgress()

  // ── Write to DB ────────────────────────────────────────────────────────────

  console.log('\nWriting to tickers.market_cap...')

  let updated = 0, failed = 0, skipped = 0

  for (const [symbol, mc] of done) {
    if (mc == null) { failed++; continue }

    const { error: upErr } = await supabase
      .from('tickers')
      .update({ market_cap: mc, last_updated: new Date().toISOString() })
      .eq('symbol', symbol)

    if (upErr) {
      console.error(`  DB error for ${symbol}: ${upErr.message}`)
      failed++
    } else {
      updated++
    }
  }

  skipped = symbols.length - done.size

  console.log('\nDone.')
  console.log(`  Updated:  ${updated}`)
  console.log(`  No data:  ${failed}  (foreign/delisted/ETF with no market cap)`)
  if (skipped > 0) console.log(`  Skipped:  ${skipped}  (not in progress file)`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
