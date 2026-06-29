import type { SupabaseClient } from '@supabase/supabase-js'
import { isIssuerBuyback } from '@/lib/insiderBuybackDetector'

export const SEC_HEADERS = {
  'User-Agent': 'Sentra contact@sentra.com',
  Accept: 'application/json, text/xml, */*',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

export function padCik(cik: string | number) {
  return String(cik).padStart(10, '0')
}

// ─── XML helpers ─────────────────────────────────────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

export function directVal(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>\\s*([^<]+?)\\s*<\\/${tag}>`, 'i'))
  return m?.[1] ? decodeEntities(m[1].trim()) : null
}

export function nestedVal(xml: string, outer: string): string | null {
  const block = xml.match(new RegExp(`<${outer}[^>]*>([\\s\\S]*?)<\\/${outer}>`, 'i'))
  if (!block) return null
  return directVal(block[1], 'value')
}

export function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi')
  return xml.match(re) ?? []
}

// ─── Form 4 parser ────────────────────────────────────────────────────────────

export type ParsedTx = {
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

// Returns true if the transaction was executed under a pre-arranged 10b5-1 plan.
export function detectPlanSale(block: string, xml: string, code: string): boolean {
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

export function parseForm4(xml: string): ParsedTx[] {
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
    if (!code) continue

    const dateStr        = nestedVal(block, 'transactionDate')
    const sharesStr      = nestedVal(block, 'transactionShares')
    const priceStr       = nestedVal(block, 'transactionPricePerShare')
    const sharesAfterStr = nestedVal(block, 'sharesOwnedFollowingTransaction')

    const shares = sharesStr ? parseFloat(sharesStr) : 0
    const price  = priceStr  ? parseFloat(priceStr)  : 0

    if (!dateStr) continue

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

// ─── Filing helpers ───────────────────────────────────────────────────────────

export async function findRawXmlUrl(cikInt: number, adshClean: string): Promise<string | null> {
  const res = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/index.json`,
    { headers: SEC_HEADERS }
  )
  if (!res.ok) return null
  const items: { name: string }[] = (await res.json())?.directory?.item ?? []
  const f = items.find((i) => i.name.toLowerCase().endsWith('.xml') && !i.name.toLowerCase().includes('xsl'))
  return f ? `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${f.name}` : null
}

