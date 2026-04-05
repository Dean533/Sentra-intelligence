import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function labelToScore(label: string | null): number {
  if (label === 'bullish') return 0.8
  if (label === 'bearish') return -0.8
  return 0.0
}

function extractSource(rawText: string | null): string | null {
  if (!rawText) return null
  try {
    return JSON.parse(rawText)?.source ?? null
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // 1. Fetch event IDs that already have a sentiment_score row
  const { data: alreadyScored } = await supabase
    .from('sentiment_scores')
    .select('event_id')
    .not('event_id', 'is', null)

  const scoredIds = (alreadyScored ?? []).map((r: any) => r.event_id as string)

  // 2. Fetch unscored news events
  let query = supabase
    .from('events')
    .select('id, ticker, summary, published_at, raw_text')
    .eq('event_type', 'news')
    .order('published_at', { ascending: false })
    .limit(200)

  if (scoredIds.length > 0) {
    query = query.not('id', 'in', `(${scoredIds.join(',')})`)
  }

  const { data: events, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!events || events.length === 0) return NextResponse.json({ total: 0, scored: 0, failed: 0 })

  // 3. Build upsert rows
  const now = new Date().toISOString()
  const rows = events.map((ev: any) => ({
    event_id:  ev.id,
    score:     labelToScore(ev.summary),
    label:     ev.summary ?? 'neutral',
    source:    extractSource(ev.raw_text),
    scored_at: now,
  }))

  // 4. Upsert in one shot
  const { error: upsertErr } = await supabase
    .from('sentiment_scores')
    .upsert(rows, { onConflict: 'event_id', ignoreDuplicates: false })

  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 })

  return NextResponse.json({ total: events.length, scored: rows.length, failed: 0 })
}
