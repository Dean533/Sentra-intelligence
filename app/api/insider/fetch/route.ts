import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)))
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset = (page - 1) * limit

  const { data, count, error } = await supabase
    .from('insider_transactions')
    .select(
      'id, ticker, insider_name, role, is_director, is_officer, officer_title, transaction_date, transaction_code, shares, price_per_share, total_value, shares_owned_after, filed_date, source_url',
      { count: 'exact' }
    )
    .eq('transaction_code', 'P')
    .order('transaction_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    rows:  data ?? [],
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
