import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const SEC_HEADERS = {
  'User-Agent': 'Sentra Intelligence contact@sentra.com',
  Accept: 'application/json',
}

// Pad CIK to 10 digits as required by data.sec.gov
function padCik(cik: number | string) {
  return String(cik).padStart(10, '0')
}

// Build a direct link to the filing index on SEC.gov
function filingUrl(cikStr: string, adsh: string) {
  const adshClean = adsh.replace(/-/g, '')
  return `https://www.sec.gov/Archives/edgar/data/${parseInt(cikStr, 10)}/${adshClean}/${adsh}-index.htm`
}

export async function GET() {
  try {
    // 1. Load our tracked tickers from Supabase
    const { data: trackedRows, error: tickerErr } = await supabase
      .from('tickers')
      .select('symbol')
    if (tickerErr) return NextResponse.json({ error: tickerErr.message }, { status: 500 })
    const trackedSet = new Set((trackedRows ?? []).map((r: any) => r.symbol as string))

    // 2. Fetch EDGAR's full ticker→CIK map (cached ~daily by SEC)
    const cikMapRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: SEC_HEADERS,
    })
    if (!cikMapRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch company_tickers.json' }, { status: 500 })
    }
    const cikMapRaw: Record<string, { cik_str: string; ticker: string; title: string }> =
      await cikMapRes.json()

    // Build { "AAPL": "0000320193", ... } for only our tracked tickers
    const tickerToCik: Record<string, string> = {}
    for (const entry of Object.values(cikMapRaw)) {
      if (trackedSet.has(entry.ticker)) {
        tickerToCik[entry.ticker] = entry.cik_str
      }
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0]

    // 3. Fetch recent filings for each tracked ticker in parallel
    const results = await Promise.allSettled(
      Object.entries(tickerToCik).map(async ([ticker, cikStr]) => {
        const subRes = await fetch(
          `https://data.sec.gov/submissions/CIK${padCik(cikStr)}.json`,
          { headers: SEC_HEADERS }
        )
        if (!subRes.ok) return []

        const sub = await subRes.json()
        const recent = sub.filings?.recent
        if (!recent) return []

        const forms: string[] = recent.form ?? []
        const dates: string[] = recent.filingDate ?? []
        const adshList: string[] = recent.accessionNumber ?? []
        const itemsList: string[][] = recent.items ?? []

        const events: any[] = []
        for (let i = 0; i < forms.length; i++) {
          if (forms[i] !== '8-K') continue
          if (dates[i] < thirtyDaysAgo) continue // arrays are newest-first, so safe to stop early here

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
        return events
      })
    )

    const allEvents = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))

    if (allEvents.length === 0) {
      return NextResponse.json({
        message: `No 8-K filings found in the last 30 days for tracked tickers`,
        trackedWithCik: Object.keys(tickerToCik),
        since: thirtyDaysAgo,
      })
    }

    // 4. Deduplicate against existing events by source_url
    const urls = allEvents.map((e) => e.source_url).filter(Boolean)
    const { data: existing } = await supabase
      .from('events')
      .select('source_url')
      .in('source_url', urls)
    const existingUrls = new Set((existing ?? []).map((e: any) => e.source_url))
    const newEvents = allEvents.filter((e) => !existingUrls.has(e.source_url))

    if (newEvents.length === 0) {
      return NextResponse.json({
        message: 'All recent 8-K filings already ingested',
        count: 0,
        totalFound: allEvents.length,
      })
    }

    const { error: insertErr } = await supabase.from('events').insert(newEvents)
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    return NextResponse.json({
      message: `Ingested ${newEvents.length} new SEC 8-K filings (last 30 days)`,
      count: newEvents.length,
      skippedDuplicates: allEvents.length - newEvents.length,
      sample: newEvents.slice(0, 5),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
