import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ticker = searchParams.get('ticker')?.toUpperCase() ?? null
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset = (page - 1) * limit

  let query = supabase
    .from('insider_transactions')
    .select(
      'id, ticker, insider_name, insider_cik, role, is_director, is_officer, officer_title, ' +
      'transaction_date, transaction_code, transaction_direction, ' +
      'shares, price_per_share, total_value, purchase_pct_market_cap, ' +
      'shares_owned_after, filed_date, source_url',
      { count: 'exact' }
    )
    .order('transaction_date', { ascending: false })

  if (ticker) {
    // When fetching for a specific ticker, return both buys and sells
    query = query.eq('ticker', ticker)
  } else {
    // Global feed: purchases only
    query = query.eq('transaction_code', 'P')
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach is_opportunistic flag by joining to insider_classifications
  let rows: any[] = data ?? []
  if (rows.length > 0) {
    const ciks = [...new Set(rows.map((r: any) => r.insider_cik).filter(Boolean))]
    if (ciks.length > 0) {
      const { data: classifications } = await supabase
        .from('insider_classifications')
        .select('insider_cik')
        .eq('classification', 'OPPORTUNISTIC')
        .in('insider_cik', ciks)

      const opportunisticCiks = new Set((classifications ?? []).map((c: any) => c.insider_cik))
      rows = rows.map((r: any) => ({
        ...r,
        is_opportunistic: r.insider_cik ? opportunisticCiks.has(r.insider_cik) : false,
      }))
    }
  }

  return NextResponse.json({
    rows,
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
