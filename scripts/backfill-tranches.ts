// scripts/backfill-tranches.ts
//
// Recovers missing historical tranche rows in insider_transactions.
//
// BACKGROUND:
//   A database unique constraint that omitted `shares` from its key caused the
//   ingest pipeline to silently drop all but the first tranche from multi-tranche
//   Form 4 filings (same ticker + insider + date + code). Sells (S) from 10b5-1
//   plan sales are most affected; purchases (P) are nearly intact.
//
// HOW IT WORKS:
//   For each distinct accession_number in the DB, fetches the Form 4 XML from
//   EDGAR and counts P/S nonDerivativeTransaction blocks. Where XML count > DB
//   count, calls processFiling() — the shared ingest function — to re-insert.
//   processFiling's own dedup check (ticker + cik + date + shares + direction)
//   skips rows that already exist, so running this twice is safe.
//
// Usage:
//   npx tsx scripts/backfill-tranches.ts --dry-run              # safe preview, no writes
//   npx tsx scripts/backfill-tranches.ts                        # fix large-cap tickers
//   npx tsx scripts/backfill-tranches.ts --tickers AAPL,DELL    # targeted tickers
//   npx tsx scripts/backfill-tranches.ts --all                  # all tickers in DB (slow)
//   npx tsx scripts/backfill-tranches.ts --n 500                # cap accessions scanned

import * as path from 'path'
import * as fs   from 'fs'

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

import { createClient } from '@supabase/supabase-js'
import { processFiling } from '../lib/insider/ingestCore'

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ── CLI args ──────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2)
const DRY_RUN     = args.includes('--dry-run')
const ALL_MODE    = args.includes('--all')
const flagTickers = args.indexOf('--tickers')
const ONLY_TICKERS: string[] | null =
  flagTickers >= 0 ? args[flagTickers + 1].toUpperCase().split(',') : null
const flagN = args.indexOf('--n')
const MAX_ACCESSIONS = flagN >= 0 ? parseInt(args[flagN + 1], 10) : Infinity

// Large-cap tickers most likely to have 10b5-1 plan sales with many same-day tranches.
// These are the default scan scope when --all and --tickers are not specified.
const LARGE_CAPS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA', 'JPM', 'V',
  'XOM',  'UNH',  'JNJ',  'PG',   'MA',   'AVGO',  'HD',   'COST', 'MRK', 'ABBV',
  'LLY',  'CVX',  'WMT',  'AMD',  'ORCL', 'ACN',   'TMO',  'ADBE', 'NFLX','CRM',
  'AMGN', 'TXN',  'QCOM', 'NEE',  'RTX',  'HON',   'LOW',  'IBM',  'AMAT','INTC',
  'DELL', 'COP',  'CAT',  'GS',   'BLK',  'SBUX',  'PYPL', 'SQ',   'COIN','UBER',
]

// ── EDGAR rate-limited fetch ───────────────────────────────────────────────────

const EDGAR_UA = 'SentraSignals backfill deangans815@gmail.com'
const DELAY_MS = 120  // ≈8 req/s, SEC limit is 10/s
let   lastFetch = 0

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)) }

async function edgarGet(url: string, retries = 3): Promise<string | null> {
  const wait = DELAY_MS - (Date.now() - lastFetch)
  if (wait > 0) await sleep(wait)
  lastFetch = Date.now()
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': EDGAR_UA } })
      if (r.status === 429) {
        const sec = 10 * attempt
        process.stderr.write(`\n  [rate-limit] waiting ${sec}s\n`)
        await sleep(sec * 1_000)
        continue
      }
      if (r.status === 404) return null
      if (!r.ok) {
        if (attempt < retries) { await sleep(2_000 * attempt); continue }
        return null
      }
      return await r.text()
    } catch (e: any) {
      if (attempt < retries) await sleep(1_500 * attempt)
    }
  }
  return null
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function cikFromUrl(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/edgar\/data\/(\d+)\//i)
  return m ? m[1] : null
}

