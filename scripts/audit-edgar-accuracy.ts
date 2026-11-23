// scripts/audit-edgar-accuracy.ts
//
// Cross-checks insider_transactions against live SEC EDGAR Form 4 filings.
// READ-ONLY — this script never modifies any data.
//
// Usage:
//   npx tsx scripts/audit-edgar-accuracy.ts              # 150-row default sample
//   npx tsx scripts/audit-edgar-accuracy.ts --n 400      # larger sample
//   npx tsx scripts/audit-edgar-accuracy.ts --ticker LILA  # single ticker deep-dive

import * as path from 'path'
import * as fs   from 'fs'

// ── env loader ────────────────────────────────────────────────────────────────
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

// ── CLI args ──────────────────────────────────────────────────────────────────
const args         = process.argv.slice(2)
const flagN        = args.indexOf('--n')
const TARGET_N     = flagN >= 0 ? parseInt(args[flagN + 1], 10) : 150
const flagTicker   = args.indexOf('--ticker')
const ONLY_TICKER  = flagTicker >= 0 ? args[flagTicker + 1].toUpperCase() : null

// ── EDGAR config ──────────────────────────────────────────────────────────────
// SEC requires a User-Agent with your identity so they can contact you if needed.
const EDGAR_UA    = 'SentraSignals data audit deangans815@gmail.com'
const EDGAR_BASE  = 'https://www.sec.gov'
const DELAY_MS    = 120   // 120 ms between requests ≈ 8 req/s (limit is 10/s)

// ── Types ─────────────────────────────────────────────────────────────────────

type DbRow = {
  id:                 string
  ticker:             string
  insider_name:       string
  insider_cik:        string | null
  officer_title:      string | null
  role:               string | null
  transaction_date:   string
  filed_date:         string | null
  transaction_code:   string
  shares:             number | null
  price_per_share:    number | null
  total_value:        number | null
  shares_owned_after: number | null
  accession_number:   string
  source_url:         string | null
}

// One transaction block from the Form 4 nonDerivativeTable
type F4Tx = {
  securityTitle:   string
  transactionDate: string
  transactionCode: string
  shares:          number | null
  pricePerShare:   number | null
  acquiredDisposed: string     // 'A' = acquired, 'D' = disposed
  sharesOwnedAfter: number | null
}

type F4Filing = {
  reporterName: string
  officerTitle: string | null
  isDirector:   boolean
  isOfficer:    boolean
  issuerTicker: string | null
  transactions: F4Tx[]
}

type Severity = 'HIGH' | 'MEDIUM' | 'LOW'

type Discrepancy = {
  rowId:      string
  ticker:     string
  accession:  string
  field:      string
  dbValue:    string
  secValue:   string
  severity:   Severity
  note?:      string
}

type RowResult = {
  rowId:         string
  ticker:        string
  accession:     string
  status:        'clean' | 'discrepancy' | 'no_match' | 'fetch_failed' | 'skipped'
  discrepancies: Discrepancy[]
  securityTitle?: string   // from matched XML tx — key for multi-class diagnosis
  note?:         string
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Normalise an accession number to dashed form: 0001234567-23-000001
function normAccession(raw: string): string {
  const s = raw.replace(/-/g, '')
  if (s.length !== 18) return raw  // already dashed or unexpected format
  return `${s.slice(0,10)}-${s.slice(10,12)}-${s.slice(12)}`
}

// Normalise to no-dash form for URL construction
function nodash(accession: string): string {
  return accession.replace(/-/g, '')
}

// ── EDGAR rate-limited fetch ───────────────────────────────────────────────────
let lastRequest = 0

async function edgarFetch(url: string, retries = 3): Promise<string | null> {
  const wait = DELAY_MS - (Date.now() - lastRequest)
  if (wait > 0) await sleep(wait)
  lastRequest = Date.now()

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': EDGAR_UA },
      })
      if (resp.status === 429) {
        const sec = 10 * attempt
        process.stderr.write(`  [edgar] rate-limited — waiting ${sec}s\n`)
        await sleep(sec * 1000)
        continue
      }
      if (resp.status === 404) return null
      if (!resp.ok) {
        if (attempt < retries) { await sleep(2000 * attempt); continue }
        return null
      }
      return await resp.text()
    } catch (e: any) {
      if (attempt < retries) await sleep(1500 * attempt)
      else process.stderr.write(`  [edgar] fetch error: ${e.message}\n`)
    }
  }
  return null
}

