import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const SEC_HEADERS = {
  'User-Agent': 'Sentra contact@sentra.com',
  Accept: 'application/json, text/xml, */*',
}

const XML_FETCH_CAP = 200

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function padCik(cik: string | number) {
  return String(cik).padStart(10, '0')
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

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

// ─── Form 4 parser ────────────────────────────────────────────────────────────

type ParsedTx = {
  insiderName: string
  insiderCik: string | null
  insiderState: string | null
  isDirector: boolean
  isOfficer: boolean
  officerTitle: string | null
  role: string
  transactionDate: string
  transactionCode: string
  transactionDirection: string
  shares: number
  pricePerShare: number
  totalValue: number
  sharesOwnedAfter: number | null
  isPlanSale: boolean
}

// Returns true if the transaction block was executed under a pre-arranged 10b5-1 plan.
// Primary signal: <planName> or <transactionPlanName> tags contain any text value.
// Secondary signal (sells only): a referenced footnote contains the string "10b5-1".
function detectPlanSale(block: string, xml: string, code: string): boolean {
  // <planName> can be direct text or wrapped in <value> — check both
  const planNameDirect = directVal(block, 'planName')
  const planNameNested = nestedVal(block, 'transactionPlanName')
  if ((planNameDirect && planNameDirect.trim().length > 0) ||
      (planNameNested && planNameNested.trim().length > 0)) {
    return true
  }

  // For sell transactions, resolve footnote references and check for "10b5-1" text
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

function parseForm4(xml: string): ParsedTx[] {
  const insiderName  = directVal(xml, 'rptOwnerName') ?? 'Unknown'
  const insiderCik   = directVal(xml, 'rptOwnerCik') ?? null
  const insiderState = directVal(xml, 'rptOwnerState') ?? null
  const isDirector   = directVal(xml, 'isDirector') === '1'
  const isOfficer    = directVal(xml, 'isOfficer') === '1'
  const officerTitle = directVal(xml, 'officerTitle')
  const is10Pct      = directVal(xml, 'isTenPercentOwner') === '1'

  const role = officerTitle
    ?? (isDirector ? 'Director' : null)
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
    if (shares * price < 100_000) continue

    const isPlanSale = detectPlanSale(block, xml, code)

    results.push({
      insiderName,
      insiderCik,
      insiderState,
      isDirector,
      isOfficer,
      officerTitle,
      role,
      transactionDate: dateStr,
      transactionCode: code,
      transactionDirection: code === 'P' ? 'buy' : 'sell',
      shares,
      pricePerShare: price,
      totalValue: Math.round(shares * price * 100) / 100,
      sharesOwnedAfter: sharesAfterStr ? parseFloat(sharesAfterStr) : null,
      isPlanSale,
    })
  }

  return results
}

// ─── process a single filing ─────────────────────────────────────────────────

let skipLogCount = 0

async function findRawXmlUrl(cikInt: number, adshClean: string): Promise<string | null> {
  const res = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/index.json`,
    { headers: SEC_HEADERS }
  )
  if (!res.ok) return null
  const items: { name: string }[] = (await res.json())?.directory?.item ?? []
  const f = items.find((i) => i.name.toLowerCase().endsWith('.xml') && !i.name.toLowerCase().includes('xsl'))
  return f ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${f.name}` : null
}

async function processFiling(
  ticker: string,
  cikInt: number,
  adsh: string,
  primaryDoc: string | null,
  filedDate: string,
  hqState: string | null = null
): Promise<{ inserted: number; skipped: number }> {
  const adshClean = adsh.replace(/-/g, '')
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${adsh}-index.htm`

  const xmlUrl = primaryDoc
    ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${primaryDoc}`
    : await findRawXmlUrl(cikInt, adshClean)
  if (!xmlUrl) return { inserted: 0, skipped: 1 }

  await sleep(20)

  const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
  if (!xmlRes.ok) return { inserted: 0, skipped: 1 }

  const xml = await xmlRes.text()

  if (!xml.includes('<ownershipDocument') && !xml.includes('<rptOwnerName')) {
    return { inserted: 0, skipped: 1 }
  }

  const allTxBlocks = allBlocks(xml, 'nonDerivativeTransaction')
  const codes = allTxBlocks.map((b) => directVal(b, 'transactionCode')).filter(Boolean)

  const transactions = parseForm4(xml)
  if (transactions.length === 0) {
    if (skipLogCount < 5) {
      skipLogCount++
      const reasons = allTxBlocks.length === 0
        ? 'no nonDerivativeTx blocks'
        : allTxBlocks.map((block) => {
            const code = directVal(block, 'transactionCode')
            if (code !== 'P' && code !== 'S') return `code=${code}`
            const shares = parseFloat(nestedVal(block, 'transactionShares') ?? '0')
            const price  = parseFloat(nestedVal(block, 'transactionPricePerShare') ?? '0')
            if (shares <= 0 || price <= 0) return `missing shares/price`
            return `under $100k ($${Math.round(shares * price).toLocaleString()})`
          }).join(' | ')
      console.log(`[skip] ${ticker} ${adsh} — codes: [${codes.join(', ')}] — ${reasons}`)
    }
    return { inserted: 0, skipped: 1 }
  }

  let inserted = 0

  for (const tx of transactions) {
    if (tx.isPlanSale) {
      console.log(`[skip] plan sale detected — ${adsh} — ${tx.insiderName} ${tx.transactionDirection} ${ticker}`)
    }

    // Deduplication: amended filings (Form 4/A) get new accession numbers but describe
    // the same underlying trade. Skip if an identical row already exists.
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

      if (existing) {
        console.log(`[skip] duplicate trade detected — ${adsh} — ${ticker}`)
        continue
      }
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

    const { error: insertErr } = await supabase
      .from('insider_transactions')
      .insert([payload])

    if (insertErr) continue

    // Plan sales are stored for auditing but do not generate signal events
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
        form:                 '4',
        insiderName:          tx.insiderName,
        insiderCik:           tx.insiderCik,
        role:                 tx.role,
        transactionCode:      tx.transactionCode,
        transactionDirection: tx.transactionDirection,
        shares:               tx.shares,
        price:                tx.pricePerShare,
        totalValue:           tx.totalValue,
        adsh,
      }),
    }, { onConflict: 'ticker,source_url', ignoreDuplicates: true })

    inserted++
  }

  return { inserted, skipped: inserted === 0 ? 1 : 0 }
}

