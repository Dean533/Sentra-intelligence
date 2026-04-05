import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const { data: transaction, error } = await supabase
    .from('insider_transactions')
    .select(
      'id, ticker, insider_name, officer_title, transaction_date, total_value, shares, price_per_share, price_on_day, price_1d, price_3d, price_5d, price_10d, actual_return_5d, adjusted_return_5d, spy_return_5d, fundamental_score, gap_score, purchase_pct_market_cap, accession_number, source_url, filed_date'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!transaction) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: sentiment } = await supabase
    .from('sentiment_scores')
    .select('score, label, scored_at, headline')
    .eq('ticker', transaction.ticker)
    .order('scored_at', { ascending: false })
    .limit(5)

  return NextResponse.json({ transaction, sentiment: sentiment ?? [] })
}
