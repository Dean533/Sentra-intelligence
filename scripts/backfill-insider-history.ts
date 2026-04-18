// Run with:  npx tsx scripts/backfill-insider-history.ts
// Requires:  .env.local in the project root with NEXT_PUBLIC_SUPABASE_URL
//            and NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY

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

const START_DATE      = '2023-01-01'
const TODAY           = new Date().toISOString().split('T')[0]
const PAGE_SIZE       = 50
const TICKER_DELAY_MS = 500   // between tickers
const FILING_DELAY_MS = 200   // between XML fetches within a ticker

const SEC_HEADERS = {
  'User-Agent': 'Sentra contact@sentra.com',
  Accept: 'application/json, text/xml, */*',
}

// ─── XML helpers (identical to app/api/insider/ingest/route.ts) ───────────────

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

// ─── Form 4 parser (identical logic to ingest/route.ts) ───────────────────────

type ParsedTx = {
  insiderName:          string
  insiderCik:           string | null
  isDirector:           boolean
  isOfficer:            boolean
  officerTitle:         string | null
  role:                 string
  transactionDate:      string
  transactionCode:      string
  transactionDirection: string
  shares:               number
  pricePerShare:        number
  totalValue:           number
  sharesOwnedAfter:     number | null
}

function parseForm4(xml: string): ParsedTx[] {
  const insiderName  = directVal(xml, 'rptOwnerName') ?? 'Unknown'
  const insiderCik   = directVal(xml, 'rptOwnerCik') ?? null
  const isDirector   = directVal(xml, 'isDirector') === '1'
  const isOfficer    = directVal(xml, 'isOfficer') === '1'
  const officerTitle = directVal(xml, 'officerTitle')
  const is10Pct      = directVal(xml, 'isTenPercentOwner') === '1'

  const role = officerTitle
    ?? (isDirector ? 'Director'  : null)
    ?? (is10Pct    ? '10% Owner' : null)
    ?? 'Insider'

  const txBlocks = allBlocks(xml, 'nonDerivativeTransaction')
  const results: ParsedTx[] = []

  for (const block of txBlocks) {
    const code = directVal(block, 'transactionCode')
    if (code !== 'P' && code !== 'S') continue

    const dateStr        = nestedVal(block, 'transactionDate')
    const sharesStr      = nestedVal(block, 'transactionShares')
    const priceStr       = nestedVal(block, 'transactionPricePerShare')
    const sharesAfterStr = nestedVal(block, 'sharesOwnedFollowingTransaction')

    const shares = sharesStr ? parseFloat(sharesStr) : 0
    const price  = priceStr  ? parseFloat(priceStr)  : 0

    if (!dateStr || shares <= 0 || price <= 0) continue
    if (shares * price < 10_000) continue

    results.push({
      insiderName,
      insiderCik,
      isDirector,
      isOfficer,
      officerTitle,
      role,
      transactionDate:      dateStr,
      transactionCode:      code!,
      transactionDirection: code === 'P' ? 'buy' : 'sell',
      shares,
      pricePerShare:        price,
      totalValue:           Math.round(shares * price * 100) / 100,
      sharesOwnedAfter:     sharesAfterStr ? parseFloat(sharesAfterStr) : null,
    })
  }

  return results
}

// ─── EDGAR helpers ────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function findRawXmlUrl(cikInt: number, adshClean: string): Promise<string | null> {
  const res = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/index.json`,
    { headers: SEC_HEADERS }
  )
  if (!res.ok) return null
  const items: { name: string }[] = (await res.json())?.directory?.item ?? []
  const f = items.find(
    (i) => i.name.toLowerCase().endsWith('.xml') && !i.name.toLowerCase().includes('xsl')
  )
  return f
    ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${f.name}`
    : null
}

// ─── Process one filing ───────────────────────────────────────────────────────

async function processFiling(
  ticker:     string,
  cikInt:     number,
  adsh:       string,
  primaryDoc: string | null,
  filedDate:  string
): Promise<{ inserted: number; skipped: number }> {
  const adshClean = adsh.replace(/-/g, '')
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${adsh}-index.htm`

  const xmlUrl = primaryDoc
    ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${primaryDoc}`
    : await findRawXmlUrl(cikInt, adshClean)
  if (!xmlUrl) return { inserted: 0, skipped: 1 }

  await sleep(FILING_DELAY_MS)

  const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
  if (!xmlRes.ok) return { inserted: 0, skipped: 1 }

  const xml = await xmlRes.text()
  if (!xml.includes('<ownershipDocument') && !xml.includes('<rptOwnerName')) {
    return { inserted: 0, skipped: 1 }
  }

  const transactions = parseForm4(xml)
  if (transactions.length === 0) return { inserted: 0, skipped: 1 }

  let inserted = 0

  for (const tx of transactions) {
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
      accession_number:      adsh,
      filed_date:            filedDate,
      source_url:            sourceUrl,
    }

    const { error } = await supabase
      .from('insider_transactions')
      .upsert([payload], { onConflict: 'ticker,insider_name,transaction_date,transaction_code', ignoreDuplicates: true })

    if (error) throw new Error(`Upsert failed for ${ticker} ${adsh}: ${error.message}`)
    inserted++
  }

  return { inserted, skipped: inserted === 0 ? 1 : 0 }
}

