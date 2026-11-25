import { NextResponse } from 'next/server'
import { getTickerNews } from '@/lib/news/tickerNews'

// Read-only headline feed for the ticker page (Yahoo + Google News, last 7 days,
// keyword sentiment). Unlike /api/news it does not write to the events table.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ticker = (searchParams.get('ticker') ?? '').toUpperCase().trim()
  const company = searchParams.get('company')
  if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: 'Missing or invalid ?ticker= param' }, { status: 400 })
  }
  try {
    const items = await getTickerNews(ticker, company)
    return NextResponse.json({ ticker, items }, { headers: { 'Cache-Control': 'public, max-age=300' } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load news' }, { status: 500 })
  }
}
