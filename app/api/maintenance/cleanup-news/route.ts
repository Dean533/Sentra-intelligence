import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const BATCH_SIZE = 5_000

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  let totalSentimentDeleted = 0
  let totalEventsDeleted    = 0

  while (true) {
    // Fetch a batch of old news event IDs
    const { data: oldEvents, error: fetchErr } = await supabase
      .from('events')
      .select('id')
      .eq('event_type', 'news')
      .lt('published_at', cutoff)
      .limit(BATCH_SIZE)

    if (fetchErr) {
      return NextResponse.json({ error: `fetch failed: ${fetchErr.message}` }, { status: 500 })
    }
    if (!oldEvents || oldEvents.length === 0) break

    const ids = oldEvents.map((r: any) => r.id as number)

    // Delete linked sentiment_scores first to satisfy the FK constraint.
    // Chunk to 500 ids per .in() call — PostgREST rejects very large IN lists.
    const SENT_CHUNK = 500
    for (let i = 0; i < ids.length; i += SENT_CHUNK) {
      const chunk = ids.slice(i, i + SENT_CHUNK)
      const { error: sentErr, count: sentCount } = await supabase
        .from('sentiment_scores')
        .delete({ count: 'exact' })
        .in('event_id', chunk)

      if (sentErr) {
        console.error('[cleanup-news] sentiment_scores delete error:', JSON.stringify(sentErr, null, 2))
        return NextResponse.json({ error: `sentiment_scores delete failed: ${sentErr.message}` }, { status: 500 })
      }
      totalSentimentDeleted += sentCount ?? 0
    }

    // Delete events rows in the same 500-id chunks.
    const EVT_CHUNK = 500
    for (let i = 0; i < ids.length; i += EVT_CHUNK) {
      const chunk = ids.slice(i, i + EVT_CHUNK)
      const { error: evtErr, count: evtCount } = await supabase
        .from('events')
        .delete({ count: 'exact' })
        .in('id', chunk)

      if (evtErr) {
        console.error('[cleanup-news] events delete error:', JSON.stringify(evtErr, null, 2))
        return NextResponse.json({ error: `events delete failed: ${evtErr.message}` }, { status: 500 })
      }
      totalEventsDeleted += evtCount ?? 0
    }

    // If we got fewer rows than the batch size, we've cleared everything
    if (oldEvents.length < BATCH_SIZE) break
  }

  console.log(`[cleanup-news] deleted ${totalEventsDeleted} events, ${totalSentimentDeleted} sentiment_scores (cutoff=${cutoff})`)

  return NextResponse.json({
    cutoff,
    sentiment_scores_deleted: totalSentimentDeleted,
    events_deleted:           totalEventsDeleted,
  })
}