// ─── EDGAR full-text search for one ticker ────────────────────────────────────

type FeedEntry = { cik: number; adsh: string; primaryDoc: string; filedDate: string }

async function fetchFilingsForTicker(
  ticker:     string,
  companyCik: number
): Promise<FeedEntry[]> {
  const base =
    `https://efts.sec.gov/LATEST/search-index` +
    `?q=${encodeURIComponent(`"${ticker}"`)}` +
    `&forms=4` +
    `&dateRange=custom&startdt=${START_DATE}&enddt=${TODAY}`

  const results: FeedEntry[] = []
  let from  = 0
  let total = Infinity

  while (from < total) {
    const res = await fetch(`${base}&from=${from}&size=${PAGE_SIZE}`, { headers: SEC_HEADERS })
    if (!res.ok) break

    const json  = await res.json()
    total       = json?.hits?.total?.value ?? 0
    const hits: any[] = json?.hits?.hits ?? []
    if (hits.length === 0) break

    for (const hit of hits) {
      const rawId = (hit._id as string | undefined) ?? ''
      const [adsh, primaryDoc] = rawId.split(':')
      if (!adsh || !primaryDoc) continue

      const src      = hit._source ?? {}
      const filedDate: string = src.file_date ?? TODAY

      // Confirm this filing is associated with our company's CIK.
      // _source.ciks contains all CIKs linked to the filing (issuer + filer).
      const cikList: string[] = Array.isArray(src.ciks) ? src.ciks : []
      const linked = cikList.some((c) => parseInt(c, 10) === companyCik)
      if (!linked) continue

      results.push({ cik: companyCik, adsh, primaryDoc, filedDate })
    }

    from += hits.length
    await sleep(150)
  }

  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Backfill: ${START_DATE} → ${TODAY}`)
  console.log()

  // 1. All tickers from Supabase
  const { data: tickerRows, error: tickerErr } = await supabase
    .from('tickers')
    .select('symbol')
    .order('market_cap', { ascending: false })

  if (tickerErr) {
    console.error('Failed to fetch tickers:', tickerErr.message)
    process.exit(1)
  }

  const symbols = (tickerRows ?? []).map((r: any) => r.symbol as string)
  console.log(`${symbols.length} tickers loaded from Supabase`)

  // 2. Ticker → CIK map from SEC
  console.log('Fetching CIK map from SEC...')
  const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikRes.ok) {
    console.error('Failed to fetch CIK map from SEC:', cikRes.status)
    process.exit(1)
  }
  const cikRaw: Record<string, { cik_str: string; ticker: string }> = await cikRes.json()
  const tickerToCik: Record<string, number> = {}
  for (const entry of Object.values(cikRaw)) {
    tickerToCik[entry.ticker] = parseInt(entry.cik_str, 10)
  }
  console.log(`CIK map loaded (${Object.keys(tickerToCik).length} entries)`)
  console.log()

  // 3. Process each ticker
  let totalInserted = 0
  let totalSkipped  = 0
  let tickersFailed = 0

  for (let i = 0; i < symbols.length; i++) {
    const ticker     = symbols[i]
    const companyCik = tickerToCik[ticker]

    if (!companyCik) {
      console.log(`[${i + 1}/${symbols.length}] ${ticker.padEnd(6)} — no CIK in SEC map, skipping`)
      continue
    }

    let filings: FeedEntry[]
    try {
      filings = await fetchFilingsForTicker(ticker, companyCik)
    } catch (err: any) {
      console.log(`[${i + 1}/${symbols.length}] ${ticker.padEnd(6)} — search error: ${err.message}`)
      tickersFailed++
      await sleep(TICKER_DELAY_MS)
      continue
    }

    if (filings.length === 0) {
      console.log(`[${i + 1}/${symbols.length}] ${ticker.padEnd(6)} — 0 filings`)
      await sleep(TICKER_DELAY_MS)
      continue
    }

    let tickerInserted = 0
    let tickerSkipped  = 0

    for (const filing of filings) {
      try {
        const { inserted, skipped } = await processFiling(
          ticker,
          filing.cik,
          filing.adsh,
          filing.primaryDoc,
          filing.filedDate
        )
        tickerInserted += inserted
        tickerSkipped  += skipped
      } catch {
        tickerSkipped++
      }
    }

    totalInserted += tickerInserted
    totalSkipped  += tickerSkipped

    console.log(
      `[${i + 1}/${symbols.length}] ${ticker.padEnd(6)} — ` +
      `${filings.length} filing${filings.length !== 1 ? 's' : ''}, ` +
      `${tickerInserted} inserted, ${tickerSkipped} skipped`
    )

    await sleep(TICKER_DELAY_MS)
  }

  console.log()
  console.log('─'.repeat(48))
  console.log(`Total trades inserted : ${totalInserted}`)
  console.log(`Total filings skipped : ${totalSkipped}`)
  console.log(`Tickers with errors   : ${tickersFailed}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
