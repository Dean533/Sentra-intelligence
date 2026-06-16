// Run with:  npx tsx scripts/backfill-new-tickers.ts
//
// Backfills 3 years of Form 4 insider history for the 500 net-new tickers
// in scripts/new_tickers_seed.csv, using the same logic as the current
// production ingest route (app/api/insider/ingest/route.ts).
//
// IMPORTANT: The XML parsing / processFiling / dedup functions below are copied
// verbatim from app/api/insider/ingest/route.ts (as of 2026-06-16).
// If you change those functions in the route, update them here too.
// Key properties of the current version (DO NOT REGRESS):
//   ✓ xsl-path strip fix  — strips "xslXXX/" prefix before fetching XML
//   ✓ no transaction_code filter — stores all codes (P, S, A, M, F, G, ...)
//   ✓ no $100k value floor — stores all trade sizes
//   ✓ future-date guard   — rejects transactionDate > 7 days from now
//   ✓ dedup on (ticker, insider_cik, transaction_date, shares, direction)

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Config ───────────────────────────────────────────────────────────────────

const CUTOFF_DATE     = '2023-06-16'   // 3 years back
const PROGRESS_PATH   = path.join(__dirname, '..', 'output', 'new-tickers-backfill-progress.json')
const SEC_HEADERS     = { 'User-Agent': 'Sentra contact@sentra.com', Accept: 'application/json, text/xml, */*' }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function padCik(cik: string | number) { return String(cik).padStart(10, '0') }

// ─── XML helpers — verbatim from ingest/route.ts ──────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function directVal(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*([^<]+?)\\s*<\\/${tag}>`, 'i'))
  return m?.[1] ? decodeEntities(m[1].trim()) : null
}

function nestedVal(xml: string, outer: string): string | null {
  const block = xml.match(new RegExp(`<${outer}[^>]*>([\\s\\S]*?)<\\/${outer}>`, 'i'))
  if (!block) return null
  return directVal(block[1], 'value')
}

function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
  return xml.match(re) ?? []
}

// ─── detectPlanSale — verbatim from ingest/route.ts ──────────────────────────

function detectPlanSale(block: string, xml: string, code: string): boolean {
  const planNameDirect = directVal(block, 'planName')
  const planNameNested = nestedVal(block, 'transactionPlanName')
  if ((planNameDirect && planNameDirect.trim().length > 0) ||
      (planNameNested && planNameNested.trim().length > 0)) {
    return true
  }
  if (code === 'S') {
    const footnoteIdRe = /footnoteId[^>]*\sid="([^"]+)"/gi
    let match: RegExpExecArray | null
    while ((match = footnoteIdRe.exec(block)) !== null) {
      const fid = match[1]
      const footnoteRe = new RegExp(`<footnote[^>]*\\sid="${fid}"[^>]*>([\\s\\S]*?)<\\/footnote>`, 'i')
      const fn = xml.match(footnoteRe)
      if (fn && fn[1].toLowerCase().includes('10b5-1')) return true
    }
  }
  return false
}

// ─── parseForm4 — verbatim from ingest/route.ts ───────────────────────────────
// NO code filter (stores all codes), NO value floor, only skips missing dateStr.

type ParsedTx = {
  insiderName: string; insiderCik: string | null; insiderState: string | null
  isDirector: boolean; isOfficer: boolean; officerTitle: string | null; role: string
  transactionDate: string; transactionCode: string; transactionDirection: string
  shares: number; pricePerShare: number; totalValue: number
  sharesOwnedAfter: number | null; isPlanSale: boolean
}