export async function processFiling(
  ticker: string,
  cikInt: number,
  adsh: string,
  primaryDoc: string | null,
  filedDate: string,
  hqState: string | null = null,
  companyName: string | null = null,
  supabase: SupabaseClient,
): Promise<{ inserted: number; skipped: number }> {
  const adshClean = adsh.replace(/-/g, '')
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${adsh}-index.htm`

  // Strip SEC's XSLT renderer path prefix so we hit raw XML, not the HTML viewer.
  const cleanDoc  = primaryDoc?.replace(/^xsl[^/]+\//i, '') ?? null
  const isHtmlDoc = cleanDoc && /\.html?$/i.test(cleanDoc)

  let xmlUrl: string | null
  if (isHtmlDoc || !cleanDoc) {
    xmlUrl = await findRawXmlUrl(cikInt, adshClean)
  } else {
    xmlUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${cleanDoc}`
  }

  if (!xmlUrl) {
    console.log(`skip ${ticker}: no xml url (adsh=${adsh} primaryDoc=${primaryDoc})`)
    return { inserted: 0, skipped: 1 }
  }

  await sleep(20)

  const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
  if (!xmlRes.ok) {
    console.log(`skip ${ticker}: xml fetch failed ${xmlRes.status} url=${xmlUrl}`)
    return { inserted: 0, skipped: 1 }
  }

  const xml = await xmlRes.text()

  if (!xml.includes('<ownershipDocument') && !xml.includes('<rptOwnerName')) {
    console.log(`skip ${ticker}: not an ownership document (adsh=${adsh})`)
    return { inserted: 0, skipped: 1 }
  }

  const allTxBlocks = allBlocks(xml, 'nonDerivativeTransaction')
  const transactions = parseForm4(xml)

  if (transactions.length === 0) {
    const codes = allTxBlocks.map((b) => directVal(b, 'transactionCode')).filter(Boolean)
    console.log(`skip ${ticker}: 0 transactions parsed (${allTxBlocks.length} nonDerivative blocks, codes=[${codes.join(',')}]) adsh=${adsh}`)
    return { inserted: 0, skipped: 1 }
  }

  let inserted = 0

  const cutoffMs = Date.now() + 7 * 24 * 60 * 60 * 1000

  for (const tx of transactions) {
    if (new Date(tx.transactionDate).getTime() > cutoffMs) {
      console.log(`skip ${ticker}: implausible future date ${tx.transactionDate} (adsh=${adsh})`)
      continue
    }

    if (tx.isPlanSale) {
      console.log(`inserting ${ticker}: plan sale stored but no event (adsh=${adsh} insider=${tx.insiderName} dir=${tx.transactionDirection})`)
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
        console.log(`skip ${ticker}: duplicate already in db (adsh=${adsh} insider=${tx.insiderCik} date=${tx.transactionDate} shares=${tx.shares})`)
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
      is_issuer_buyback:     isIssuerBuyback(tx.insiderName, companyName),
      accession_number:      adsh,
      filed_date:            filedDate,
      source_url:            sourceUrl,
    }

    const { error: insertErr } = await supabase
      .from('insider_transactions')
      .insert([payload])

    if (insertErr) {
      console.log(`skip ${ticker}: db insert error — ${insertErr.message} (adsh=${adsh})`)
      continue
    }

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

// ─── Targeted per-CIK fetcher ────────────────────────────────────────────────

export type FeedEntry = { cik: number; adsh: string; primaryDoc: string | null; filedDate: string }

export async function fetchFilingsForCiks(
  ciks: number[],
  cikToTicker: Record<number, string>,
  today: string,
): Promise<FeedEntry[]> {
  const results: FeedEntry[] = []

  for (const cikInt of ciks) {
    await sleep(150)
    const res = await fetch(
      `https://data.sec.gov/submissions/CIK${padCik(cikInt)}.json`,
      { headers: SEC_HEADERS },
    )
    if (!res.ok) {
      console.log(`[ingest] submissions fetch failed for CIK ${cikInt} (${cikToTicker[cikInt]}): ${res.status}`)
      continue
    }

    const sub    = await res.json()
    const recent = sub.filings?.recent
    if (!recent) continue

    const forms:    string[] = recent.form            ?? []
    const dates:    string[] = recent.filingDate      ?? []
    const adshList: string[] = recent.accessionNumber ?? []
    const docs:     string[] = recent.primaryDocument ?? []

    for (let i = 0; i < forms.length; i++) {
      if (dates[i] < today) break
      if (forms[i] !== '4')   continue
      if (dates[i] !== today) continue
      const adsh = adshList[i]
      if (!adsh) continue
      results.push({ cik: cikInt, adsh, primaryDoc: docs[i] ?? null, filedDate: dates[i] })
    }
  }

  return results
}

// ─── Single-ticker fallback (for ?ticker= manual testing) ────────────────────

export async function ingestTickerInsiders(
  ticker: string,
  cikStr: string,
  cutoffDate: string,
  hqState: string | null = null,
  companyName: string | null = null,
  supabase: SupabaseClient,
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

    const result = await processFiling(ticker, parseInt(cikStr, 10), adsh, null, dates[i], hqState, companyName, supabase)
    inserted += result.inserted
    skipped  += result.skipped
  }

  return { inserted, skipped }
}

// ─── Ticker + CIK map loaders ─────────────────────────────────────────────────

export type TickerMeta = {
  symbol: string
  hqState: string | null
  companyName: string | null
}

export async function loadTickerMeta(supabase: SupabaseClient): Promise<TickerMeta[]> {
  const PAGE = 1000
  const rows: TickerMeta[] = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('tickers')
      .select('symbol, hq_state, name')
      .range(offset, offset + PAGE - 1)
      .order('symbol')

    if (error) throw new Error(`Failed to load tickers: ${error.message}`)
    if (!data || data.length === 0) break

    for (const r of data as any[]) {
      rows.push({
        symbol:      r.symbol,
        hqState:     r.hq_state  ?? null,
        companyName: r.name      ?? null,
      })
    }

    offset += data.length
    if (data.length < PAGE) break
  }

  return rows
}

