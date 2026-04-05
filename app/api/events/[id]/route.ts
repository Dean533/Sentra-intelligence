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

  const txMs = new Date(transaction.transaction_date).getTime()
  const from = new Date(txMs - 48 * 60 * 60 * 1000).toISOString()
  const to   = new Date(txMs + 48 * 60 * 60 * 1000).toISOString()

  // Find news events for this ticker within ±48h of the transaction
  const { data: newsEvents } = await supabase
    .from('events')
    .select('id, title, source_url, published_at')
    .eq('ticker', transaction.ticker)
    .eq('event_type', 'news')
    .gte('published_at', from)
    .lte('published_at', to)
    .order('published_at', { ascending: false })
    .limit(5)

  const eventIds = (newsEvents ?? []).map((e: any) => e.id)
  const eventMap: Record<string, { title: string; source_url: string | null; published_at: string }> =
    Object.fromEntries((newsEvents ?? []).map((e: any) => [e.id, e]))

  // Fetch sentiment scores linked to those events
  let sentiment: any[] = []
  if (eventIds.length > 0) {
    const { data: scores } = await supabase
      .from('sentiment_scores')
      .select('event_id, score, label, scored_at')
      .in('event_id', eventIds)

    sentiment = (scores ?? []).map((s: any) => ({
      score:        s.score,
      label:        s.label,
      scored_at:    s.scored_at,
      published_at: eventMap[s.event_id]?.published_at ?? null,
      headline:     eventMap[s.event_id]?.title ?? null,
      source_url:   eventMap[s.event_id]?.source_url ?? null,
    })).sort((a: any, b: any) =>
      new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime()
    ).slice(0, 5)
  }

  return NextResponse.json({ transaction, sentiment })
}