function parseForm4(xml: string): ParsedTx[] {
  const insiderName  = directVal(xml, 'rptOwnerName') ?? 'Unknown'
  const insiderCik   = directVal(xml, 'rptOwnerCik') ?? null
  const insiderState = directVal(xml, 'rptOwnerState') ?? null
  const isDirector   = directVal(xml, 'isDirector') === '1'
  const isOfficer    = directVal(xml, 'isOfficer') === '1'
  const officerTitle = directVal(xml, 'officerTitle')
  const is10Pct      = directVal(xml, 'isTenPercentOwner') === '1'
  const role = officerTitle ?? (isDirector ? 'Director' : null) ?? (is10Pct ? '10% Owner' : null) ?? 'Insider'

  const txBlocks = allBlocks(xml, 'nonDerivativeTransaction')
  const results: ParsedTx[] = []

  for (const block of txBlocks) {
    const code = directVal(block, 'transactionCode')
    if (!code) continue                                       // only skip blank code

    const dateStr        = nestedVal(block, 'transactionDate')
    const sharesStr      = nestedVal(block, 'transactionShares')
    const priceStr       = nestedVal(block, 'transactionPricePerShare')
    const sharesAfterStr = nestedVal(block, 'sharesOwnedFollowingTransaction')

    const shares = sharesStr ? parseFloat(sharesStr) : 0
    const price  = priceStr  ? parseFloat(priceStr)  : 0

    if (!dateStr) continue                                    // only skip missing date

    results.push({
      insiderName, insiderCik, insiderState, isDirector, isOfficer, officerTitle, role,
      transactionDate:      dateStr,
      transactionCode:      code,
      transactionDirection: code === 'P' ? 'buy' : 'sell',
      shares,
      pricePerShare:  price,
      totalValue:     Math.round(shares * price * 100) / 100,
      sharesOwnedAfter: sharesAfterStr ? parseFloat(sharesAfterStr) : null,
      isPlanSale: detectPlanSale(block, xml, code),
    })
  }

  return results
}

// ─── findRawXmlUrl — verbatim from ingest/route.ts ───────────────────────────

async function findRawXmlUrl(cikInt: number, adshClean: string): Promise<string | null> {
  const res = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/index.json`,
    { headers: SEC_HEADERS }
  )
  if (!res.ok) return null
  const items: { name: string }[] = (await res.json())?.directory?.item ?? []
  const f = items.find(i => i.name.toLowerCase().endsWith('.xml') && !i.name.toLowerCase().includes('xsl'))
  return f ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${f.name}` : null
}

// ─── processFiling — verbatim from ingest/route.ts ───────────────────────────
// Includes: xsl-path strip, future-date guard, dedup, insert + events upsert.