export async function loadCikMap(
  symbolSet: Set<string>,
): Promise<{ tickerToCik: Record<string, string>; cikToTicker: Record<number, string> }> {
  const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikRes.ok) throw new Error(`Failed to fetch SEC CIK map: ${cikRes.status}`)

  const cikRaw: Record<string, { cik_str: string; ticker: string }> = await cikRes.json()

  const tickerToCik: Record<string, string> = {}
  const cikToTicker: Record<number, string> = {}

  for (const entry of Object.values(cikRaw)) {
    if (symbolSet.has(entry.ticker)) {
      tickerToCik[entry.ticker] = entry.cik_str
      cikToTicker[parseInt(entry.cik_str, 10)] = entry.ticker
    }
  }

  return { tickerToCik, cikToTicker }
}

// ─── Core orchestration ───────────────────────────────────────────────────────

export type DayResult = {
  date: string
  total_fetched: number
  processed: number
  inserted: number
  skipped: number
  failed: number
  error?: string
}

export type IngestOptions = {
  /** Process only this date instead of the rolling window. */
  date?: string
  /** Process a date range (inclusive). Overrides `date`. */
  startDate?: string
  endDate?: string
  /** Restrict to a slice of CIKs: 0-indexed batch out of batchCount. */
  batch?: number
  batchCount?: number
}

export async function runDailyIngest(
  supabase: SupabaseClient,
  options: IngestOptions = {},
): Promise<{ days: DayResult[]; totals: { inserted: number; skipped: number; failed: number } }> {
  const tickerMeta = await loadTickerMeta(supabase)
  const symbolSet  = new Set(tickerMeta.map((t) => t.symbol))

  const tickerToHqState:   Record<string, string | null> = {}
  const tickerToName:      Record<string, string | null> = {}
  for (const t of tickerMeta) {
    tickerToHqState[t.symbol] = t.hqState
    tickerToName[t.symbol]    = t.companyName
  }

  const { cikToTicker } = await loadCikMap(symbolSet)

  async function processDay(dateStr: string): Promise<DayResult> {
    let allCiks = Object.keys(cikToTicker).map(Number)

    if (options.batch !== undefined && options.batchCount !== undefined) {
      const size = Math.ceil(allCiks.length / options.batchCount)
      allCiks = allCiks.slice(options.batch * size, (options.batch + 1) * size)
    }

    let entries: FeedEntry[]
    try {
      entries = await fetchFilingsForCiks(allCiks, cikToTicker, dateStr)
    } catch (err: any) {
      return { date: dateStr, total_fetched: 0, processed: 0, inserted: 0, skipped: 0, failed: 0, error: err.message ?? 'CIK fetch failed' }
    }

    let inserted = 0
    let skipped  = 0
    let failed   = 0

    for (const entry of entries) {
      const ticker      = cikToTicker[entry.cik]
      const hqState     = tickerToHqState[ticker] ?? null
      const companyName = tickerToName[ticker]    ?? null
      try {
        await sleep(150)
        const result = await processFiling(ticker, entry.cik, entry.adsh, entry.primaryDoc, entry.filedDate, hqState, companyName, supabase)
        inserted += result.inserted
        skipped  += result.skipped
      } catch (err: any) {
        console.log(`[ingest] error processing filing ${entry.adsh} (${ticker}): ${err.message}`)
        failed++
      }
    }

    return { date: dateStr, total_fetched: entries.length, processed: entries.length, inserted, skipped, failed }
  }

  // Build the list of dates to process
  let days: string[]

  if (options.startDate && options.endDate) {
    days = []
    for (const d = new Date(options.startDate); d.toISOString().split('T')[0] <= options.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().split('T')[0])
    }
  } else if (options.date) {
    days = [options.date]
  } else {
    // Rolling 5-day window: insiders have a 2-day filing lag, and weekends/holidays
    // create gaps. The dedup in processFiling makes re-processing safe.
    const todayStr    = new Date().toISOString().split('T')[0]
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    days = []
    for (const d = new Date(fiveDaysAgo); d.toISOString().split('T')[0] <= todayStr; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().split('T')[0])
    }
  }

  const results: DayResult[] = []
  for (const day of days) {
    results.push(await processDay(day))
  }

  const totals = results.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.inserted,
      skipped:  acc.skipped  + r.skipped,
      failed:   acc.failed   + r.failed,
    }),
    { inserted: 0, skipped: 0, failed: 0 },
  )

  return { days: results, totals }
}