function nodash(acc: string): string { return acc.replace(/-/g, '') }

// Resolves the raw XML filename from EDGAR's index.json for a filing.
// Returns the filename (e.g. "0000950103-26-010417.xml") or null on failure.
async function findXmlFile(cik: string, accNodash: string): Promise<string | null> {
  const url  = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNodash}/index.json`
  const body = await edgarGet(url)
  if (!body) return null
  try {
    const items: { name: string }[] = JSON.parse(body)?.directory?.item ?? []
    const f = items.find(i =>
      i.name.toLowerCase().endsWith('.xml') &&
      !i.name.toLowerCase().includes('xsl')
    )
    return f?.name ?? null
  } catch { return null }
}

// Counts P and S nonDerivativeTransaction blocks in a Form 4 XML document.
function countPsInXml(xml: string): { P: number; S: number } {
  let P = 0, S = 0
  const blockRe = /<nonDerivativeTransaction\b[\s\S]*?<\/nonDerivativeTransaction>/gi
  let m: RegExpExecArray | null
  while ((m = blockRe.exec(xml)) !== null) {
    const codeM = m[0].match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/i)
    const code  = codeM?.[1]?.toUpperCase()
    if      (code === 'P') P++
    else if (code === 'S') S++
  }
  return { P, S }
}

function pct(n: number, total: number): string {
  return total === 0 ? '—' : `${(n / total * 100).toFixed(1)}%`
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AccInfo = {
  accession: string
  ticker:    string
  cik:       string
  filedDate: string
}

type ScanResult = {
  accession: string
  ticker:    string
  cik:       string
  filedDate: string
  xmlP:  number
  xmlS:  number
  dbP:   number
  dbS:   number
  xmlFile: string | null
  status: 'affected' | 'clean' | 'fetch_failed'
}

// ── DB helpers ────────────────────────────────────────────────────────────────

// Returns one representative row per accession_number for the given tickers.
// Uses offset pagination because Supabase doesn't support SELECT DISTINCT.
async function loadDistinctAccessions(targetTickers: string[] | null, maxN: number): Promise<AccInfo[]> {
  const PAGE = 1_000
  const seen = new Set<string>()
  const out:  AccInfo[] = []
  let   offset = 0

  while (out.length < maxN) {
    let q = sb
      .from('insider_transactions')
      .select('accession_number, ticker, source_url, filed_date')
      .in('transaction_code', ['P', 'S'])
      .not('source_url',        'is', null)
      .not('accession_number',  'is', null)
      .order('accession_number')
      .range(offset, offset + PAGE - 1)

    if (targetTickers) q = q.in('ticker', targetTickers)

    const { data, error } = await q
    if (error) { process.stderr.write(`DB error: ${error.message}\n`); break }
    if (!data || data.length === 0) break

    for (const r of data as any[]) {
      if (seen.has(r.accession_number)) continue
      seen.add(r.accession_number)
      const cik = cikFromUrl(r.source_url)
      if (!cik) continue
      out.push({
        accession: r.accession_number,
        ticker:    r.ticker,
        cik,
        filedDate: r.filed_date ?? '',
      })
      if (out.length >= maxN) break
    }

    if (data.length < PAGE) break
    offset += PAGE
  }

  return out
}

// Loads P/S row counts per accession in batches of 100 (one DB round-trip per batch).
async function loadDbCounts(accessions: string[]): Promise<Map<string, { P: number; S: number }>> {
  const map = new Map<string, { P: number; S: number }>()
  for (let i = 0; i < accessions.length; i += 100) {
    const batch = accessions.slice(i, i + 100)
    const { data, error } = await sb
      .from('insider_transactions')
      .select('accession_number, transaction_code')
      .in('accession_number', batch)
      .in('transaction_code', ['P', 'S'])
    if (error) { process.stderr.write(`DB count error: ${error.message}\n`); continue }
    for (const r of (data ?? []) as any[]) {
      const c = map.get(r.accession_number) ?? { P: 0, S: 0 }
      if (r.transaction_code === 'P') c.P++
      else c.S++
      map.set(r.accession_number, c)
    }
  }
  return map
}

// Loads ticker metadata (company name + HQ state) for use in processFiling.
async function loadTickerMeta(tickers: string[]): Promise<Map<string, { name: string | null; state: string | null }>> {
  const map  = new Map<string, { name: string | null; state: string | null }>()
  const uniq = [...new Set(tickers)]
  for (let i = 0; i < uniq.length; i += 200) {
    const { data } = await sb
      .from('tickers')
      .select('symbol, name, state')
      .in('symbol', uniq.slice(i, i + 200))
    for (const r of (data ?? []) as any[]) {
      map.set(r.symbol, { name: r.name ?? null, state: r.state ?? null })
    }
  }
  return map
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const line = '═'.repeat(64)
  const mode = DRY_RUN ? 'DRY-RUN (no writes)' : 'LIVE (will insert rows)'
  console.log(`\n${line}`)
  console.log(`TRANCHE BACKFILL — ${mode}`)
  console.log(line)

  const targetTickers: string[] | null =
    ONLY_TICKERS ? ONLY_TICKERS
    : ALL_MODE   ? null
    :              LARGE_CAPS

  const scope = ONLY_TICKERS
    ? `tickers: ${ONLY_TICKERS.join(', ')}`
    : ALL_MODE ? 'ALL tickers in DB'
    : `${LARGE_CAPS.length} large-cap tickers`

  console.log(`\nScope:  ${scope}`)
  console.log(`Limit:  ${isFinite(MAX_ACCESSIONS) ? MAX_ACCESSIONS + ' accessions' : 'no limit'}`)

  // ── Phase 1: Collect distinct accessions ─────────────────────────────────────

  process.stdout.write('\n[1/3] Loading distinct accessions from DB...\n')
  const allAccessions = await loadDistinctAccessions(targetTickers, MAX_ACCESSIONS)
  process.stdout.write(`      Found ${allAccessions.length} distinct accessions\n`)

  if (allAccessions.length === 0) {
    console.log('\nNo accessions found for given scope. Exiting.\n')
    return
  }

  // ── Phase 2: Load DB P/S counts per accession ────────────────────────────────

  process.stdout.write('\n[2/3] Loading DB P/S row counts (batched)...\n')
  const dbCounts = await loadDbCounts(allAccessions.map(a => a.accession))
  process.stdout.write(`      Loaded counts for ${dbCounts.size} accessions\n`)

  // Pre-fetch ticker metadata for processFiling (company name + HQ state)
  const uniqTickers = [...new Set(allAccessions.map(a => a.ticker))]
  const tikMeta = await loadTickerMeta(uniqTickers)

  // ── Phase 3: Scan each accession against EDGAR ────────────────────────────────

  const estMin = Math.ceil(allAccessions.length * 2 * DELAY_MS / 60_000)
  process.stdout.write(`\n[3/3] Scanning ${allAccessions.length} filings against EDGAR (~${estMin} min)...\n\n`)

  const scanResults: ScanResult[] = []
  let   fetchFailed = 0

  for (let i = 0; i < allAccessions.length; i++) {
    const info = allAccessions[i]
    const db   = dbCounts.get(info.accession) ?? { P: 0, S: 0 }

    process.stdout.write(
      `\r  ${String(i + 1).padStart(5)}/${allAccessions.length}  ` +
      `${info.ticker.padEnd(6)} ${info.accession}  db=${db.P + db.S}   `
    )

    const accNodash = nodash(info.accession)
    const xmlFile   = await findXmlFile(info.cik, accNodash)
    if (!xmlFile) {
      scanResults.push({ ...info, xmlP: 0, xmlS: 0, dbP: db.P, dbS: db.S, xmlFile: null, status: 'fetch_failed' })
      fetchFailed++
      continue
    }

    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${info.cik}/${accNodash}/${xmlFile}`
    const xml    = await edgarGet(xmlUrl)
    if (!xml) {
      scanResults.push({ ...info, xmlP: 0, xmlS: 0, dbP: db.P, dbS: db.S, xmlFile, status: 'fetch_failed' })
      fetchFailed++
      continue
    }

    const { P: xmlP, S: xmlS } = countPsInXml(xml)
    const affected = xmlP > db.P || xmlS > db.S
    scanResults.push({
      ...info, xmlP, xmlS, dbP: db.P, dbS: db.S, xmlFile,
      status: affected ? 'affected' : 'clean',
    })
  }
  process.stdout.write('\n')

  // ── Phase 4: Summarise scan ───────────────────────────────────────────────────

  const affected = scanResults.filter(r => r.status === 'affected')
  const clean    = scanResults.filter(r => r.status === 'clean')

  const totXmlP  = scanResults.filter(r => r.status !== 'fetch_failed').reduce((s, r) => s + r.xmlP, 0)
  const totXmlS  = scanResults.filter(r => r.status !== 'fetch_failed').reduce((s, r) => s + r.xmlS, 0)
  const totDbP   = scanResults.filter(r => r.status !== 'fetch_failed').reduce((s, r) => s + r.dbP,  0)
  const totDbS   = scanResults.filter(r => r.status !== 'fetch_failed').reduce((s, r) => s + r.dbS,  0)

  const missingP = Math.max(0, totXmlP - totDbP)
  const missingS = Math.max(0, totXmlS - totDbS)

  console.log(`\n${line}`)
  console.log('SCAN RESULTS')
  console.log(line)
  console.log(`\n  Accessions scanned:    ${scanResults.length}`)
  console.log(`  Clean (XML = DB):      ${clean.length}`)
  console.log(`  Affected (XML > DB):   ${affected.length}  (${pct(affected.length, scanResults.length)})`)
  console.log(`  Fetch failures:        ${fetchFailed}`)
  console.log(`\n  P (purchases):   XML=${totXmlP}  DB=${totDbP}  missing=${missingP}  (${pct(missingP, totXmlP)} loss)`)
  console.log(`  S (sells):       XML=${totXmlS}  DB=${totDbS}  missing=${missingS}  (${pct(missingS, totXmlS)} loss)`)

  if (affected.length > 0) {
    // Per-ticker summary for top affected tickers
    const byTicker = new Map<string, { filings: number; missingP: number; missingS: number }>()
    for (const r of affected) {
      const s = byTicker.get(r.ticker) ?? { filings: 0, missingP: 0, missingS: 0 }
      s.filings++
      s.missingP += Math.max(0, r.xmlP - r.dbP)
      s.missingS += Math.max(0, r.xmlS - r.dbS)
      byTicker.set(r.ticker, s)
    }
    const topTickers = [...byTicker.entries()]
      .sort((a, b) => (b[1].missingP + b[1].missingS) - (a[1].missingP + a[1].missingS))
      .slice(0, 20)

    console.log(`\n  TOP AFFECTED TICKERS (by missing rows in this scan):`)
    console.log(`  ${'Ticker'.padEnd(7)}  Filings  Miss-P  Miss-S`)
    for (const [ticker, s] of topTickers) {
      console.log(
        `  ${ticker.padEnd(7)}  ${String(s.filings).padEnd(7)}  ${String(s.missingP).padEnd(6)}  ${s.missingS}`
      )
    }

    // Show the worst individual filings
    const worst = [...affected]
      .sort((a, b) => {
        const gapA = (a.xmlP - a.dbP) + (a.xmlS - a.dbS)
        const gapB = (b.xmlP - b.dbP) + (b.xmlS - b.dbS)
        return gapB - gapA
      })
      .slice(0, 15)

    console.log(`\n  WORST INDIVIDUAL FILINGS:`)
    console.log(`  ${'Ticker'.padEnd(7)}  ${'Accession'.padEnd(22)}  XML-P→DB-P  XML-S→DB-S  Missing`)
    for (const r of worst) {
      const missing = (r.xmlP - r.dbP) + (r.xmlS - r.dbS)
      console.log(
        `  ${r.ticker.padEnd(7)}  ${r.accession.padEnd(22)}  ` +
        `${r.xmlP}→${r.dbP}        ${r.xmlS}→${r.dbS}        ${missing}`
      )
    }
  }

  if (DRY_RUN) {
    console.log(`\n${line}`)
    console.log('DRY-RUN COMPLETE — no rows written.')
    console.log(`\nTo run the backfill:`)
    console.log(`  npx tsx scripts/backfill-tranches.ts${ONLY_TICKERS ? ' --tickers ' + ONLY_TICKERS.join(',') : ''}${ALL_MODE ? ' --all' : ''}`)
    const estBackfillMin = Math.ceil(affected.length * 4 * DELAY_MS / 60_000)
    console.log(`\nEstimated backfill time: ~${estBackfillMin} min (${affected.length} affected filings × 4 EDGAR requests each)`)
    console.log(`Estimated rows to recover: ~${missingP + missingS} (P: ${missingP}, S: ${missingS})`)
    console.log()
    return
  }

  // ── Phase 5: Backfill affected filings ────────────────────────────────────────

  if (affected.length === 0) {
    console.log('\nNo affected filings found. Nothing to backfill.\n')
    return
  }

  const estBackfillMin = Math.ceil(affected.length * 4 * DELAY_MS / 60_000)
  console.log(`\n${line}`)
  console.log(`BACKFILLING ${affected.length} AFFECTED FILINGS (~${estBackfillMin} min)`)
  console.log(line)
  console.log()

  let totalInserted = 0
  let totalFailed   = 0

  for (let i = 0; i < affected.length; i++) {
    const r    = affected[i]
    const meta = tikMeta.get(r.ticker)

    process.stdout.write(
      `\r  ${String(i + 1).padStart(4)}/${affected.length}  ${r.ticker.padEnd(6)} ${r.accession}  ` +
      `expect +${(r.xmlP - r.dbP) + (r.xmlS - r.dbS)} rows   `
    )

    try {
      // Pass xmlFile as primaryDoc so processFiling skips the index.json lookup
      // (it already knows the filename from our scan above)
      const { inserted } = await processFiling(
        r.ticker,
        parseInt(r.cik, 10),
        r.accession,
        r.xmlFile,
        r.filedDate,
        meta?.state     ?? null,
        meta?.name      ?? null,
        sb,
      )
      totalInserted += inserted
      process.stdout.write(`→ inserted ${inserted}`)
    } catch (e: any) {
      process.stderr.write(`\n  ERROR ${r.ticker} ${r.accession}: ${e.message}\n`)
      totalFailed++
    }
  }

  process.stdout.write('\n')

  // ── Final summary ─────────────────────────────────────────────────────────────

  console.log(`\n${line}`)
  console.log('BACKFILL COMPLETE')
  console.log(line)
  console.log(`\n  Filings processed:  ${affected.length - totalFailed}`)
  console.log(`  Rows inserted:      ${totalInserted}`)
  console.log(`  Failures:           ${totalFailed}`)

  if (totalInserted < missingP + missingS) {
    const stillMissing = (missingP + missingS) - totalInserted
    console.log(`\n  NOTE: inserted ${totalInserted} but scan expected ~${missingP + missingS}.`)
    console.log(`  ~${stillMissing} rows may have been skipped by the dedup check (already existed)`)
    console.log(`  or rejected by the DB constraint. Re-running will confirm.`)
  }

  if (totalFailed > 0) {
    console.log(`\n  ${totalFailed} filings failed — re-run to retry (script is idempotent).`)
  }

  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