async function processFiling(
  ticker: string, cikInt: number, adsh: string,
  primaryDoc: string | null, filedDate: string, hqState: string | null = null
): Promise<{ inserted: number; skipped: number }> {
  const adshClean = adsh.replace(/-/g, '')
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${adsh}-index.htm`

  // xsl-path strip fix: primaryDoc may be "xslF345X06/filename.xml" — strip to get raw XML
  const cleanDoc   = primaryDoc?.replace(/^xsl[^/]+\//i, '') ?? null
  const isHtmlDoc  = cleanDoc && /\.html?$/i.test(cleanDoc)

  let xmlUrl: string | null
  if (isHtmlDoc || !cleanDoc) {
    xmlUrl = await findRawXmlUrl(cikInt, adshClean)
  } else {
    xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${cleanDoc}`
  }

  if (!xmlUrl) return { inserted: 0, skipped: 1 }

  await sleep(20)

  const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
  if (!xmlRes.ok) return { inserted: 0, skipped: 1 }

  const xml = await xmlRes.text()
  if (!xml.includes('<ownershipDocument') && !xml.includes('<rptOwnerName')) {
    return { inserted: 0, skipped: 1 }
  }

  const transactions = parseForm4(xml)
  if (transactions.length === 0) return { inserted: 0, skipped: 1 }

  let inserted = 0
  const cutoffMs = Date.now() + 7 * 24 * 60 * 60 * 1000

  for (const tx of transactions) {
    if (new Date(tx.transactionDate).getTime() > cutoffMs) continue  // future-date guard

    // Dedup: amended filings have new accession numbers but same underlying trade
    if (tx.insiderCik) {
      const { data: existing } = await supabase
        .from('insider_transactions')
        .select('id')
        .eq('ticker',                ticker)
        .eq('insider_cik',           tx.insiderCik)
        .eq('transaction_date',      tx.transactionDate)
        .eq('shares',                tx.shares)
        .eq('transaction_direction', tx.transactionDirection)
        .limit(1)
        .maybeSingle()

      if (existing) continue
    }

    const payload = {
      ticker,
      insider_name:          tx.insiderName,
      insider_cik:           tx.insiderCik,
      role:                  tx.role,
      is_director:           tx.isDirector,
      is_officer:            tx.isOfficer,
      officer_title:         tx.officerTitle,
      transaction_date:      tx.transactionDate,
      transaction_code:      tx.transactionCode,
      transaction_direction: tx.transactionDirection,
      shares:                tx.shares,
      price_per_share:       tx.pricePerShare,
      total_value:           tx.totalValue,
      shares_owned_after:    tx.sharesOwnedAfter,
      is_plan_sale:          tx.isPlanSale,
      is_local:              tx.insiderState !== null && hqState !== null && tx.insiderState === hqState,
      accession_number:      adsh,
      filed_date:            filedDate,
      source_url:            sourceUrl,
    }

    const { error: insertErr } = await supabase.from('insider_transactions').insert([payload])
    if (insertErr) continue

    if (tx.isPlanSale) { inserted++; continue }

    const verb = tx.transactionDirection === 'sell' ? 'sold' : 'purchased'
    await supabase.from('events').upsert({
      ticker,
      event_type:   'insider',
      title:        `${tx.insiderName} ${verb} ${tx.shares.toLocaleString()} shares of ${ticker}`,
      summary:      `${tx.role} · ${verb} ${tx.shares.toLocaleString()} shares @ $${tx.pricePerShare.toFixed(2)} · Total $${(tx.totalValue / 1000).toFixed(0)}K`,
      source_url:   sourceUrl,
      published_at: tx.transactionDate,
      event_date:   tx.transactionDate,
      raw_text:     JSON.stringify({
        form: '4', insiderName: tx.insiderName, insiderCik: tx.insiderCik,
        role: tx.role, transactionCode: tx.transactionCode,
        transactionDirection: tx.transactionDirection,
        shares: tx.shares, price: tx.pricePerShare, totalValue: tx.totalValue, adsh,
      }),
    }, { onConflict: 'ticker,source_url', ignoreDuplicates: true })

    inserted++
  }

  return { inserted, skipped: inserted === 0 ? 1 : 0 }
}

// ─── Per-ticker backfill via submissions JSON ─────────────────────────────────
// Uses data.sec.gov/submissions/CIKxxx.json — same approach as ingest route.
// Reads primaryDocument from submissions JSON (ingestTickerInsiders passes null;
// this version passes it so processFiling can skip the extra index.json fetch).