// ── XML helpers (no dependencies — Form 4 structure is simple enough) ─────────
// Form 4 pattern: <tag><value>X</value></tag> or <tag>X</tag>

function xmlVal(block: string, tag: string): string | null {
  // Pattern 1: <tag ...><value>X</value>... (most Form 4 fields)
  const re1 = new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*<value>([^<]*)</value>`, 'is')
  const m1  = block.match(re1)
  if (m1) return m1[1].trim()
  // Pattern 2: <tag>X</tag>  (issuer block, officer title, etc.)
  const re2 = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, 'is')
  const m2  = block.match(re2)
  return m2 ? m2[1].trim() : null
}

// Returns the innerHTML of every occurrence of <tag>...</tag>
function xmlBlocks(xml: string, tag: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi')
  let m
  while ((m = re.exec(xml)) !== null) out.push(m[1])
  return out
}

function parseNum(s: string | null): number | null {
  if (!s) return null
  const n = parseFloat(s.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

// ── Form 4 XML parser ─────────────────────────────────────────────────────────

function parseForm4(xml: string): F4Filing | null {
  try {
    // Reporting owner
    const ownerBlock = xmlBlocks(xml, 'reportingOwner')[0] ?? ''
    const ownerIdRel = xmlBlocks(ownerBlock, 'reportingOwnerRelationship')[0] ?? ''
    const reporterName = xmlVal(ownerBlock, 'rptOwnerName') ?? ''
    const officerTitle = xmlVal(ownerIdRel, 'officerTitle') ?? null
    const isOfficer    = xmlVal(ownerIdRel, 'isOfficer')  === '1'
    const isDirector   = xmlVal(ownerIdRel, 'isDirector') === '1'

    // Issuer ticker
    const issuerBlock  = xmlBlocks(xml, 'issuer')[0] ?? ''
    const issuerTicker = xmlVal(issuerBlock, 'issuerTradingSymbol') ?? null

    // Non-derivative transactions only (the P/S open-market trades)
    const ndTable = xmlBlocks(xml, 'nonDerivativeTable')[0] ?? ''
    const txBlocks = xmlBlocks(ndTable, 'nonDerivativeTransaction')

    const transactions: F4Tx[] = txBlocks.map(b => {
      const coding  = xmlBlocks(b, 'transactionCoding')[0]  ?? ''
      const amounts = xmlBlocks(b, 'transactionAmounts')[0] ?? ''
      const post    = xmlBlocks(b, 'postTransactionAmounts')[0] ?? ''
      return {
        securityTitle:    xmlVal(b,       'securityTitle')                   ?? '',
        transactionDate:  xmlVal(b,       'transactionDate')                 ?? '',
        transactionCode:  xmlVal(coding,  'transactionCode')                 ?? '',
        acquiredDisposed: xmlVal(amounts, 'transactionAcquiredDisposedCode') ?? '',
        shares:           parseNum(xmlVal(amounts, 'transactionShares')),
        pricePerShare:    parseNum(xmlVal(amounts, 'transactionPricePerShare')),
        sharesOwnedAfter: parseNum(xmlVal(post, 'sharesOwnedFollowingTransaction')),
      }
    })

    return { reporterName, officerTitle, isDirector, isOfficer, issuerTicker, transactions }
  } catch (e: any) {
    process.stderr.write(`  [parse] XML error: ${e.message}\n`)
    return null
  }
}

// ── EDGAR filing fetcher ──────────────────────────────────────────────────────
// Fetches the Form 4 XML from the EDGAR Archives given issuer CIK + accession.
// Step 1: GET the -index.htm to locate the XML filename.
// Step 2: GET the XML itself.

async function fetchFiling(issuerCik: string, accession: string): Promise<F4Filing | null> {
  const nd  = nodash(accession)
  const acc = normAccession(accession)

  // Step 1: filing index
  const indexUrl  = `${EDGAR_BASE}/Archives/edgar/data/${issuerCik}/${nd}/${acc}-index.htm`
  const indexHtml = await edgarFetch(indexUrl)
  if (!indexHtml) return null

  const xmlFile = findXmlInIndex(indexHtml)
  if (!xmlFile) {
    process.stderr.write(`  [index] no XML found for ${acc}\n`)
    return null
  }

  // Step 2: Form 4 XML
  const xmlUrl  = `${EDGAR_BASE}/Archives/edgar/data/${issuerCik}/${nd}/${xmlFile}`
  const xmlText = await edgarFetch(xmlUrl)
  if (!xmlText) return null

  return parseForm4(xmlText)
}

// Extract the primary Form 4 XML filename from the filing index HTML.
// The index table has: Seq | Description | Document | Type | Size
// We want the row where Type column = "4" or "4/A".
function findXmlInIndex(html: string): string | null {
  // Walk table rows, find one with type "4" or "4/A" that contains an .xml link
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1]
    if (!/<td[^>]*>\s*4(?:\/A)?\s*<\/td>/i.test(row)) continue
    const link = row.match(/href="([^"]+\.xml)"/i)
    if (link) return link[1].split('/').pop() ?? null
  }
  // Fallback: grab the first .xml link in the page
  const any = html.match(/href="[^"]*\/([^"/]+\.xml)"/i)
  return any ? any[1] : null
}

// ── CIK resolution ────────────────────────────────────────────────────────────
// Preferred: extract issuer CIK from source_url, which is a direct EDGAR URL.
// Fallback: company_tickers.json (one-time download, cached in memory).

function cikFromSourceUrl(url: string | null): string | null {
  if (!url) return null
  const m = url.match(/edgar\/data\/(\d+)\//i)
  return m ? m[1] : null
}

let cikCache: Map<string, string> | null = null

async function loadCikMap(): Promise<Map<string, string>> {
  if (cikCache) return cikCache
  console.log('[setup] fetching EDGAR ticker→CIK map (1 request)...')
  const text = await edgarFetch('https://www.sec.gov/files/company_tickers.json')
  if (!text) { cikCache = new Map(); return cikCache }
  const json = JSON.parse(text) as Record<string, { cik_str: string; ticker: string }>
  cikCache = new Map(Object.values(json).map(e => [e.ticker.toUpperCase(), e.cik_str]))
  console.log(`[setup] loaded ${cikCache.size} ticker→CIK entries`)
  return cikCache
}

async function resolveCik(row: DbRow, cikMap: Map<string, string>): Promise<string | null> {
  return cikFromSourceUrl(row.source_url) ?? cikMap.get(row.ticker) ?? null
}

// ── Transaction matching ──────────────────────────────────────────────────────
// Given a DB row, find the best-matching nonDerivativeTransaction in the filing.
// Matching criteria (in order): date + code must match, then shares ≈ match.

function matchTx(row: DbRow, filing: F4Filing): F4Tx | null {
  const candidates = filing.transactions.filter(t =>
    t.transactionDate === row.transaction_date &&
    t.transactionCode === row.transaction_code
  )
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Multiple candidates (same date/code but different security classes):
  // score by how closely shares match, then price.
  const scored = candidates.map(t => {
    let score = 0
    if (row.shares != null && t.shares != null) {
      const diff = Math.abs(row.shares - t.shares)
      score += diff === 0 ? 100 : diff <= 1 ? 60 : diff / (row.shares || 1) < 0.01 ? 20 : -50
    }
    if (row.price_per_share != null && t.pricePerShare != null && t.pricePerShare > 0) {
      const pct = Math.abs(row.price_per_share - t.pricePerShare) / t.pricePerShare
      score += pct < 0.01 ? 40 : pct < 0.05 ? 10 : -20
    }
    return { t, score }
  }).sort((a, b) => b.score - a.score)

  return scored[0].t
}

// ── Field comparisons ─────────────────────────────────────────────────────────

function compareRow(row: DbRow, filing: F4Filing, tx: F4Tx): Discrepancy[] {
  const diffs: Discrepancy[] = []
  const base = { rowId: row.id, ticker: row.ticker, accession: row.accession_number }

  const add = (field: string, dbV: string, secV: string, sev: Severity, note?: string) =>
    diffs.push({ ...base, field, dbValue: dbV, secValue: secV, severity: sev, note })

  // insider_name — normalize to uppercase, strip punctuation, compare word sets
  const normName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim()
  const dbName  = normName(row.insider_name)
  const secName = normName(filing.reporterName)
  if (dbName !== secName) {
    const dbWords  = new Set(dbName.split(/\s+/).filter(w => w.length > 1))
    const secWords = new Set(secName.split(/\s+/).filter(w => w.length > 1))
    const shared   = [...dbWords].filter(w => secWords.has(w)).length
    // Full mismatch (no shared words) = HIGH; partial = LOW (likely formatting)
    add('insider_name', row.insider_name, filing.reporterName, shared === 0 ? 'HIGH' : 'LOW')
  }

  // officer_title — informational only (SEC/company formatting varies widely)
  if (row.officer_title && filing.officerTitle) {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (norm(row.officer_title) !== norm(filing.officerTitle)) {
      add('officer_title', row.officer_title, filing.officerTitle, 'LOW')
    }
  }

  // transaction_date — must be exact
  if (tx.transactionDate && tx.transactionDate !== row.transaction_date) {
    add('transaction_date', row.transaction_date, tx.transactionDate, 'HIGH')
  }

  // transaction_code — must be exact
  if (tx.transactionCode !== row.transaction_code) {
    add('transaction_code', row.transaction_code, tx.transactionCode, 'HIGH')
  }

  // shares — allow ±1 for rounding
  if (row.shares != null && tx.shares != null) {
    const diff = Math.abs(row.shares - tx.shares)
    if (diff > 1) {
      const pct = diff / tx.shares
      add('shares', row.shares.toLocaleString(), tx.shares.toLocaleString(), pct > 0.01 ? 'HIGH' : 'MEDIUM')
    }
  } else if (row.shares != null && tx.shares == null) {
    add('shares', row.shares.toLocaleString(), 'null in SEC', 'MEDIUM')
  }

  // price_per_share — allow 0.5% tolerance for source rounding differences
  if (row.price_per_share != null && tx.pricePerShare != null) {
    if (tx.pricePerShare === 0) {
      // $0 in SEC for a 'P' row is suspicious — probably an award, not a purchase
      if (row.transaction_code === 'P') {
        add('price_per_share', `$${row.price_per_share.toFixed(4)}`, '$0.00 (SEC)',
          'MEDIUM', 'SEC reports $0 — may be a grant/award, not an open-market purchase')
      }
    } else {
      const pct = Math.abs(row.price_per_share - tx.pricePerShare) / tx.pricePerShare
      if (pct > 0.005) {
        const sev: Severity = pct > 0.05 ? 'HIGH' : 'MEDIUM'
        const secTitle = tx.securityTitle ? ` (SEC security: "${tx.securityTitle}")` : ''
        const note = sev === 'HIGH'
          ? `Sentra $${row.price_per_share.toFixed(4)} vs SEC $${tx.pricePerShare.toFixed(4)} (${(pct * 100).toFixed(1)}% off)${secTitle}` +
            (tx.securityTitle.toLowerCase().includes('prefer') ||
             /series [a-z]|class [abc]/i.test(tx.securityTitle)
              ? ' -- POSSIBLE CROSS-CLASS PRICE ASSIGNMENT'
              : '')
          : undefined
        add('price_per_share', `$${row.price_per_share.toFixed(4)}`, `$${tx.pricePerShare.toFixed(4)}`, sev, note)
      }
    }
  }

  // total_value — derived, so compare against shares × price from SEC
  if (row.total_value != null && tx.shares != null && tx.pricePerShare != null && tx.pricePerShare > 0) {
    const expected = tx.shares * tx.pricePerShare
    const pct = Math.abs(row.total_value - expected) / expected
    if (pct > 0.01) {
      add('total_value',
        `$${row.total_value.toLocaleString()}`,
        `$${expected.toLocaleString()} (shares×price from SEC)`,
        pct > 0.05 ? 'HIGH' : 'MEDIUM')
    }
  }

  // shares_owned_after — allow ±1
  if (row.shares_owned_after != null && tx.sharesOwnedAfter != null) {
    const diff = Math.abs(row.shares_owned_after - tx.sharesOwnedAfter)
    if (diff > 1) {
      const pct = diff / tx.sharesOwnedAfter
      add('shares_owned_after',
        row.shares_owned_after.toLocaleString(),
        tx.sharesOwnedAfter.toLocaleString(),
        pct > 0.01 ? 'HIGH' : 'LOW')
    }
  }

  return diffs
}

// ── Multi-class ambiguity check ───────────────────────────────────────────────
// When a single Form 4 has P/S transactions in MULTIPLE security classes on the
// same date, we flag the row so the human can verify the right class was matched.
// This is the Liberty Latin America / multi-share-class bug surface.

function multiClassNote(row: DbRow, filing: F4Filing): string | null {
  const sameDay = filing.transactions.filter(t =>
    t.transactionDate === row.transaction_date &&
    t.transactionCode === row.transaction_code
  )
  if (sameDay.length < 2) return null
  const titles = [...new Set(sameDay.map(t => t.securityTitle).filter(Boolean))]
  // Only flag when there are genuinely DIFFERENT security titles — not same-class tranches
  if (titles.length < 2) return null
  return `Filing has ${sameDay.length} ${row.transaction_code} transactions on this date ` +
    `across different security classes: [${titles.join(' | ')}] — verify correct class was matched`
}

// ── Sampling ──────────────────────────────────────────────────────────────────

const DB_COLS = 'id, ticker, insider_name, insider_cik, officer_title, role, ' +
                'transaction_date, filed_date, transaction_code, shares, price_per_share, ' +
                'total_value, shares_owned_after, accession_number, source_url'

async function sampleRows(): Promise<DbRow[]> {
  const MEGA_CAPS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'TSLA', 'JPM', 'V', 'XOM']

  // Known multi-security-class companies — cross-class price assignment bug surface
  const MULTI_CLASS = ['LILA', 'LILAB', 'LILAK', 'LILAP',  // Liberty Latin America
                       'GOOG', 'GOOGL',                      // Alphabet A/C
                       'FOX', 'FOXA',                        // Fox Corp A/B
                       'NWS', 'NWSA',                        // News Corp A/B
                       'FWONA', 'FWONK',                     // Liberty Formula One A/C
                       'BATRK', 'BATRA']                     // Atlanta Braves A/C

  const seen = new Map<string, DbRow>()

  const add = (rows: any[]) => {
    for (const r of rows ?? []) {
      if (!seen.has(r.id)) seen.set(r.id, r as DbRow)
    }
  }

  if (ONLY_TICKER) {
    const { data } = await sb.from('insider_transactions').select(DB_COLS)
      .eq('ticker', ONLY_TICKER)
      .in('transaction_code', ['P', 'S'])
      .not('accession_number', 'is', null)
      .order('transaction_date', { ascending: false })
      .limit(Math.min(TARGET_N, 100))
    add(data ?? [])
    return [...seen.values()]
  }

  // 1. Mega-caps: 5 per ticker (~50 rows)
  process.stdout.write('[sample] mega-caps ... ')
  for (const t of MEGA_CAPS) {
    const { data } = await sb.from('insider_transactions').select(DB_COLS)
      .eq('ticker', t).in('transaction_code', ['P', 'S'])
      .not('accession_number', 'is', null)
      .order('transaction_date', { ascending: false })
      .limit(5)
    add(data ?? [])
  }
  process.stdout.write(`${seen.size} rows\n`)

  // 2. Multi-class tickers: up to 6 per ticker (~50 rows)
  process.stdout.write('[sample] multi-class tickers (LILA*, GOOG, FOX, etc.) ... ')
  for (const t of MULTI_CLASS) {
    if (seen.size >= TARGET_N) break
    const { data } = await sb.from('insider_transactions').select(DB_COLS)
      .eq('ticker', t).in('transaction_code', ['P', 'S'])
      .not('accession_number', 'is', null)
      .order('transaction_date', { ascending: false })
      .limit(6)
    add(data ?? [])
  }
  process.stdout.write(`${seen.size} rows\n`)

  // 3. Small/low-value transactions (more likely to be from obscure tickers)
  process.stdout.write('[sample] small-value transactions (obscure tickers) ... ')
  {
    const { data } = await sb.from('insider_transactions').select(DB_COLS)
      .in('transaction_code', ['P', 'S'])
      .not('accession_number', 'is', null)
      .not('total_value', 'is', null)
      .lt('total_value', 100_000)
      .order('filed_date', { ascending: false })
      .limit(40)
    add(data ?? [])
  }
  process.stdout.write(`${seen.size} rows\n`)

  // 4. Fill remainder with recent transactions (diverse, catches any systematic issue)
  if (seen.size < TARGET_N) {
    const need = TARGET_N - seen.size
    process.stdout.write(`[sample] filling ${need} more from recent transactions ... `)
    // Skip the very first page (already covered by mega-caps) — offset 80 for diversity
    const { data } = await sb.from('insider_transactions').select(DB_COLS)
      .in('transaction_code', ['P', 'S'])
      .not('accession_number', 'is', null)
      .order('filed_date', { ascending: false })
      .range(80, 80 + need * 2)
    add(data ?? [])
    process.stdout.write(`${seen.size} rows\n`)
  }

  return [...seen.values()].slice(0, TARGET_N)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║  SEC EDGAR Form 4 Data Accuracy Audit                   ║')
  console.log('║  Read-only — no data will be modified.                  ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log()

  // 1. Sample rows from DB
  const rows = await sampleRows()
  if (rows.length === 0) { console.log('No rows found.'); return }

  // 2. Load ticker→CIK fallback map (1 EDGAR request)
  const cikMap = await loadCikMap()

  // 3. Group by accession_number — one EDGAR fetch covers all rows from the same filing
  const byAcc = new Map<string, DbRow[]>()
  for (const row of rows) {
    const a = normAccession(row.accession_number)
    if (!byAcc.has(a)) byAcc.set(a, [])
    byAcc.get(a)!.push(row)
  }

  const uniqueFilings = byAcc.size
  const estRequests   = uniqueFilings * 2 + 1  // index + xml per filing, plus cikMap
  const estSeconds    = Math.ceil(estRequests * DELAY_MS / 1000)

  console.log(`\n[audit] ${rows.length} rows → ${uniqueFilings} unique Form 4 filings`)
  console.log(`[audit] ~${estRequests} EDGAR requests at ${DELAY_MS}ms spacing ≈ ${estSeconds}s (~${Math.ceil(estSeconds / 60)}min)`)
  console.log(`[audit] User-Agent: ${EDGAR_UA}\n`)

  // 4. Audit each filing
  const results: RowResult[] = []
  let   filingIdx = 0

  for (const [accession, accRows] of byAcc) {
    filingIdx++
    const sample = accRows[0]
    const tickers = [...new Set(accRows.map(r => r.ticker))].join('/')
    process.stdout.write(`[${String(filingIdx).padStart(3)}/${uniqueFilings}] ${tickers.padEnd(18)} ${accession} ... `)

    // Resolve issuer CIK
    const cik = await resolveCik(sample, cikMap)
    if (!cik) {
      process.stdout.write('SKIP (no CIK)\n')
      for (const r of accRows) {
        results.push({ rowId: r.id, ticker: r.ticker, accession, status: 'skipped',
          discrepancies: [], note: 'Could not resolve issuer CIK' })
      }
      continue
    }

    // Fetch and parse the Form 4
    const filing = await fetchFiling(cik, accession)
    if (!filing) {
      process.stdout.write('FETCH FAILED\n')
      for (const r of accRows) {
        results.push({ rowId: r.id, ticker: r.ticker, accession, status: 'fetch_failed',
          discrepancies: [], note: 'EDGAR fetch/parse failed' })
      }
      continue
    }

    // Tranche count check: compare XML P/S transaction count vs DB row count for this accession.
    // Mismatch = ingest pipeline collapsed or dropped tranches from multi-tranche filings.
    const xmlPsTxCount = filing.transactions.filter(t => t.transactionCode === 'P' || t.transactionCode === 'S').length
    const dbPsTxCount  = accRows.filter(r => r.transaction_code === 'P' || r.transaction_code === 'S').length
    if (xmlPsTxCount !== dbPsTxCount) {
      process.stdout.write(`\n  *** TRANCHE MISMATCH: XML has ${xmlPsTxCount} P/S txs, DB has ${dbPsTxCount} *** `)
    }

    // Match and compare each DB row to the XML
    const marks: string[] = []
    for (const row of accRows) {
      const matched = matchTx(row, filing)
      if (!matched) {
        results.push({ rowId: row.id, ticker: row.ticker, accession, status: 'no_match',
          discrepancies: [],
          note: `No ${row.transaction_code} on ${row.transaction_date} in this filing's XML` })
        marks.push('?')
        continue
      }
      const diffs = compareRow(row, filing, matched)
      const mcNote = multiClassNote(row, filing)
      results.push({
        rowId: row.id, ticker: row.ticker, accession,
        status: diffs.length > 0 ? 'discrepancy' : 'clean',
        discrepancies: diffs,
        securityTitle: matched.securityTitle || undefined,
        note: mcNote ?? undefined,
      })
      marks.push(diffs.length > 0 ? `${diffs.length}⚠` : '✓')
    }
    process.stdout.write(marks.join(' ') + '\n')
  }

  // 5. Print report
  report(results, rows.length)
}

