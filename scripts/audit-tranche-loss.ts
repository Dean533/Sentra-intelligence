// scripts/audit-tranche-loss.ts
//
// Quantifies how many Form 4 P/S transactions are missing from insider_transactions
// due to the unique-constraint tranche collapse bug.
//
// For each sampled accession_number, fetches the original Form 4 XML from EDGAR
// and compares its P/S transaction count to the rows in the DB.
//
// READ-ONLY — does not modify any data.
//
// Usage:
//   npx tsx scripts/audit-tranche-loss.ts            # sample 200 filings (~7 min)
//   npx tsx scripts/audit-tranche-loss.ts --n 400    # larger sample (~14 min)

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

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const args    = process.argv.slice(2)
const flagN   = args.indexOf('--n')
const TOTAL_N = flagN >= 0 ? parseInt(args[flagN + 1], 10) : 200

// SEC requires User-Agent with identity
const EDGAR_UA  = 'SentraSignals tranche-loss audit deangans815@gmail.com'
const DELAY_MS  = 120   // ≈8 req/s (limit is 10/s)
let   lastFetch = 0

// Tickers most likely to have 10b5-1 plan sales with multiple tranches
const LARGE_CAPS = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA', 'JPM', 'V',
  'XOM',  'UNH',  'JNJ',  'PG',   'MA',   'AVGO',  'HD',   'COST', 'MRK', 'ABBV',
  'LLY',  'CVX',  'WMT',  'AMD',  'ORCL', 'ACN',   'TMO',  'ADBE', 'NFLX','CRM',
  'AMGN', 'TXN',  'QCOM', 'NEE',  'RTX',  'HON',   'LOW',  'IBM',  'AMAT','INTC',
]

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function cikFromUrl(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/edgar\/data\/(\d+)\//i)
  return m ? m[1] : null
}

function nodash(acc: string): string { return acc.replace(/-/g, '') }

function pct(n: number, total: number): string {
  return total === 0 ? '—' : `${(n / total * 100).toFixed(1)}%`
}

// ── Types ─────────────────────────────────────────────────────────────────────

type AccInfo = { accession: string; ticker: string; cik: string }

type CodeCounts = { P: number; S: number; other: number }

type FilingResult = {
  accession: string
  ticker:    string
  status:    'ok' | 'fetch_failed'
  xml:  CodeCounts
  db:   CodeCounts
}

// ── EDGAR helpers ─────────────────────────────────────────────────────────────

