// npx tsx scripts/run-daily-ingest.ts
// npx tsx scripts/run-daily-ingest.ts --date 2026-06-20
// npx tsx scripts/run-daily-ingest.ts --start-date 2026-06-01 --end-date 2026-06-30
//
// Runs the full EDGAR Form 4 ingestion pipeline directly on the local machine
// (or GitHub Actions runner) — no Vercel HTTP endpoint, no 300s timeout.
// Processes ALL tracked tickers in one run with SEC rate-limit sleeps.

import * as path from 'path'
import * as fs   from 'fs'
import { createClient } from '@supabase/supabase-js'
import { runDailyIngest } from '../lib/insider/ingestCore'

// ── Env loading ───────────────────────────────────────────────────────────────
// In local dev: reads .env.local.
// On GitHub Actions: NEXT_PUBLIC_SUPABASE_URL and NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY
// are passed as env vars from repository secrets.

function loadEnv() {
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
loadEnv()

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  let date:      string | undefined
  let startDate: string | undefined
  let endDate:   string | undefined

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date'       && args[i + 1]) { date      = args[++i]; continue }
    if (args[i] === '--start-date' && args[i + 1]) { startDate = args[++i]; continue }
    if (args[i] === '--end-date'   && args[i + 1]) { endDate   = args[++i]; continue }
  }

  return { date, startDate, endDate }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL            ?? process.env.SUPABASE_URL
  const key     = process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    console.error('Missing Supabase credentials. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
    process.exit(1)
  }

  const supabase = createClient(url, key)
  const { date, startDate, endDate } = parseArgs()

  console.log('='.repeat(70))
  if (startDate && endDate) {
    console.log(`[ingest] date range: ${startDate} → ${endDate}`)
  } else if (date) {
    console.log(`[ingest] single date: ${date}`)
  } else {
    console.log('[ingest] rolling 5-day window')
  }
  console.log('='.repeat(70))

  const start = Date.now()

  const { days, totals } = await runDailyIngest(supabase, {
    date,
    startDate,
    endDate,
    // No batch/batchCount — process all CIKs in one pass
  })

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  console.log()
  console.log('='.repeat(70))
  console.log(`[ingest] done in ${elapsed}s`)
  console.log()

  // Summary table
  const colW = { date: 12, fetched: 9, inserted: 10, skipped: 9, failed: 7 }
  const hdr =
    'Date'.padEnd(colW.date) +
    'Fetched'.padStart(colW.fetched) +
    'Inserted'.padStart(colW.inserted) +
    'Skipped'.padStart(colW.skipped) +
    'Failed'.padStart(colW.failed)
  console.log('  ' + hdr)
  console.log('  ' + '─'.repeat(hdr.length))

  for (const d of days) {
    const row =
      d.date.padEnd(colW.date) +
      String(d.total_fetched).padStart(colW.fetched) +
      String(d.inserted).padStart(colW.inserted) +
      String(d.skipped).padStart(colW.skipped) +
      String(d.failed).padStart(colW.failed) +
      (d.error ? `  ⚠ ${d.error}` : '')
    console.log('  ' + row)
  }

  console.log('  ' + '─'.repeat(hdr.length))
  const totalRow =
    'TOTAL'.padEnd(colW.date) +
    ''.padStart(colW.fetched) +
    String(totals.inserted).padStart(colW.inserted) +
    String(totals.skipped).padStart(colW.skipped) +
    String(totals.failed).padStart(colW.failed)
  console.log('  ' + totalRow)
  console.log()

  if (totals.failed > 0) {
    console.error(`[ingest] ${totals.failed} filing(s) failed — check logs above`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
