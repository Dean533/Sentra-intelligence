import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'
import {
  computeFundamentalScore,
} from '@/lib/scoring/fundamentalScore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Narrative Score (0–100) ──────────────────────────────────────────────────
// Joins sentiment_scores → events to find scores for this ticker within ±48h
// of transaction_date. Stored as a separate column; not used in expected_move.
// sentiment_scores.score ranges from -0.8 to +0.8, normalized via (avg+1)/2*100.

async function getNarrativeScore(ticker: string, transactionDate: string): Promise<number | null> {
  const txMs = new Date(transactionDate).getTime()
  const from = new Date(txMs - 48 * 60 * 60 * 1000).toISOString()
  const to   = new Date(txMs + 48 * 60 * 60 * 1000).toISOString()

  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('ticker', ticker)
    .eq('event_type', 'news')
    .gte('published_at', from)
    .lte('published_at', to)

  const eventIds = (events ?? []).map((e: { id: string }) => e.id)
  if (eventIds.length === 0) return null

  const { data: scores } = await supabase
    .from('sentiment_scores')
    .select('score')
    .in('event_id', eventIds)

  if (!scores || scores.length === 0) return null

  const avg = scores.reduce((s: number, e: { score: number }) => s + e.score, 0) / scores.length
  return Math.min(100, Math.max(0, Math.round((avg + 1) / 2 * 100)))
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // Score open-market purchases only — awards/exercises (A, M, F, etc.) are excluded.
  const { data: rows, error } = await supabase
    .from('insider_transactions')
    .select('id, ticker, officer_title, role, purchase_pct_market_cap, total_value, transaction_date, insider_name')
    .eq('transaction_code', 'P')
    .not('total_value', 'is', null)
    .is('fundamental_score', null)
    .order('transaction_date', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ total: 0, scored: 0, failed: 0 })

  // Bulk-fetch market caps for all tickers in this batch (same pattern as price-enrich).
  const tickerSet = [...new Set(rows.map((r: any) => r.ticker as string))]
  const { data: tickerMeta } = await supabase
    .from('tickers')
    .select('symbol, market_cap')
    .in('symbol', tickerSet)

  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerMeta ?? []) {
    marketCapMap[(t as any).symbol] = (t as any).market_cap ?? null
  }

  let scored = 0
  let failed = 0

  for (const row of rows) {
    try {
      const txMs = new Date(row.transaction_date).getTime()

      // ── Step 1: Cluster count ───────────────────────────────────────────────
      // Count distinct other insiders who bought the same ticker in the past 30 days.
      const thirtyDaysBack = new Date(txMs - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      const { data: clusterRows } = await supabase
        .from('insider_transactions')
        .select('insider_name')
        .eq('ticker', row.ticker)
        .eq('transaction_code', 'P')
        .neq('id', row.id)
        .gte('transaction_date', thirtyDaysBack)
        .lte('transaction_date', row.transaction_date)

      const clusterCount = new Set((clusterRows ?? []).map((r: any) => r.insider_name as string)).size

      // ── Step 2 + 3: EventStrength and ExpectedMove ─────────────────────────
      const marketCap = marketCapMap[row.ticker] ?? null
      const { fundamental_score: fs, expected_move: expectedMove } =
        computeFundamentalScore(row, clusterCount, marketCap)

      if (rows.indexOf(row) < 5) {
        console.log(`[score:debug] ${row.ticker} | score=${fs} | marketCap=${marketCap ? (marketCap / 1e9).toFixed(1) + 'B' : 'null'} | expectedMove=${expectedMove}%`)
      }

      // ── Step 4: Narrative score (separate signal) ──────────────────────────
      const narrativeScore = await getNarrativeScore(row.ticker, row.transaction_date)

      // ── Step 5: Write ──────────────────────────────────────────────────────
      // fundamental_score = EventStrength × 100 (0-100).
      // expected_move     = estimated % price move from this insider signal.
      // narrative_score   = sentiment context around the transaction date.
      const { error: updateErr } = await supabase
        .from('insider_transactions')
        .update({
          fundamental_score: fs,
          expected_move:     expectedMove,
          narrative_score:   narrativeScore,
        })
        .eq('id', row.id)

      if (updateErr) { failed++; continue }

      scored++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ total: rows.length, scored, failed })
}
