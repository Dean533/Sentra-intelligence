import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const yahooFinance = new YahooFinance()

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  const [quoteResult, summaryResult, tickerResult, eventsResult] =
    await Promise.allSettled([
      yahooFinance.quote(symbol) as Promise<any>,
      yahooFinance.quoteSummary(symbol, {
        modules: ['assetProfile', 'defaultKeyStatistics', 'financialData'],
      }) as Promise<any>,
      supabase.from('tickers').select('*').eq('symbol', symbol).single(),
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
  const ticker = tickerResult.status === 'fulfilled' ? tickerResult.value.data : null
  const events = eventsResult.status === 'fulfilled' ? (eventsResult.value.data ?? []) : []

  if (!quote && !ticker) {
    return NextResponse.json({ error: 'Ticker not found' }, { status: 404 })
  }

  // Related tickers: same sector, exclude self
  let related: any[] = []
  const sector = ticker?.sector ?? null
  if (sector) {
    const { data } = await supabase
      .from('tickers')
      .select('symbol, name, sector, market_cap')
      .eq('sector', sector)
      .neq('symbol', symbol)
      .limit(5)
    related = data ?? []
  }

  return NextResponse.json({ symbol, quote, summary, ticker, events, related })
}