// ─── EDGAR full-text search fetcher ─────────────────────────────────────────
// Returns only filings for tracked tickers, capped at XML_FETCH_CAP entries.

type FeedEntry = { cik: number; adsh: string; primaryDoc: string; filedDate: string }

async function fetchTodaysForm4s(today: string, cikToTicker: Record<number, string>): Promise<FeedEntry[]> {
  const base = `https://efts.sec.gov/LATEST/search-index?forms=4&dateRange=custom&startdt=${today}&enddt=${today}`
  const PAGE_SIZE = 50
  const results: FeedEntry[] = []

  function extractHits(json: any): boolean {
    // Returns true if we hit the cap and should stop paginating
    const hits: any[] = json?.hits?.hits ?? []
    for (const hit of hits) {
      if (results.length >= XML_FETCH_CAP) return true

      // _id format: "0001234567-24-000001:somefile.xml"
      const rawId     = (hit._id as string | undefined) ?? ''
      const [adsh, primaryDoc] = rawId.split(':')
      if (!adsh || !primaryDoc) continue

      const src       = hit._source ?? {}
      const filedDate: string = src.file_date ?? today

      // "ciks" is an array of zero-padded CIK strings; find first that matches our tickers
      const cikList: string[] = Array.isArray(src.ciks) ? src.ciks : []
      let cik = 0
      for (const c of cikList) {
        const parsed = parseInt(c, 10)
        if (cikToTicker[parsed]) { cik = parsed; break }
      }
      if (!cik) continue

      results.push({ cik, adsh, primaryDoc, filedDate })
    }
    return results.length >= XML_FETCH_CAP
  }

  const firstRes = await fetch(`${base}&from=0&size=${PAGE_SIZE}`, { headers: SEC_HEADERS })
  if (!firstRes.ok) throw new Error(`EDGAR search failed: ${firstRes.status}`)

  const firstJson = await firstRes.json()
  const total: number = firstJson?.hits?.total?.value ?? 0
  const capped = extractHits(firstJson)

  if (!capped) {
    const pages = Math.ceil(total / PAGE_SIZE)
    for (let page = 1; page < pages; page++) {
      await sleep(200)
      const res = await fetch(`${base}&from=${page * PAGE_SIZE}&size=${PAGE_SIZE}`, { headers: SEC_HEADERS })
      if (!res.ok) break
      if (extractHits(await res.json())) break
    }
  }

  return results
}

// ─── single-ticker fallback (for ?ticker= manual testing) ────────────────────

