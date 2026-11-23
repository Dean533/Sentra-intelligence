// Run with:  npx tsx scripts/backfill-r2000.ts
//
// Backfills 3 years of Form 4 insider history for the 1,879 R2000 tickers
// in scripts/new_tickers_r2000_seed.csv.
//
// Same logic as backfill-new-tickers.ts (xsl-strip, all codes, no value floor,
// per-CIK submissions JSON, future-date guard, dedup).
// Progress: output/r2000-backfill-progress.json — resume-safe.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

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

const CUTOFF_DATE   = '2023-06-19'
const PROGRESS_PATH = path.join(__dirname, '..', 'output', 'r2000-backfill-progress.json')
const CSV_PATH      = path.join(__dirname, 'new_tickers_r2000_seed.csv')
const SEC_HEADERS   = { 'User-Agent': 'Sentra contact@sentra.com', Accept: 'application/json, text/xml, */*' }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const padCik = (cik: string | number) => String(cik).padStart(10, '0')

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'")
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
  return xml.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')) ?? []
}

function detectPlanSale(block: string, xml: string, code: string): boolean {
  const pn1 = directVal(block, 'planName')
  const pn2 = nestedVal(block, 'transactionPlanName')
  if ((pn1 && pn1.trim()) || (pn2 && pn2.trim())) return true
  if (code === 'S') {
    const re = /footnoteId[^>]*\sid="([^"]+)"/gi; let m: RegExpExecArray | null
    while ((m = re.exec(block)) !== null) {
      const fn = xml.match(new RegExp(`<footnote[^>]*\\sid="${m[1]}"[^>]*>([\\s\\S]*?)<\\/footnote>`, 'i'))
      if (fn && fn[1].toLowerCase().includes('10b5-1')) return true
    }
  }
  return false
}

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
  const results: ParsedTx[] = []
  for (const block of allBlocks(xml, 'nonDerivativeTransaction')) {
    const code = directVal(block, 'transactionCode')
    if (!code) continue
    const dateStr        = nestedVal(block, 'transactionDate')
    const sharesStr      = nestedVal(block, 'transactionShares')
    const priceStr       = nestedVal(block, 'transactionPricePerShare')
    const sharesAfterStr = nestedVal(block, 'sharesOwnedFollowingTransaction')
    if (!dateStr) continue
    const shares = sharesStr ? parseFloat(sharesStr) : 0
    const price  = priceStr  ? parseFloat(priceStr)  : 0
    results.push({
      insiderName, insiderCik, insiderState, isDirector, isOfficer, officerTitle, role,
      transactionDate:      dateStr,
      transactionCode:      code,
      transactionDirection: code === 'P' ? 'buy' : 'sell',
      shares, pricePerShare: price,
      totalValue:     Math.round(shares * price * 100) / 100,
      sharesOwnedAfter: sharesAfterStr ? parseFloat(sharesAfterStr) : null,
      isPlanSale: detectPlanSale(block, xml, code),
    })
  }
  return results
}

