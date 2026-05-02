import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ticker    = searchParams.get('ticker')?.toUpperCase() ?? null
  const direction = searchParams.get('direction') ?? 'buys'   // 'buys' | 'sells' | 'all'
  const limit     = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset    = (page - 1) * limit

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

  if (direction === 'buys')       query = query.eq('transaction_code', 'P')
  else if (direction === 'sells') query = query.eq('transaction_code', 'S')
  else                            query = query.in('transaction_code', ['P', 'S'])

  if (ticker) {
    query = query.eq('ticker', ticker)
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let rows: any[] = data ?? []
  if (rows.length > 0) {
    const ciks = [...new Set(rows.map((r: any) => r.insider_cik).filter(Boolean))]
    let cikClassMap = new Map<string, string>()
    if (ciks.length > 0) {
      const { data: classifications } = await supabase
        .from('insider_classifications')
        .select('insider_cik, classification')
        .in('insider_cik', ciks)
      cikClassMap = new Map((classifications ?? []).map((c: any) => [c.insider_cik, c.classification as string]))
    }
    rows = rows.map((r: any) => ({
      ...r,
      classification: cikClassMap.get(r.insider_cik) ?? 'UNCLASSIFIABLE',
    }))
  }

  return NextResponse.json({
    rows,
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