async function ingestTickerInsiders(
  ticker: string,
  cikStr: string,
  cutoffDate: string,
  hqState: string | null = null
): Promise<{ inserted: number; skipped: number }> {
  const subRes = await fetch(
    `https://data.sec.gov/submissions/CIK${padCik(cikStr)}.json`,
    { headers: SEC_HEADERS }
  )
  if (!subRes.ok) throw new Error(`submissions ${subRes.status} for ${ticker}`)

  const sub    = await subRes.json()
  const recent = sub.filings?.recent
  if (!recent) return { inserted: 0, skipped: 0 }

  const forms:    string[] = recent.form            ?? []
  const dates:    string[] = recent.filingDate      ?? []
  const adshList: string[] = recent.accessionNumber ?? []

  let inserted = 0
  let skipped  = 0

  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '4') continue
    if (dates[i] < cutoffDate) break

    const adsh = adshList[i]
    if (!adsh) { skipped++; continue }

    await sleep(150)

    const result = await processFiling(ticker, parseInt(cikStr, 10), adsh, null, dates[i], hqState)
    inserted += result.inserted
    skipped  += result.skipped
  }

  return { inserted, skipped }
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  const { searchParams } = new URL(req.url)
  const singleTicker = searchParams.get('ticker')?.toUpperCase() ?? null

  const { data: tickerRows, error } = await supabase
    .from('tickers')
    .select('symbol, hq_state')
    .order('market_cap', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const symbolSet      = new Set((tickerRows ?? []).map((r: any) => r.symbol as string))
  const tickerToHqState: Record<string, string | null> = {}
  for (const r of tickerRows ?? []) {
    tickerToHqState[(r as any).symbol] = (r as any).hq_state ?? null
  }

  const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikRes.ok) return NextResponse.json({ error: 'Failed to fetch CIK map' }, { status: 502 })

  const cikRaw: Record<string, { cik_str: string; ticker: string }> = await cikRes.json()

  const tickerToCik: Record<string, string> = {}
  const cikToTicker: Record<number, string> = {}
  for (const entry of Object.values(cikRaw)) {
    if (symbolSet.has(entry.ticker)) {
      tickerToCik[entry.ticker] = entry.cik_str
      cikToTicker[parseInt(entry.cik_str, 10)] = entry.ticker
    }
  }

  // ── single-ticker mode ────────────────────────────────────────────────────
  if (singleTicker) {
    const cikStr = tickerToCik[singleTicker]
    if (!cikStr) {
      return NextResponse.json({ error: `Ticker ${singleTicker} not found in CIK map` }, { status: 404 })
    }
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const hqState    = tickerToHqState[singleTicker] ?? null
    const { inserted, skipped } = await ingestTickerInsiders(singleTicker, cikStr, cutoffDate, hqState)
    return NextResponse.json({ ticker: singleTicker, inserted, skipped })
  }

  // ── full-text search mode (normal cron path) ─────────────────────────────
  const batchParam = searchParams.get('batch')
  const batch      = batchParam !== null ? Math.max(0, Math.min(3, parseInt(batchParam, 10))) : null
  const BATCH_SIZE = 50

  async function processDay(date: string): Promise<{
    date: string; total_fetched: number; processed: number; inserted: number; skipped: number; failed: number; error?: string
  }> {
    let entries: FeedEntry[]
    try {
      entries = await fetchTodaysForm4s(date, cikToTicker)
    } catch (err: any) {
      return { date, total_fetched: 0, processed: 0, inserted: 0, skipped: 0, failed: 0, error: err.message ?? 'Search fetch failed' }
    }

    const slice = batch !== null
      ? entries.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE)
      : entries

    let inserted = 0
    let skipped  = 0
    let failed   = 0

    for (const entry of slice) {
      const ticker  = cikToTicker[entry.cik]
      const hqState = tickerToHqState[ticker] ?? null
      try {
        await sleep(150)
        const result = await processFiling(ticker, entry.cik, entry.adsh, entry.primaryDoc, entry.filedDate, hqState)
        inserted += result.inserted
        skipped  += result.skipped
      } catch {
        failed++
      }
    }

    return { date, total_fetched: entries.length, processed: slice.length, inserted, skipped, failed }
  }

  // ── date range backfill mode ──────────────────────────────────────────────
  const startDateParam = searchParams.get('start_date')
  const endDateParam   = searchParams.get('end_date')

  if (startDateParam && endDateParam) {
    const start = new Date(startDateParam)
    const end   = new Date(endDateParam)
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      return NextResponse.json({ error: 'Invalid start_date or end_date' }, { status: 400 })
    }

    const days: string[] = []
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().split('T')[0])
    }

    const results = []
    for (const day of days) {
      results.push(await processDay(day))
    }

    const totals = results.reduce(
      (acc, r) => ({
        inserted: acc.inserted + r.inserted,
        skipped:  acc.skipped  + r.skipped,
        failed:   acc.failed   + r.failed,
      }),
      { inserted: 0, skipped: 0, failed: 0 }
    )

    return NextResponse.json({ batch, days: results, totals })
  }

  // ── single-day mode ───────────────────────────────────────────────────────
  const today  = searchParams.get('date') ?? new Date().toISOString().split('T')[0]
  const result = await processDay(today)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 502 })

  return NextResponse.json({
    date:          result.date,
    total_fetched: result.total_fetched,
    batch,
    processed:     result.processed,
    inserted:      result.inserted,
    skipped:       result.skipped,
    failed:        result.failed,
  })
}
