import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!,
)

const yahooFinance = new YahooFinance()

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const raw = searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20)

  if (tickers.length === 0) return NextResponse.json({ tickers: [], news: [] })

  const [dbResults, priceResults] = await Promise.all([
    Promise.allSettled([
      supabase.from('tickers').select('symbol, name').in('symbol', tickers),
      supabase
        .from('insider_transactions')
        .select('ticker, sentra_score')
        .in('ticker', tickers)
        .eq('transaction_code', 'P')
        .lte('transaction_date', '2027-01-01')
        .order('transaction_date', { ascending: false })
        .limit(tickers.length * 3),
      supabase
        .from('events')
        .select('ticker, title, source_url, published_at, raw_text')
        .in('ticker', tickers)
        .eq('event_type', 'news')
        .order('published_at', { ascending: false })
        .limit(30),
    ]),
    Promise.allSettled(
      tickers.map((t) => (yahooFinance.quote(t) as Promise<any>).catch(() => null))
    ),
  ])

  const [nameRes, insiderRes, newsRes] = dbResults

  // Name map
  const nameMap: Record<string, string> = {}
  if (nameRes.status === 'fulfilled') {
    for (const r of (nameRes.value as any).data ?? []) nameMap[r.symbol] = r.name
  }

  // Latest purchase score per ticker
  const scoreMap: Record<string, number> = {}
  if (insiderRes.status === 'fulfilled') {
    for (const r of (insiderRes.value as any).data ?? []) {
      if (!(r.ticker in scoreMap) && r.sentra_score != null) scoreMap[r.ticker] = r.sentra_score
    }
  }

  // Price map with full quote fields
  const priceMap: Record<string, {
    price: number | null; changePercent: number | null
    volume: number | null; marketCap: number | null
    pe: number | null; week52High: number | null; week52Low: number | null
  }> = {}
  for (let i = 0; i < tickers.length; i++) {
    const r = priceResults[i]
    if (r.status === 'fulfilled' && r.value) {
      const q = r.value
      priceMap[tickers[i]] = {
        price:         q.regularMarketPrice        ?? null,
        changePercent: q.regularMarketChangePercent ?? null,
        volume:        q.regularMarketVolume        ?? null,
        marketCap:     q.marketCap                 ?? null,
        pe:            q.trailingPE                ?? null,
        week52High:    q.fiftyTwoWeekHigh          ?? null,
        week52Low:     q.fiftyTwoWeekLow           ?? null,
      }
    }
  }

  // News
  const news: {
    ticker: string
    title: string
    source: string | null
    publishedAt: string
    url: string | null
  }[] = []
  if (newsRes.status === 'fulfilled') {
    for (const r of (newsRes.value as any).data ?? []) {
      let source: string | null = null
      try { source = JSON.parse(r.raw_text ?? '{}')?.source ?? null } catch {}
      news.push({
        ticker: r.ticker,
        title: r.title,
        source,
        publishedAt: r.published_at,
        url: r.source_url,
      })
    }
  }

  const result = tickers.map((t) => ({
    ticker:        t,
    name:          nameMap[t]              ?? null,
    price:         priceMap[t]?.price         ?? null,
    changePercent: priceMap[t]?.changePercent ?? null,
    volume:        priceMap[t]?.volume        ?? null,
    marketCap:     priceMap[t]?.marketCap     ?? null,
    pe:            priceMap[t]?.pe            ?? null,
    week52High:    priceMap[t]?.week52High    ?? null,
    week52Low:     priceMap[t]?.week52Low     ?? null,
    score:         scoreMap[t]             ?? null,
  }))

  return NextResponse.json({ tickers: result, news })
}
