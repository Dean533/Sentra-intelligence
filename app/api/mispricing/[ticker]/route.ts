import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params

  const { data, error } = await supabase
    .from('insider_transactions')
    .select(
      'id, ticker, insider_name, officer_title, transaction_date, total_value, shares, price_per_share, price_on_day, price_5d, actual_return_5d, adjusted_return_5d, fundamental_score, gap_score'
    )
    .eq('ticker', ticker.toUpperCase())
    .not('gap_score', 'is', null)
    .order('gap_score', { ascending: false })
    .order('transaction_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ data })
}
