import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// The source dropdown's option list barely changes, so cache it in memory for a
// few minutes instead of re-scanning up to 2000 rows of raw_text on every News
// tab load. Per-instance cache (serverless), worst case a few redundant scans
// right after a cold start.
const SOURCES_CACHE_TTL_MS = 5 * 60 * 1000
let sourcesCache: { sources: string[]; fetchedAt: number } | null = null

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const type      = searchParams.get('type')    ?? 'all'
  const ticker    = searchParams.get('ticker')?.toUpperCase().trim() ?? null
  const sentiment = searchParams.get('sentiment') ?? null  // 'bullish' | 'neutral' | 'bearish'
  const source    = searchParams.get('source')    ?? null
  const startDate = searchParams.get('start_date') ?? null
  const endDate   = searchParams.get('end_date')   ?? null
  const limit     = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '30', 10)))
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10))
  const offset    = (page - 1) * limit

  // Distinct-sources mode — scan news raw_text and return unique source values.
  if (searchParams.get('distinct') === 'source') {
    const now = Date.now()
    if (sourcesCache && now - sourcesCache.fetchedAt < SOURCES_CACHE_TTL_MS) {
      return NextResponse.json({ sources: sourcesCache.sources })
    }
    const { data } = await supabase
      .from('events')
      .select('raw_text')
      .eq('event_type', 'news')
      .not('raw_text', 'is', null)
      .limit(2000)
    const sources = [
      ...new Set(
        (data ?? [])
          .map((r: any) => { try { return JSON.parse(r.raw_text)?.source ?? null } catch { return null } })
          .filter(Boolean)
      ),
    ].sort() as string[]
    sourcesCache = { sources, fetchedAt: now }
    return NextResponse.json({ sources })
  }

  let query = supabase
    .from('events')
    .select('id, ticker, event_type, title, summary, source_url, published_at, raw_text', { count: 'estimated' })
    .order('published_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (type !== 'all')  query = query.eq('event_type', type)
  if (ticker)          query = query.eq('ticker', ticker)
  if (startDate)       query = query.gte('published_at', startDate)
  if (endDate)         query = query.lte('published_at', endDate)
  // sentiment and source live inside the raw_text JSONB field
  if (sentiment)       query = query.filter('raw_text->>sentiment', 'eq', sentiment)
  if (source)          query = query.filter('raw_text->>source',    'eq', source)

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    events: data ?? [],
    total:  count ?? 0,
    page,
    pages:  Math.ceil((count ?? 0) / limit),
  })
}
