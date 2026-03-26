import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const PAGE_SIZE = 30

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sector = searchParams.get('sector') ?? ''   // '' = all sectors
  const sort   = searchParams.get('sort')   ?? 'market_cap'
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset = (page - 1) * PAGE_SIZE

  // ── build Supabase query ──────────────────────────────────────────────────
  const base = supabase.from('tickers').select('*', { count: 'exact' })

  const filtered = sector ? base.eq('sector', sector) : base

  const ordered =
    sort === 'alpha'  ? filtered.order('symbol',     { ascending: true }) :
    sort === 'sector' ? filtered.order('sector',     { ascending: true })
                                .order('symbol',     { ascending: true }) :
                        filtered.order('market_cap', { ascending: false })

  const { data: rows, count, error } = await ordered.range(offset, offset + PAGE_SIZE - 1)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── fetch live prices for just this page's 30 tickers ────────────────────
  const tickers = await Promise.all(
    (rows ?? []).map(async (t) => {
      try {
        const quote = await yahooFinance.quote(t.symbol) as any
        return {
          ...t,
          price:             quote.regularMarketPrice        ?? null,
          day_change:        quote.regularMarketChange       ?? null,
          day_change_percent: quote.regularMarketChangePercent ?? null,
        }
      } catch {
        return { ...t, price: null, day_change: null, day_change_percent: null }
      }
    })
  )

  const total = count ?? 0

  return NextResponse.json({
    tickers,
    total,
    page,
    pages: Math.ceil(total / PAGE_SIZE),
  })
}
