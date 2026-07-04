import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const SEC_HEADERS = {
  'User-Agent': 'Sentra Signals contact@sentra.com',
  Accept: 'application/json',
}

function padCik(cik: number | string) {
  return String(cik).padStart(10, '0')
}

function filingUrl(cikStr: string, adsh: string) {
  const adshClean = adsh.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(cikStr, 10)}/${adshClean}/${adsh}-index.htm`
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function ingestSecTicker(ticker: string, cikStr: string, thirtyDaysAgo: string): Promise<void> {
  const subRes = await fetch(
    `https://data.sec.gov/submissions/CIK${padCik(cikStr)}.json`,
    { headers: SEC_HEADERS }
  )
  if (!subRes.ok) throw new Error(`HTTP ${subRes.status} for ${ticker}`)

  const sub = await subRes.json()
  const recent = sub.filings?.recent
  if (!recent) return

  const forms: string[]    = recent.form ?? []
  const dates: string[]    = recent.filingDate ?? []
  const adshList: string[] = recent.accessionNumber ?? []
  const itemsList: string[][] = recent.items ?? []

  const events: any[] = []
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== '8-K') continue
    if (dates[i] < thirtyDaysAgo) break
    const adsh = adshList[i]
    const itemSummary = itemsList[i]?.length
      ? `Filing items: ${Array.isArray(itemsList[i]) ? itemsList[i].join(', ') : itemsList[i]}`
      : null
    events.push({
      ticker,
      event_type: 'sec_filing',
      title: `8-K — ${sub.name ?? ticker}`,
      summary: itemSummary,
      source_url: filingUrl(cikStr, adsh),
      published_at: dates[i],
      raw_text: JSON.stringify({ form: forms[i], adsh, fileDate: dates[i], items: itemsList[i] }),
    })
  }

  if (events.length === 0) return

  const urls = events.map((e) => e.source_url).filter(Boolean)
  const { data: existing } = await supabase.from('events').select('source_url').in('source_url', urls)
  const existingUrls = new Set((existing ?? []).map((e: any) => e.source_url))
  const newEvents = events.filter((e) => !existingUrls.has(e.source_url))

  if (newEvents.length > 0) {
    await supabase.from('events').insert(newEvents)
  }
}

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  const { data: rows, error } = await supabase
    .from('tickers')
    .select('symbol')
    .order('market_cap', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const symbols = (rows ?? []).map((r: any) => r.symbol as string)

  const cikMapRes = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!cikMapRes.ok) return NextResponse.json({ error: 'Failed to fetch company_tickers.json' }, { status: 502 })

  const cikMapRaw: Record<string, { cik_str: string; ticker: string }> = await cikMapRes.json()
  const tickerToCik: Record<string, string> = {}
  const symbolSet = new Set(symbols)
  for (const entry of Object.values(cikMapRaw)) {
    if (symbolSet.has(entry.ticker)) tickerToCik[entry.ticker] = entry.cik_str
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const entries = Object.entries(tickerToCik)
  let success = 0
  let failed = 0

  for (let i = 0; i < entries.length; i += 3) {
    const batch = entries.slice(i, i + 3)
    const results = await Promise.allSettled(
      batch.map(([ticker, cikStr]) => ingestSecTicker(ticker, cikStr, thirtyDaysAgo))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') success++
      else failed++
    }
    if (i + 3 < entries.length) await sleep(2000)
  }

  failed += symbols.length - entries.length
  return NextResponse.json({ total: symbols.length, success, failed })
}
