// Run with:  npx tsx scripts/populate-hq-states.ts

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

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

const supabase      = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)
const yahooFinance  = new YahooFinance()
const YAHOO_DELAY_MS = 200

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { data: tickerRows, error } = await supabase
    .from('tickers')
    .select('symbol')
    .order('symbol', { ascending: true })

  if (error) {
    console.error('Failed to fetch tickers:', error.message)
    process.exit(1)
  }

  const tickers = (tickerRows ?? []).map((r: any) => r.symbol as string)
  console.log(`Fetched ${tickers.length} tickers\n`)

  let updated  = 0
  let skipped  = 0
  let failed   = 0

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i]
    const prefix = `[${i + 1}/${tickers.length}] ${ticker.padEnd(6)}`

    await sleep(YAHOO_DELAY_MS)

    let state: string | null = null

    try {
      const summary: any = await yahooFinance.quoteSummary(ticker, {
        modules: ['assetProfile'] as any,
      })
      const raw = summary?.assetProfile?.state ?? null
      // Only accept two-letter US state codes — Yahoo returns 'CA', 'NY', etc.
      // Non-US companies may return a province name or nothing; treat those as null.
      if (raw && /^[A-Z]{2}$/.test(raw.trim())) {
        state = raw.trim()
      }
    } catch (err: any) {
      console.log(`${prefix} — ⚠ Yahoo error: ${err.message}`)
      failed++
      continue
    }

    const { error: updateErr } = await supabase
      .from('tickers')
      .update({ hq_state: state })
      .eq('symbol', ticker)

    if (updateErr) {
      console.log(`${prefix} — ⚠ DB error: ${updateErr.message}`)
      failed++
      continue
    }

    if (state) {
      console.log(`${prefix} — state: ${state}`)
      updated++
    } else {
      console.log(`${prefix} — state: (none — skipped)`)
      skipped++
    }
  }

  console.log(`\nDone.`)
  console.log(`  Updated with state : ${updated}`)
  console.log(`  No state (non-US)  : ${skipped}`)
  console.log(`  Errors             : ${failed}`)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
