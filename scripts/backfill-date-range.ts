// Backfills Form 4 insider transactions for an inclusive filed-date range.
//
//   npx tsx scripts/backfill-date-range.ts --start 2026-09-28 --end 2026-11-09
//
// Unlike scripts/run-daily-ingest.ts, which sweeps every tracked company once
// PER DAY in the range, this sweeps each company once, collects every Form 4
// filed inside the window from its submissions JSON, and processes those.
// Same rows come out: parsing, dedup, flags and the events mirror all come from
// lib/insider/ingestCore.ts unchanged.
//
// Safe to re-run and safe to interrupt: processFiling dedups against the DB,
// and a progress file (output/backfill-date-range-progress.json) records each
// finished company so a restart with the same --start/--end resumes where it
// stopped. Delete that file to start over.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import {
  SEC_HEADERS,
  loadCikMap,
  loadTickerMeta,
  padCik,
  processFiling,
  sleep,
} from '../lib/insider/ingestCore'

// ── Env (same loader as run-daily-ingest.ts) ─────────────────────────────────

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

// ── Args ─────────────────────────────────────────────────────────────────────

function parseArgs(): { start: string; end: string } {
  const args = process.argv.slice(2)
  let start: string | undefined
  let end:   string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) { start = args[++i]; continue }
    if (args[i] === '--end'   && args[i + 1]) { end   = args[++i]; continue }
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/
  if (!start || !end || !iso.test(start) || !iso.test(end) || start > end) {
    console.error('Usage: npx tsx scripts/backfill-date-range.ts --start YYYY-MM-DD --end YYYY-MM-DD')
    process.exit(1)
  }
  return { start, end }
}

// ── SEC fetch with rate-limit handling ───────────────────────────────────────
// SEC allows 10 requests/second per IP and blocks for ~10 minutes if exceeded.
// Normal pacing here stays around 3 to 6/sec. On a 429 or 403, wait out the
// block and retry rather than skipping a company.

const RATE_LIMIT_PAUSE_MS = 10 * 60 * 1000
const MAX_RETRIES         = 3

async function secFetch(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: SEC_HEADERS })
    if (res.status !== 429 && res.status !== 403) return res
    if (attempt >= MAX_RETRIES) return res
    console.log(`[backfill] SEC returned ${res.status}, pausing ${RATE_LIMIT_PAUSE_MS / 60000} min before retry ${attempt + 1}/${MAX_RETRIES}`)
    await sleep(RATE_LIMIT_PAUSE_MS)
  }
}

// ── Progress file ────────────────────────────────────────────────────────────

const PROGRESS_PATH = path.join(__dirname, '..', 'output', 'backfill-date-range-progress.json')

type Progress = { start: string; end: string; done: string[] }

function loadProgress(start: string, end: string): Set<string> {
  if (!fs.existsSync(PROGRESS_PATH)) return new Set()
  const saved = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8')) as Progress
  if (saved.start !== start || saved.end !== end) {
    console.log(`[backfill] progress file is for ${saved.start}..${saved.end}, not this range. Ignoring it.`)
    return new Set()
  }
  return new Set(saved.done)
}

