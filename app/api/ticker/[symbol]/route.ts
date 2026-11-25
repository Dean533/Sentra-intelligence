import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getQuote, getCompanyFacts } from '@/lib/yahoo'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  // Ticker row, then (as soon as its sector is known) same-sector related tickers,
  // running alongside the Yahoo calls instead of after them.
  const tickerAndRelated = (async () => {
    const { data: ticker } = await supabase.from('tickers').select('*').eq('symbol', symbol).single()
    let related: Record<string, unknown>[] = []
    if (ticker?.sector) {
      const { data } = await supabase
        .from('tickers')
        .select('symbol, name, sector, market_cap')
        .eq('sector', ticker.sector)
        .neq('symbol', symbol)
        .limit(5)
      related = data ?? []
    }
    return { ticker, related }
  })()

  const [quoteResult, summaryResult, tickerResult, eventsResult] =
    await Promise.allSettled([
      getQuote(symbol),          // cached 5 min
      getCompanyFacts(symbol),   // cached 24h
      tickerAndRelated,
      supabase
        .from('events')
        .select('id, title, summary, source_url, published_at, raw_text')
        .eq('ticker', symbol)
        .eq('event_type', 'sec_filing')
        .order('published_at', { ascending: false })
        .limit(5),
    ])

  const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null
  const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null
  const ticker = tickerResult.status === 'fulfilled' ? tickerResult.value.ticker : null
  const related = tickerResult.status === 'fulfilled' ? tickerResult.value.related : []
  const events = eventsResult.status === 'fulfilled' ? (eventsResult.value.data ?? []) : []

  if (!quote && !ticker) {
    return NextResponse.json({ error: 'Ticker not found' }, { status: 404 })
  }

  return NextResponse.json({ symbol, quote, summary, ticker, events, related })
}
