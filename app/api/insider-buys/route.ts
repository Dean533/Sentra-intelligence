import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10)))
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset = (page - 1) * limit

  // Form 4 filings are stored with raw_text JSON containing "form":"4"
  const { data, count, error } = await supabase
    .from('events')
    .select('id, ticker, title, summary, source_url, published_at, raw_text', { count: 'exact' })
    .eq('event_type', 'sec_filing')
    .like('raw_text', '%"form":"4%')
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).map((ev) => {
    let meta: Record<string, any> = {}
    try { meta = JSON.parse(ev.raw_text ?? '{}') } catch { /* ignore */ }

    return {
      id:          ev.id,
      ticker:      ev.ticker,
      name:        meta.reportingName   ?? meta.insiderName   ?? null,
      role:        meta.reportingTitle  ?? meta.insiderTitle  ?? null,
      date:        meta.fileDate        ?? ev.published_at,
      transaction: meta.transactionType ?? meta.transaction   ?? null,
      price:       meta.pricePerShare   ?? meta.price         ?? null,
      shares:      meta.shares          ?? meta.sharesTraded  ?? null,
      value:       meta.totalValue      ?? meta.value         ?? null,
      source_url:  ev.source_url,
      form:        meta.form            ?? '4',
    }
  })

  return NextResponse.json({
    rows,
    total: count ?? 0,
    page,
    pages: Math.ceil((count ?? 0) / limit),
  })
}
