import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const type    = searchParams.get('type')   ?? 'all'    // 'all' | 'news' | 'sec_filing'
  const ticker  = searchParams.get('ticker')?.toUpperCase().trim() ?? null
  const limit   = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10)))
  const page    = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset  = (page - 1) * limit

  let query = supabase
    .from('events')
    .select('id, ticker, event_type, title, summary, source_url, published_at, raw_text', { count: 'exact' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (type !== 'all') {
    query = query.eq('event_type', type)
  }
  if (ticker) {
    query = query.eq('ticker', ticker)
  }

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    events: data ?? [],
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