// ── Report printer ────────────────────────────────────────────────────────────

function report(results: RowResult[], totalSampled: number) {
  const clean     = results.filter(r => r.status === 'clean')
  const disc      = results.filter(r => r.status === 'discrepancy')
  const noMatch   = results.filter(r => r.status === 'no_match')
  const failed    = results.filter(r => r.status === 'fetch_failed')
  const skipped   = results.filter(r => r.status === 'skipped')
  const allDiffs  = disc.flatMap(r => r.discrepancies)

  const SEP = '═'.repeat(64)
  console.log(`\n${SEP}`)
  console.log('  AUDIT SUMMARY')
  console.log(SEP)
  console.log(`  Total rows sampled        ${totalSampled}`)
  console.log(`  EDGAR filings fetched     ${totalSampled - failed.length - skipped.length}`)
  console.log(`  Clean rows                ${clean.length}  (${pct(clean.length, totalSampled)}%)`)
  console.log(`  Rows with discrepancies   ${disc.length}  (${pct(disc.length, totalSampled)}%)`)
  console.log(`  No XML match found        ${noMatch.length}`)
  console.log(`  EDGAR fetch failed        ${failed.length}`)
  console.log(`  Skipped (no CIK)          ${skipped.length}`)

  if (allDiffs.length === 0 && noMatch.length === 0) {
    console.log(`\n  ALL CLEAR — no data discrepancies found in this sample.`)
  } else {
    // By field
    if (allDiffs.length > 0) {
      console.log(`\n  DISCREPANCIES BY FIELD  (${allDiffs.length} total)`)
      console.log('  ' + '─'.repeat(60))
      const byField = new Map<string, Discrepancy[]>()
      for (const d of allDiffs) {
        if (!byField.has(d.field)) byField.set(d.field, [])
        byField.get(d.field)!.push(d)
      }
      for (const [field, ds] of [...byField].sort((a, b) => b[1].length - a[1].length)) {
        const hi  = ds.filter(d => d.severity === 'HIGH').length
        const med = ds.filter(d => d.severity === 'MEDIUM').length
        const lo  = ds.filter(d => d.severity === 'LOW').length
        const tag = [hi ? `${hi} HIGH` : '', med ? `${med} MED` : '', lo ? `${lo} LOW` : ''].filter(Boolean).join(', ')
        console.log(`  ${field.padEnd(26)} ${String(ds.length).padStart(3)}  [${tag}]`)
      }

      // Multi-class flag
      const multiClassSuspects = disc.filter(r =>
        r.securityTitle &&
        (/prefer|series [a-z]|class [abc]/i.test(r.securityTitle)) &&
        r.discrepancies.some(d => d.field === 'price_per_share' && d.severity === 'HIGH')
      )
      if (multiClassSuspects.length > 0) {
        console.log()
        console.log(`  *** MULTI-CLASS PRICE BUG SUSPECTED ***`)
        console.log(`  ${multiClassSuspects.length} row(s) have a HIGH price discrepancy`)
        console.log(`  and a non-common-stock security title in the XML.`)
        console.log(`  These likely have a preference/series price assigned to the wrong ticker.`)
        for (const r of multiClassSuspects) {
          console.log(`    ${r.ticker.padEnd(8)} ${r.accession}  security="${r.securityTitle}"`)
        }
      }

      // Multi-class ambiguity flags (not necessarily wrong, just flagged for review)
      const mcAmbiguous = results.filter(r => r.note?.includes('different security classes'))
      if (mcAmbiguous.length > 0) {
        console.log()
        console.log(`  MULTI-CLASS AMBIGUITY (${mcAmbiguous.length} rows — verify correct class was matched)`)
        for (const r of mcAmbiguous.slice(0, 10)) {
          console.log(`    ${r.ticker.padEnd(8)} ${r.accession}`)
          console.log(`    ${r.note}`)
        }
        if (mcAmbiguous.length > 10) console.log(`    ... and ${mcAmbiguous.length - 10} more`)
      }

      // Detailed diff listing — HIGH and MEDIUM only
      const importantDisc = disc.filter(r => r.discrepancies.some(d => d.severity !== 'LOW'))
      if (importantDisc.length > 0) {
        console.log()
        console.log('  DETAILS (HIGH + MEDIUM severity)')
        console.log('  ' + '─'.repeat(60))
        let n = 0
        for (const r of importantDisc) {
          const imp = r.discrepancies.filter(d => d.severity !== 'LOW')
          n++
          console.log()
          console.log(`  [${n}] ${r.ticker}  ${r.accession}`)
          if (r.securityTitle) console.log(`      SEC security title: "${r.securityTitle}"`)
          if (r.note)          console.log(`      Note: ${r.note}`)
          for (const d of imp) {
            console.log(`      ${d.severity === 'HIGH' ? '***' : '---'} ${d.field}`)
            console.log(`            Sentra : ${d.dbValue}`)
            console.log(`            SEC    : ${d.secValue}`)
            if (d.note) console.log(`            Note   : ${d.note}`)
          }
        }
      }
    }

    // No-match rows
    if (noMatch.length > 0) {
      console.log()
      console.log('  ROWS WITH NO XML MATCH (transaction not found in filing)')
      console.log('  ' + '─'.repeat(60))
      for (const r of noMatch.slice(0, 20)) {
        console.log(`  ${r.ticker.padEnd(8)} ${r.accession}  ${r.note}`)
      }
      if (noMatch.length > 20) console.log(`  ... and ${noMatch.length - 20} more`)
    }
  }

  // Interpretation guide
  console.log()
  console.log('  SEVERITY GUIDE')
  console.log('  HIGH   : wrong value (>5% off or completely different) — must investigate')
  console.log('  MEDIUM : minor rounding, derived-field drift, or $0 price')
  console.log('  LOW    : name formatting / title wording differences — cosmetic only')

  // Save full results to output/
  const outDir  = path.join(__dirname, '..', 'output')
  const outFile = path.join(outDir, `edgar-audit-${new Date().toISOString().slice(0, 10)}.json`)
  try {
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify({
      ranAt: new Date().toISOString(),
      totalSampled,
      summary: { clean: clean.length, discrepant: disc.length, noMatch: noMatch.length,
        fetchFailed: failed.length, skipped: skipped.length },
      results,
    }, null, 2))
    console.log(`\n  Full JSON results saved → ${outFile}`)
  } catch { /* non-fatal */ }

  console.log(`\n${SEP}\n`)
}

function pct(n: number, total: number): string {
  return total === 0 ? '0' : ((n / total) * 100).toFixed(1)
}

main().catch(err => { console.error(err); process.exit(1) })