async function backfillTicker(
  ticker: string, cikStr: string, cutoffDate: string, hqState: string | null
): Promise<{ inserted: number; skipped: number; filings: number }> {
  await sleep(150)  // rate limit: ~10 req/sec to SEC
  const subRes = await fetch(
    `https://data.sec.gov/submissions/CIK${padCik(cikStr)}.json`,
    { headers: SEC_HEADERS }
  )
  if (!subRes.ok) throw new Error(`submissions fetch ${subRes.status} for ${ticker}`)

  const sub    = await subRes.json()
  const recent = sub.filings?.recent
  if (!recent) return { inserted: 0, skipped: 0, filings: 0 }

  const forms:    string[] = recent.form            ?? []
  const dates:    string[] = recent.filingDate      ?? []
  const adshList: string[] = recent.accessionNumber ?? []
  const docs:     string[] = recent.primaryDocument ?? []

  let inserted = 0
  let skipped  = 0
  let filings  = 0

  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '4') continue
    if (dates[i] < cutoffDate) break  // sorted descending — nothing older will match

    const adsh = adshList[i]
    if (!adsh) { skipped++; continue }

    filings++
    await sleep(150)  // rate limit between XML fetches

    const result = await processFiling(
      ticker, parseInt(cikStr, 10), adsh,
      docs[i] ?? null,   // pass primaryDoc so xsl-strip runs before any index.json fetch
      dates[i], hqState
    )
    inserted += result.inserted
    skipped  += result.skipped
  }

  return { inserted, skipped, filings }
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = '', inQuote = false
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote }
    else if (ch === ',' && !inQuote) { fields.push(cur.trim()); cur = '' }
    else { cur += ch }
  }
  fields.push(cur.trim())
  return fields
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Backfill new tickers: ${CUTOFF_DATE} → today`)

  // 1. Load progress file (resume support)
  let completed: Set<string>
  if (fs.existsSync(PROGRESS_PATH)) {
    const saved = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8')) as string[]
    completed = new Set(saved)
    console.log(`Resuming — ${completed.size} already done`)
  } else {
    completed = new Set()
    console.log('Starting fresh')
  }

  // 2. Read new_tickers_seed.csv
  const csvPath  = path.join(__dirname, 'new_tickers_seed.csv')
  const csvLines = fs.readFileSync(csvPath, 'utf-8').split('\n')
  const [header, ...rows] = csvLines
  const hdrs      = parseCsvLine(header)
  const colSymbol = hdrs.indexOf('symbol')
  const colSector = hdrs.indexOf('sector')

  const tickers: { symbol: string; sector: string }[] = []
  for (const line of rows) {
    const t = line.trim()
    if (!t) continue
    const f = parseCsvLine(t)
    tickers.push({ symbol: f[colSymbol] ?? '', sector: f[colSector] ?? '' })
  }
  console.log(`${tickers.length} tickers to backfill\n`)

  // 3. Fetch SEC CIK map
  console.log('Fetching SEC company_tickers.json...')
  const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikRes.ok) { console.error('Failed to fetch CIK map:', cikRes.status); process.exit(1) }
  const cikRaw: Record<string, { cik_str: string; ticker: string }> = await cikRes.json()
  const tickerToCik: Record<string, string> = {}
  for (const entry of Object.values(cikRaw)) tickerToCik[entry.ticker] = entry.cik_str
  console.log(`CIK map loaded (${Object.keys(tickerToCik).length} entries)\n`)

  // 4. Process each ticker
  let totalInserted = 0
  let totalSkipped  = 0
  let totalFilings  = 0
  let noCik         = 0
  let failed        = 0

  for (let i = 0; i < tickers.length; i++) {
    const { symbol, sector } = tickers[i]
    const label = `[${i + 1}/${tickers.length}] ${symbol.padEnd(8)}`

    if (completed.has(symbol)) {
      console.log(`${label} already done, skipping`)
      continue
    }

    const cikStr = tickerToCik[symbol]
    if (!cikStr) {
      console.log(`${label} no CIK in SEC map — foreign issuer or delisted, skipping`)
      noCik++
      completed.add(symbol)
      saveProgress(completed)
      continue
    }

    try {
      const { inserted, skipped, filings } = await backfillTicker(symbol, cikStr, CUTOFF_DATE, null)
      totalInserted += inserted
      totalSkipped  += skipped
      totalFilings  += filings
      console.log(`${label} ${filings} filings → ${inserted} inserted, ${skipped} skipped`)
    } catch (err: any) {
      console.log(`${label} ERROR: ${err.message}`)
      failed++
      // Don't mark complete — will retry on next run
      continue
    }

    completed.add(symbol)
    saveProgress(completed)
  }

  console.log('\n' + '─'.repeat(52))
  console.log(`Filings processed : ${totalFilings}`)
  console.log(`Rows inserted     : ${totalInserted}`)
  console.log(`Rows skipped/dedup: ${totalSkipped}`)
  console.log(`No CIK (foreign)  : ${noCik}`)
  console.log(`Errors (retryable): ${failed}`)
  console.log('Done.')
}

function saveProgress(completed: Set<string>) {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true })
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify([...completed], null, 2), 'utf-8')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
