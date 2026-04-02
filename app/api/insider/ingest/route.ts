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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function padCik(cik: string | number) {
  return String(cik).padStart(10, '0')
}

// ─── XML helpers ─────────────────────────────────────────────────────────────
// Form 4 XML uses two patterns:
//   Direct:  <rptOwnerName>COOK TIMOTHY D</rptOwnerName>
//   Nested:  <transactionShares><value>1000</value></transactionShares>

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
  isDirector: boolean
  isOfficer: boolean
  officerTitle: string | null
  role: string
  transactionDate: string
  transactionCode: string
  shares: number
  pricePerShare: number
  totalValue: number
  sharesOwnedAfter: number | null
}

function parseForm4(xml: string): ParsedTx[] {
  const insiderName  = directVal(xml, 'rptOwnerName') ?? 'Unknown'
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
    if (code !== 'P') continue   // open market purchases only

    const dateStr        = nestedVal(block, 'transactionDate')
    const sharesStr      = nestedVal(block, 'transactionShares')
    const priceStr       = nestedVal(block, 'transactionPricePerShare')
    const sharesAfterStr = nestedVal(block, 'sharesOwnedFollowingTransaction')

    const shares = sharesStr ? parseFloat(sharesStr) : 0
    const price  = priceStr  ? parseFloat(priceStr)  : 0

    if (!dateStr || shares <= 0 || price <= 0) continue
    if (shares * price < 10_000) continue   // skip trivial buys under $10k

    results.push({
      insiderName,
      isDirector,
      isOfficer,
      officerTitle,
      role,
      transactionDate: dateStr,
      transactionCode: code,
      shares,
      pricePerShare: price,
      totalValue: Math.round(shares * price * 100) / 100,
      sharesOwnedAfter: sharesAfterStr ? parseFloat(sharesAfterStr) : null,
    })
  }

  return results
}

// ─── filing index lookup ─────────────────────────────────────────────────────
// primaryDocument in submissions JSON points to the XSLT viewer (xslF345X0*),
// not the raw XML. We fetch index.json to find the real document.

async function findRawXmlUrl(cikInt: number, adshClean: string): Promise<string | null> {
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/index.json`
  const res = await fetch(indexUrl, { headers: SEC_HEADERS })
  if (!res.ok) return null

  const json = await res.json()
  const items: { name: string; href?: string }[] = json?.directory?.item ?? []

  const rawXml = items.find(
    (f) => f.name.toLowerCase().endsWith('.xml') && !f.name.toLowerCase().includes('xsl')
  )
  if (!rawXml) return null

  return `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${rawXml.name}`
}

// ─── per-ticker ingestion ─────────────────────────────────────────────────────

async function ingestTickerInsiders(
  ticker: string,
  cikStr: string,
  cutoffDate: string
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

    const adshClean = adsh.replace(/-/g, '')
    const cikInt    = parseInt(cikStr, 10)
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${adshClean}/${adsh}-index.htm`

    await sleep(100)

    const xmlUrl = await findRawXmlUrl(cikInt, adshClean)
    if (!xmlUrl) { skipped++; continue }

    await sleep(100)

    const xmlRes = await fetch(xmlUrl, { headers: SEC_HEADERS })
    if (!xmlRes.ok) { skipped++; continue }

    const xml = await xmlRes.text()

    if (!xml.includes('<ownershipDocument') && !xml.includes('<rptOwnerName')) {
      skipped++
      continue
    }

    const transactions = parseForm4(xml)
    if (transactions.length === 0) { skipped++; continue }

    for (const tx of transactions) {
      const payload = {
        ticker,
        insider_name:       tx.insiderName,
        role:               tx.role,
        is_director:        tx.isDirector,
        is_officer:         tx.isOfficer,
        officer_title:      tx.officerTitle,
        transaction_date:   tx.transactionDate,
        transaction_code:   tx.transactionCode,
        shares:             tx.shares,
        price_per_share:    tx.pricePerShare,
        total_value:        tx.totalValue,
        shares_owned_after: tx.sharesOwnedAfter,
        accession_number:   adsh,
        filed_date:         dates[i],
        source_url:         sourceUrl,
      }

      const { error: insertErr } = await supabase
        .from('insider_transactions')
        .insert([payload])

      if (insertErr) continue

      await supabase.from('events').upsert({
        ticker,
        event_type:   'insider',
        title:        `${tx.insiderName} purchased ${tx.shares.toLocaleString()} shares of ${ticker}`,
        summary:      `${tx.role} · ${tx.shares.toLocaleString()} shares @ $${tx.pricePerShare.toFixed(2)} · Total $${(tx.totalValue / 1000).toFixed(0)}K`,
        source_url:   sourceUrl,
        published_at: tx.transactionDate,
        event_date:   tx.transactionDate,
        raw_text:     JSON.stringify({
          form:            '4',
          insiderName:     tx.insiderName,
          role:            tx.role,
          transactionCode: tx.transactionCode,
          shares:          tx.shares,
          price:           tx.pricePerShare,
          totalValue:      tx.totalValue,
          adsh,
        }),
      }, { onConflict: 'ticker,source_url', ignoreDuplicates: true })

      inserted++
    }
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
    .select('symbol')
    .order('market_cap', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const symbols   = (tickerRows ?? []).map((r: any) => r.symbol as string)
  const symbolSet = new Set(symbols)

  const cikRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikRes.ok) return NextResponse.json({ error: 'Failed to fetch CIK map' }, { status: 502 })

  const cikRaw: Record<string, { cik_str: string; ticker: string }> = await cikRes.json()
  const tickerToCik: Record<string, string> = {}
  for (const entry of Object.values(cikRaw)) {
    if (symbolSet.has(entry.ticker)) tickerToCik[entry.ticker] = entry.cik_str
  }

  const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const allEntries = Object.entries(tickerToCik)
  const entries    = singleTicker
    ? allEntries.filter(([t]) => t === singleTicker)
    : allEntries

  if (singleTicker && entries.length === 0) {
    return NextResponse.json({ error: `Ticker ${singleTicker} not found in CIK map` }, { status: 404 })
  }

  let totalInserted = 0
  let totalSkipped  = 0
  let failed        = 0

  for (let i = 0; i < entries.length; i += 5) {
    const batch = entries.slice(i, i + 5)

    const results = await Promise.allSettled(
      batch.map(([ticker, cikStr]) => ingestTickerInsiders(ticker, cikStr, cutoffDate))
    )

    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalInserted += r.value.inserted
        totalSkipped  += r.value.skipped
      } else {
        failed++
      }
    }

    if (i + 5 < entries.length) await sleep(1000)
  }

  return NextResponse.json({
    total:    entries.length,
    inserted: totalInserted,
    skipped:  totalSkipped,
    failed,
  })
}