async function findRawXmlUrl(cikInt: number, adshClean: string): Promise<string | null> {
  const res = await fetch(`https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/index.json`, { headers: SEC_HEADERS })
  if (!res.ok) return null
  const items: { name: string }[] = (await res.json())?.directory?.item ?? []
  const f = items.find(i => i.name.toLowerCase().endsWith('.xml') && !i.name.toLowerCase().includes('xsl'))
  return f ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${f.name}` : null
}

async function processFiling(
  ticker: string, cikInt: number, adsh: string,
  primaryDoc: string | null, filedDate: string
): Promise<{ inserted: number; skipped: number }> {
  const adshClean = adsh.replace(/-/g, '')
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${adsh}-index.htm`
  const cleanDoc  = primaryDoc?.replace(/^xsl[^/]+\//i, '') ?? null
  const isHtmlDoc = cleanDoc && /\.html?$/i.test(cleanDoc)

  let xmlUrl: string | null
  if (isHtmlDoc || !cleanDoc) xmlUrl = await findRawXmlUrl(cikInt, adshClean)
  else xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${cleanDoc}`

  if (!xmlUrl) return { inserted: 0, skipped: 1 }
  await sleep(20)
  const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
  if (!xmlRes.ok) return { inserted: 0, skipped: 1 }
  const xml = await xmlRes.text()
  if (!xml.includes('<ownershipDocument') && !xml.includes('<rptOwnerName')) return { inserted: 0, skipped: 1 }

  const transactions = parseForm4(xml)
  if (transactions.length === 0) return { inserted: 0, skipped: 1 }

  let inserted = 0
  const cutoffMs = Date.now() + 7 * 24 * 60 * 60 * 1000

  for (const tx of transactions) {
    if (new Date(tx.transactionDate).getTime() > cutoffMs) continue
    if (tx.insiderCik) {
      const { data: existing } = await supabase
        .from('insider_transactions').select('id')
        .eq('ticker', ticker).eq('insider_cik', tx.insiderCik)
        .eq('transaction_date', tx.transactionDate).eq('shares', tx.shares)
        .eq('transaction_direction', tx.transactionDirection)
        .limit(1).maybeSingle()
      if (existing) continue
    }
    const { error } = await supabase.from('insider_transactions').insert([{
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
      is_local:              false,
      accession_number:      adsh,
      filed_date:            filedDate,
      source_url:            sourceUrl,
    }])
    if (error) continue

    if (!tx.isPlanSale) {
      const verb = tx.transactionDirection === 'sell' ? 'sold' : 'purchased'
      await supabase.from('events').upsert({
        ticker, event_type: 'insider',
        title:        `${tx.insiderName} ${verb} ${tx.shares.toLocaleString()} shares of ${ticker}`,
        summary:      `${tx.role} · ${verb} ${tx.shares.toLocaleString()} shares @ $${tx.pricePerShare.toFixed(2)} · Total $${(tx.totalValue / 1000).toFixed(0)}K`,
        source_url:   sourceUrl, published_at: tx.transactionDate, event_date: tx.transactionDate,
        raw_text: JSON.stringify({ form:'4', insiderName: tx.insiderName, insiderCik: tx.insiderCik,
          role: tx.role, transactionCode: tx.transactionCode, transactionDirection: tx.transactionDirection,
          shares: tx.shares, price: tx.pricePerShare, totalValue: tx.totalValue, adsh }),
      }, { onConflict: 'ticker,source_url', ignoreDuplicates: true })
    }
    inserted++
  }
  return { inserted, skipped: inserted === 0 ? 1 : 0 }
}

async function backfillTicker(ticker: string, cikStr: string): Promise<{ inserted: number; skipped: number; filings: number }> {
  await sleep(150)
  const subRes = await fetch(`https://data.sec.gov/submissions/CIK${padCik(cikStr)}.json`, { headers: SEC_HEADERS })
  if (!subRes.ok) throw new Error(`submissions fetch ${subRes.status} for ${ticker}`)
  const sub    = await subRes.json()
  const recent = sub.filings?.recent
  if (!recent) return { inserted: 0, skipped: 0, filings: 0 }

  const forms    = recent.form            as string[] ?? []
  const dates    = recent.filingDate      as string[] ?? []
  const adshList = recent.accessionNumber as string[] ?? []
  const docs     = recent.primaryDocument as string[] ?? []

  let inserted = 0, skipped = 0, filings = 0
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '4') continue
    if (dates[i] < CUTOFF_DATE) break
    const adsh = adshList[i]
    if (!adsh) { skipped++; continue }
    filings++
    await sleep(150)
    const r = await processFiling(ticker, parseInt(cikStr, 10), adsh, docs[i] ?? null, dates[i])
    inserted += r.inserted
    skipped  += r.skipped
  }
  return { inserted, skipped, filings }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []; let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
    else cur += ch
  }
  fields.push(cur.trim()); return fields
}

function saveProgress(done: Set<string>) {
  fs.mkdirSync(path.dirname(PROGRESS_PATH), { recursive: true })
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify([...done], null, 2))
}

async function main() {
  console.log(`R2000 backfill: ${CUTOFF_DATE} → today`)

  const done: Set<string> = fs.existsSync(PROGRESS_PATH)
    ? new Set(JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf-8')) as string[])
    : new Set()
  if (done.size) console.log(`Resuming — ${done.size} already done`)
  else           console.log('Starting fresh')

  const csvLines = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const hdrs     = parseCsvLine(csvLines[0])
  const colSym   = hdrs.indexOf('symbol')
  const tickers  = csvLines.slice(1).map(l => parseCsvLine(l)[colSym]).filter(Boolean)
  console.log(`${tickers.length} tickers to backfill\n`)

  console.log('Fetching SEC CIK map...')
  const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikRes.ok) { console.error('CIK fetch failed:', cikRes.status); process.exit(1) }
  const cikRaw: Record<string, { cik_str: string; ticker: string }> = await cikRes.json()
  const tickerToCik: Record<string, string> = {}
  for (const e of Object.values(cikRaw)) tickerToCik[e.ticker] = e.cik_str
  console.log(`CIK map: ${Object.keys(tickerToCik).length} entries\n`)

  let totalInserted = 0, totalSkipped = 0, totalFilings = 0, noCik = 0, failed = 0

  for (let i = 0; i < tickers.length; i++) {
    const symbol = tickers[i]
    const label  = `[${i + 1}/${tickers.length}] ${symbol.padEnd(8)}`

    if (done.has(symbol)) { process.stdout.write('.'); continue }

    const cikStr = tickerToCik[symbol]
    if (!cikStr) {
      console.log(`${label} no CIK — skipping`)
      noCik++; done.add(symbol); saveProgress(done); continue
    }

    try {
      const { inserted, skipped, filings } = await backfillTicker(symbol, cikStr)
      totalInserted += inserted; totalSkipped += skipped; totalFilings += filings
      console.log(`${label} ${filings} filings → ${inserted} inserted, ${skipped} skipped`)
    } catch (err: any) {
      console.log(`${label} ERROR: ${err.message}`)
      failed++; continue
    }
    done.add(symbol); saveProgress(done)
  }

  console.log('\n' + '─'.repeat(54))
  console.log(`Tickers processed  : ${done.size - noCik}`)
  console.log(`Filings processed  : ${totalFilings}`)
  console.log(`Rows inserted      : ${totalInserted}`)
  console.log(`Rows skipped/dedup : ${totalSkipped}`)
  console.log(`No CIK (foreign)   : ${noCik}`)
  console.log(`Errors (retryable) : ${failed}`)
  console.log('Done.')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
