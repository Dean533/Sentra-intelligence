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

// Vercel Hobby's hard ceiling is 60s. Bulk-fetching below (instead of the old
// per-row cluster/narrative queries) is what keeps this route far under that,
// not a large maxDuration — see the batch-level queries in GET().
export const maxDuration = 60

// ─── Narrative Score (0–100) ──────────────────────────────────────────────────
// sentiment_scores.score ranges from -0.8 to +0.8, normalized via (avg+1)/2*100.
function computeNarrativeScore(scores: number[]): number | null {
  if (scores.length === 0) return null
  const avg = scores.reduce((s, v) => s + v, 0) / scores.length
  return Math.min(100, Math.max(0, Math.round((avg + 1) / 2 * 100)))
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // Score open-market purchases only — awards/exercises (A, M, F, etc.) are excluded.
  // Batch size kept modest even though round trips are now O(1) per batch, not
  // O(rows) — leaves headroom rather than maxing out every invocation.
  const { data: rows, error } = await supabase
    .from('insider_transactions')
    .select('id, ticker, officer_title, role, purchase_pct_market_cap, total_value, transaction_date, insider_name')
    .eq('transaction_code', 'P')
    .not('total_value', 'is', null)
    .is('fundamental_score', null)
    .order('transaction_date', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ total: 0, scored: 0, failed: 0 })

  const tickerSet = [...new Set(rows.map((r: any) => r.ticker as string))]
  const txTimes    = rows.map((r: any) => new Date(r.transaction_date).getTime())
  const minTxMs     = Math.min(...txTimes)
  const maxTxMs     = Math.max(...txTimes)

  // Bulk-fetch market caps for all tickers in this batch.
  const { data: tickerMeta } = await supabase
    .from('tickers')
    .select('symbol, market_cap')
    .in('symbol', tickerSet)

  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerMeta ?? []) {
    marketCapMap[(t as any).symbol] = (t as any).market_cap ?? null
  }

  // ── Step 1: Cluster counts, bulk ────────────────────────────────────────────
  // Was: 1 query per row. Now: 1 query for the whole batch's tickers over the
  // union of their 30-day lookback windows, counted in memory per row.
  const clusterLookbackStart = new Date(minTxMs - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const clusterLookbackEnd   = new Date(maxTxMs).toISOString().split('T')[0]

  const { data: clusterCandidates } = await supabase
    .from('insider_transactions')
    .select('id, ticker, insider_name, transaction_date')
    .eq('transaction_code', 'P')
    .in('ticker', tickerSet)
    .gte('transaction_date', clusterLookbackStart)
    .lte('transaction_date', clusterLookbackEnd)

  function clusterCountFor(row: any): number {
    const txMs    = new Date(row.transaction_date).getTime()
    const cutoff  = txMs - 30 * 24 * 60 * 60 * 1000
    const names   = new Set<string>()
    for (const r of clusterCandidates ?? []) {
      if ((r as any).ticker !== row.ticker || (r as any).id === row.id) continue
      const rMs = new Date((r as any).transaction_date).getTime()
      if (rMs < cutoff || rMs > txMs) continue
      if ((r as any).insider_name) names.add((r as any).insider_name)
    }
    return names.size
  }

  // ── Step 2: Narrative scores, bulk ──────────────────────────────────────────
  // Was: 2 queries per row (events, then sentiment_scores). Now: 1 query for
  // events across the batch's ±48h union window, 1 for their sentiment scores.
  const narrativeFrom = new Date(minTxMs - 48 * 60 * 60 * 1000).toISOString()
  const narrativeTo   = new Date(maxTxMs + 48 * 60 * 60 * 1000).toISOString()

  const { data: candidateEvents } = await supabase
    .from('events')
    .select('id, ticker, published_at')
    .eq('event_type', 'news')
    .in('ticker', tickerSet)
    .gte('published_at', narrativeFrom)
    .lte('published_at', narrativeTo)

  const candidateEventIds = (candidateEvents ?? []).map((e: any) => e.id)
  const scoreByEventId = new Map<string, number>()
  if (candidateEventIds.length > 0) {
    const { data: candidateScores } = await supabase
      .from('sentiment_scores')
      .select('event_id, score')
      .in('event_id', candidateEventIds)
    for (const s of candidateScores ?? []) scoreByEventId.set((s as any).event_id, (s as any).score)
  }

  function narrativeScoreFor(ticker: string, transactionDate: string): number | null {
    const txMs = new Date(transactionDate).getTime()
    const from = txMs - 48 * 60 * 60 * 1000
    const to   = txMs + 48 * 60 * 60 * 1000
    const matching: number[] = []
    for (const e of candidateEvents ?? []) {
      if ((e as any).ticker !== ticker) continue
      const pubMs = new Date((e as any).published_at).getTime()
      if (pubMs < from || pubMs > to) continue
      const score = scoreByEventId.get((e as any).id)
      if (score != null) matching.push(score)
    }
    return computeNarrativeScore(matching)
  }

  // ── Score and write ─────────────────────────────────────────────────────────
  let scored = 0
  let failed = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      const clusterCount = clusterCountFor(row)
      const marketCap    = marketCapMap[row.ticker] ?? null
      const { fundamental_score: fs, expected_move: expectedMove } =
        computeFundamentalScore(row, clusterCount, marketCap)

      if (i < 5) {
        console.log(`[score:debug] ${row.ticker} | score=${fs} | marketCap=${marketCap ? (marketCap / 1e9).toFixed(1) + 'B' : 'null'} | expectedMove=${expectedMove}%`)
      }

      const narrativeScore = narrativeScoreFor(row.ticker, row.transaction_date)

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