async function findXmlFilename(cik: string, accNodash: string): Promise<string | null> {
  const url  = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNodash}/index.json`
  const body = await edgarGet(url)
  if (!body) return null
  try {
    const items: { name: string }[] = JSON.parse(body)?.directory?.item ?? []
    const f = items.find(i => i.name.toLowerCase().endsWith('.xml') && !i.name.toLowerCase().includes('xsl'))
    return f?.name ?? null
  } catch { return null }
}

function countCodedTxInXml(xml: string): CodeCounts {
  const counts: CodeCounts = { P: 0, S: 0, other: 0 }
  // Iterate every nonDerivativeTransaction block
  const blockRe = /<nonDerivativeTransaction\b[\s\S]*?<\/nonDerivativeTransaction>/gi
  let   m: RegExpExecArray | null
  while ((m = blockRe.exec(xml)) !== null) {
    // transactionCode is a direct child of transactionCoding, not wrapped in <value>
    const codeM = m[0].match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/i)
    const code  = codeM ? codeM[1].toUpperCase() : null
    if      (code === 'P') counts.P++
    else if (code === 'S') counts.S++
    else                   counts.other++
  }
  return counts
}

async function auditOne(info: AccInfo, dbCodes: string[]): Promise<FilingResult> {
  const db: CodeCounts = { P: 0, S: 0, other: 0 }
  for (const c of dbCodes) {
    if      (c === 'P') db.P++
    else if (c === 'S') db.S++
    else                db.other++
  }

  const accNodash = nodash(info.accession)
  const xmlFile   = await findXmlFilename(info.cik, accNodash)
  if (!xmlFile) return { accession: info.accession, ticker: info.ticker, status: 'fetch_failed', xml: { P: 0, S: 0, other: 0 }, db }

  const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${info.cik}/${accNodash}/${xmlFile}`
  const xml    = await edgarGet(xmlUrl)
  if (!xml)    return { accession: info.accession, ticker: info.ticker, status: 'fetch_failed', xml: { P: 0, S: 0, other: 0 }, db }

  return { accession: info.accession, ticker: info.ticker, status: 'ok', xml: countCodedTxInXml(xml), db }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const line = '═'.repeat(62)
  console.log(`\n${line}`)
  console.log('TRANCHE LOSS AUDIT — target ' + TOTAL_N + ' filings')
  console.log(line)

  // ── Step 1: Build accession pool ─────────────────────────────────────────────

  process.stdout.write('\n[1/3] Pulling accession pool from DB...\n')

  // Large-cap pool — fetch all accessions for priority tickers
  const lcSeen  = new Set<string>()
  const lcPool: AccInfo[] = []
  for (const ticker of LARGE_CAPS) {
    const { data } = await sb
      .from('insider_transactions')
      .select('accession_number, ticker, source_url')
      .eq('ticker', ticker)
      .in('transaction_code', ['P', 'S'])
      .not('source_url', 'is', null)
      .not('accession_number', 'is', null)
      .limit(500)
    for (const r of (data ?? []) as any[]) {
      if (lcSeen.has(r.accession_number)) continue
      lcSeen.add(r.accession_number)
      const cik = cikFromUrl(r.source_url)
      if (cik) lcPool.push({ accession: r.accession_number, ticker: r.ticker, cik })
    }
  }
  process.stdout.write(`  Large-cap pool: ${lcPool.length} distinct accessions (${LARGE_CAPS.length} tickers)\n`)

  // General random-ish pool — Postgres heap order without explicit ORDER BY
  // gives varied distribution across different insert times
  const { data: genData } = await sb
    .from('insider_transactions')
    .select('accession_number, ticker, source_url')
    .in('transaction_code', ['P', 'S'])
    .not('source_url', 'is', null)
    .not('accession_number', 'is', null)
    .limit(3_000)

  const genSeen = new Set<string>(lcSeen)
  const genPool: AccInfo[] = []
  for (const r of (genData ?? []) as any[]) {
    if (genSeen.has(r.accession_number)) continue
    genSeen.add(r.accession_number)
    const cik = cikFromUrl(r.source_url)
    if (cik) genPool.push({ accession: r.accession_number, ticker: r.ticker, cik })
  }
  process.stdout.write(`  General pool:   ${genPool.length} distinct accessions\n`)

  // Build final sample: up to TOTAL_N/2 large-cap + fill from general
  const lcSample  = lcPool.slice(0, Math.ceil(TOTAL_N / 2))
  const genSample = genPool.slice(0, TOTAL_N - lcSample.length)
  const sample    = [...lcSample, ...genSample]
  process.stdout.write(`  Sample:         ${lcSample.length} large-cap + ${genSample.length} general = ${sample.length}\n`)

  // ── Step 2: Load all DB rows for sampled accessions in batches ────────────────

  process.stdout.write('\n[2/3] Loading DB rows for sampled accessions...\n')

  const dbCodeMap = new Map<string, string[]>()   // accession → [transaction_code, ...]
  const accNums   = sample.map(a => a.accession)

  for (let i = 0; i < accNums.length; i += 100) {
    const batch = accNums.slice(i, i + 100)
    const { data, error } = await sb
      .from('insider_transactions')
      .select('accession_number, transaction_code')
      .in('accession_number', batch)
    if (error) { process.stderr.write(`  DB error: ${error.message}\n`); continue }
    for (const r of (data ?? []) as any[]) {
      if (!dbCodeMap.has(r.accession_number)) dbCodeMap.set(r.accession_number, [])
      dbCodeMap.get(r.accession_number)!.push(r.transaction_code)
    }
  }
  process.stdout.write(`  Loaded rows for ${dbCodeMap.size} / ${sample.length} accessions\n`)

  // ── Step 3: Check each filing against EDGAR ───────────────────────────────────

  process.stdout.write('\n[3/3] Fetching EDGAR filings (2 requests/filing)...\n\n')

  const results: FilingResult[] = []
  let   fetchFailed = 0

  for (let i = 0; i < sample.length; i++) {
    const info   = sample[i]
    const codes  = dbCodeMap.get(info.accession) ?? []
    const status = `${i + 1}/${sample.length}`.padEnd(9)
    const psMismatch = (() => {
      // Quick preview for the progress line
      const dbPS = codes.filter(c => c === 'P' || c === 'S').length
      return dbPS === 0 ? '?' : `db=${dbPS}`
    })()
    process.stdout.write(`\r  ${status} ${info.ticker.padEnd(7)} ${info.accession}  ${psMismatch}   `)

    const result = await auditOne(info, codes)
    results.push(result)
    if (result.status === 'fetch_failed') fetchFailed++
  }
  process.stdout.write('\n')

  // ── Step 4: Report ────────────────────────────────────────────────────────────

  const good = results.filter(r => r.status === 'ok')

  // Aggregate XML vs DB counts across all successfully audited filings
  let xmlP = 0, xmlS = 0, xmlOther = 0
  let dbP  = 0, dbS  = 0, dbOther  = 0
  for (const r of good) {
    xmlP += r.xml.P; xmlS += r.xml.S; xmlOther += r.xml.other
    dbP  += r.db.P;  dbS  += r.db.S;  dbOther  += r.db.other
  }

  const missingP   = good.filter(r => r.xml.P > r.db.P)
  const missingS   = good.filter(r => r.xml.S > r.db.S)
  const missingAny = good.filter(r => r.xml.P > r.db.P || r.xml.S > r.db.S)

  const lossRateP = xmlP > 0 ? (xmlP - dbP) / xmlP : 0
  const lossRateS = xmlS > 0 ? (xmlS - dbS) / xmlS : 0

  // Get total table row counts for extrapolation
  const [{ count: totDbP }, { count: totDbS }] = await Promise.all([
    sb.from('insider_transactions').select('id', { count: 'exact', head: true }).eq('transaction_code', 'P'),
    sb.from('insider_transactions').select('id', { count: 'exact', head: true }).eq('transaction_code', 'S'),
  ])

  // Estimated missing = existing_rows × lossRate / (1 - lossRate)
  // (if 20% of XML txs are missing, for every 4 DB rows there's 1 missing → missing = DB × 0.25)
  const estMissingP = (totDbP && lossRateP > 0) ? Math.round(totDbP * lossRateP / (1 - lossRateP)) : 0
  const estMissingS = (totDbS && lossRateS > 0) ? Math.round(totDbS * lossRateS / (1 - lossRateS)) : 0

  console.log(`\n\n${line}`)
  console.log('RESULTS')
  console.log(line)

  console.log(`\nSAMPLE OVERVIEW`)
  console.log(`  Filings sampled:             ${sample.length}`)
  console.log(`  Successfully audited:        ${good.length}`)
  console.log(`  EDGAR fetch failures:        ${fetchFailed}`)
  console.log(`  Filings with any loss:       ${missingAny.length} / ${good.length}  (${pct(missingAny.length, good.length)})`)

  console.log(`\nBREAKDOWN BY TRANSACTION CODE`)
  console.log(`  P — OPEN-MARKET PURCHASES  (drives conviction scoring)`)
  console.log(`    XML transactions:  ${xmlP}`)
  console.log(`    DB rows:           ${dbP}`)
  console.log(`    Missing:           ${xmlP - dbP}  (${pct(xmlP - dbP, xmlP)} loss rate)`)
  console.log(`    Filings affected:  ${missingP.length} / ${good.length}`)
  console.log(`  S — OPEN-MARKET SELLS`)
  console.log(`    XML transactions:  ${xmlS}`)
  console.log(`    DB rows:           ${dbS}`)
  console.log(`    Missing:           ${xmlS - dbS}  (${pct(xmlS - dbS, xmlS)} loss rate)`)
  console.log(`    Filings affected:  ${missingS.length} / ${good.length}`)
  if (xmlOther > 0 || dbOther > 0) {
    console.log(`  Other codes (G/M/J/etc.)`)
    console.log(`    XML transactions:  ${xmlOther}`)
    console.log(`    DB rows:           ${dbOther}`)
    console.log(`    Missing:           ${xmlOther - dbOther}  (${pct(xmlOther - dbOther, xmlOther)} loss rate)`)
  }

  console.log(`\nEXTRAPOLATION TO FULL TABLE`)
  console.log(`  DB total P rows (current):   ${(totDbP ?? 0).toLocaleString()}`)
  console.log(`  Estimated missing P rows:    ${estMissingP.toLocaleString()}  (${pct(estMissingP, (totDbP ?? 0) + estMissingP)} of true total)`)
  console.log(`  DB total S rows (current):   ${(totDbS ?? 0).toLocaleString()}`)
  console.log(`  Estimated missing S rows:    ${estMissingS.toLocaleString()}  (${pct(estMissingS, (totDbS ?? 0) + estMissingS)} of true total)`)
  console.log(`  Total estimated missing:     ${(estMissingP + estMissingS).toLocaleString()}`)

  const verdict = lossRateP < 0.03
    ? '  VERDICT: P (purchase) loss is minimal — conviction signal is largely intact.'
    : lossRateP < 0.10
    ? '  VERDICT: P (purchase) loss is moderate — some conviction signals may be understated.'
    : '  VERDICT: P (purchase) loss is high — conviction signal is materially affected.'
  console.log(`\n${verdict}`)

  // Top 20 worst filings
  const worst = [...good]
    .filter(r => r.xml.P + r.xml.S > r.db.P + r.db.S)
    .sort((a, b) => {
      const gapA = (a.xml.P - a.db.P) + (a.xml.S - a.db.S)
      const gapB = (b.xml.P - b.db.P) + (b.xml.S - b.db.S)
      return gapB - gapA
    })
    .slice(0, 20)

  if (worst.length > 0) {
    console.log(`\nWORST FILINGS (by missing P/S rows)`)
    console.log(`  ${'Ticker'.padEnd(7)}  ${'Accession'.padEnd(22)}  XML-PS  DB-PS  Miss  (P: xml→db, S: xml→db)`)
    for (const r of worst) {
      const xmlPS = r.xml.P + r.xml.S
      const dbPS  = r.db.P  + r.db.S
      const miss  = xmlPS - dbPS
      console.log(
        `  ${r.ticker.padEnd(7)}  ${r.accession.padEnd(22)}  ${String(xmlPS).padEnd(6)}  ${String(dbPS).padEnd(5)}  ${String(miss).padEnd(4)}` +
        `  (P: ${r.xml.P}→${r.db.P}, S: ${r.xml.S}→${r.db.S})`
      )
    }
  }

  // Per-ticker summary
  const tickerMap = new Map<string, { total: number; withLoss: number; missingP: number; missingS: number }>()
  for (const r of good) {
    const s = tickerMap.get(r.ticker) ?? { total: 0, withLoss: 0, missingP: 0, missingS: 0 }
    s.total++
    if (r.xml.P > r.db.P || r.xml.S > r.db.S) s.withLoss++
    s.missingP += Math.max(0, r.xml.P - r.db.P)
    s.missingS += Math.max(0, r.xml.S - r.db.S)
    tickerMap.set(r.ticker, s)
  }

  const worstTickers = [...tickerMap.entries()]
    .filter(([, s]) => s.withLoss > 0)
    .sort((a, b) => (b[1].missingP + b[1].missingS) - (a[1].missingP + a[1].missingS))
    .slice(0, 20)

  if (worstTickers.length > 0) {
    console.log(`\nTICKERS WITH MOST MISSING P/S ROWS (sampled)`)
    console.log(`  ${'Ticker'.padEnd(7)}  Filings w/ loss  Missing-P  Missing-S`)
    for (const [ticker, s] of worstTickers) {
      console.log(
        `  ${ticker.padEnd(7)}  ${String(s.withLoss).padEnd(5)} / ${String(s.total).padEnd(3)} (${pct(s.withLoss, s.total).padEnd(6)})` +
        `  ${String(s.missingP).padEnd(9)}  ${s.missingS}`
      )
    }
  }

  console.log(`\n${line}\n`)
  console.log(`NOTE: This script only audits nonDerivativeTransaction rows (open-market buys/sells).`)
  console.log(`      Derivative transactions (options, warrants) are not counted by the ingest`)
  console.log(`      pipeline and are not included here.`)
  console.log(`\nNext steps:`)
  console.log(`  1. Confirm the DB unique constraint:  SELECT indexname, indexdef FROM pg_indexes`)
  console.log(`                                        WHERE tablename = 'insider_transactions'`)
  console.log(`                                          AND indexdef ILIKE '%unique%';`)
  console.log(`  2. Drop the narrow constraint and add one that includes shares/price.`)
  console.log(`  3. Re-ingest affected accession_numbers to backfill missing tranches.`)
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