function saveProgress(start: string, end: string, done: Set<string>) {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true })
  const body: Progress = { start, end, done: [...done] }
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(body, null, 2), 'utf-8')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY (expected in .env.local)')
    process.exit(1)
  }
  const supabase = createClient(url, key)
  const { start, end } = parseArgs()

  console.log('='.repeat(70))
  console.log(`[backfill] filed-date range ${start} to ${end} (inclusive)`)
  console.log('='.repeat(70))

  const tickerMeta = await loadTickerMeta(supabase)
  const symbolSet  = new Set(tickerMeta.map((t) => t.symbol))
  const hqState:   Record<string, string | null> = {}
  const company:   Record<string, string | null> = {}
  for (const t of tickerMeta) {
    hqState[t.symbol] = t.hqState
    company[t.symbol] = t.companyName
  }

  const { cikToTicker } = await loadCikMap(symbolSet)
  const ciks = Object.keys(cikToTicker).map(Number).sort((a, b) => a - b)
  console.log(`[backfill] ${tickerMeta.length} tickers, ${ciks.length} resolve to a CIK`)

  const done = loadProgress(start, end)
  if (done.size > 0) console.log(`[backfill] resuming, ${done.size} companies already done`)

  const t0 = Date.now()
  let filings      = 0
  let inserted     = 0
  let skipped      = 0
  let insertFailed = 0
  let failed       = 0   // whole-filing exceptions
  let subFailed    = 0   // companies whose submissions JSON could not be fetched

  for (let i = 0; i < ciks.length; i++) {
    const cikInt = ciks[i]
    const ticker = cikToTicker[cikInt]
    const label  = `[${String(i + 1).padStart(4)}/${ciks.length}] ${ticker.padEnd(6)}`

    if (done.has(ticker)) continue

    await sleep(150)
    const subRes = await secFetch(`https://data.sec.gov/submissions/CIK${padCik(cikInt)}.json`)
    if (!subRes.ok) {
      console.log(`${label} submissions fetch failed: HTTP ${subRes.status} (will retry on next run)`)
      subFailed++
      continue
    }

    const recent = (await subRes.json())?.filings?.recent
    const forms:    string[] = recent?.form            ?? []
    const dates:    string[] = recent?.filingDate      ?? []
    const adshList: string[] = recent?.accessionNumber ?? []
    const docs:     string[] = recent?.primaryDocument ?? []

    // recent[] is newest first, so stop once we pass the start of the window.
    const hits: { adsh: string; doc: string | null; filed: string }[] = []
    for (let j = 0; j < forms.length; j++) {
      if (dates[j] < start) break
      if (dates[j] > end || forms[j] !== '4' || !adshList[j]) continue
      hits.push({ adsh: adshList[j], doc: docs[j] ?? null, filed: dates[j] })
    }

    let tInserted = 0
    let tSkipped  = 0
    let tFailed   = 0
    for (const h of hits) {
      try {
        await sleep(150)
        const r = await processFiling(ticker, cikInt, h.adsh, h.doc, h.filed, hqState[ticker] ?? null, company[ticker] ?? null, supabase)
        tInserted    += r.inserted
        tSkipped     += r.skipped
        insertFailed += r.insertFailed
      } catch (err: any) {
        console.log(`${label} error on ${h.adsh}: ${err.message}`)
        tFailed++
      }
    }

    filings  += hits.length
    inserted += tInserted
    skipped  += tSkipped
    failed   += tFailed

    if (hits.length > 0 || (i + 1) % 100 === 0) {
      const mins = ((Date.now() - t0) / 60000).toFixed(1)
      console.log(`${label} ${hits.length} filing(s), ${tInserted} inserted, ${tSkipped} skipped${tFailed ? `, ${tFailed} FAILED` : ''}  [${mins} min, ${inserted} rows total]`)
    }

    done.add(ticker)
    saveProgress(start, end, done)
  }

  const mins = ((Date.now() - t0) / 60000).toFixed(1)
  console.log()
  console.log('='.repeat(70))
  console.log(`[backfill] done in ${mins} min`)
  console.log(`  companies swept      : ${done.size}/${ciks.length}`)
  console.log(`  filings in window    : ${filings}`)
  console.log(`  rows inserted        : ${inserted}`)
  console.log(`  filings skipped/dedup: ${skipped}`)
  console.log(`  row insert failures  : ${insertFailed}`)
  console.log(`  filing exceptions    : ${failed}`)
  console.log(`  submissions failures : ${subFailed}${subFailed ? '  (re-run the same command to retry these)' : ''}`)
  console.log('='.repeat(70))

  if (subFailed > 0 || failed > 0) process.exit(2)
}

main().catch((e) => { console.error(e); process.exit(1) })
