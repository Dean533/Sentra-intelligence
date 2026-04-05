import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const yahooFinance = new YahooFinance()

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

// ─── Purchase Size Score (0–40) ───────────────────────────────────────────────

function purchaseSizeScore(pctOfMarketCap: number | null): number {
  if (pctOfMarketCap == null) return 5
  if (pctOfMarketCap >= 0.1)  return 40
  if (pctOfMarketCap >= 0.05) return 30
  if (pctOfMarketCap >= 0.01) return 20
  if (pctOfMarketCap >= 0.005) return 10
  return 5
}

// ─── Insider Role Score (0–35) ────────────────────────────────────────────────

function roleScore(officerTitle: string | null, role: string | null): number {
  const t = (officerTitle ?? role ?? '').toLowerCase()
  if (!t) return 10
  if (t.includes('chief executive') || t.includes('ceo') ||
      t.includes('president')       || t.includes('chairman')) return 35
  if (t.includes('chief financial') || t.includes('cfo') ||
      t.includes('chief operating') || t.includes('coo') ||
      t.includes('chief technology') || t.includes('cto') ||
      t.includes('chief information') || t.includes('cio')) return 25
  if (t.includes('10%') || t.includes('10 %') || t.includes('ten percent')) return 20
  if (t.includes('director')) return 15
  return 10
}

// ─── 52-Week Range Score (0–25) ───────────────────────────────────────────────
// Position = (price - 52w_low) / (52w_high - 52w_low)
// Closer to the low = stronger buy signal

function rangeScore(position: number): number {
  if (position < 0.2) return 25
  if (position < 0.4) return 20
  if (position < 0.6) return 12
  if (position < 0.8) return 5
  return 2
}

// ─── fetch 52-week range from Yahoo Finance (cached per ticker) ───────────────

type RangeData = { low52: number; high52: number }
const rangeCache = new Map<string, RangeData | null>()

async function get52WeekRange(ticker: string): Promise<RangeData | null> {
  if (rangeCache.has(ticker)) return rangeCache.get(ticker)!
  try {
    const quote = await yahooFinance.quote(ticker) as any
    const low52  = quote?.fiftyTwoWeekLow  ?? null
    const high52 = quote?.fiftyTwoWeekHigh ?? null
    const result = (low52 != null && high52 != null && high52 > low52)
      ? { low52, high52 } : null
    rangeCache.set(ticker, result)
    return result
  } catch {
    rangeCache.set(ticker, null)
    return null
  }
}

// ─── Narrative Score (0–100) ──────────────────────────────────────────────────
// Joins sentiment_scores → events to find scores for this ticker within ±48h
// of transaction_date (using events.published_at as the date anchor).
// sentiment_scores.score ranges from -0.8 to +0.8.
// Normalized to 0–100 via: (avg + 1) / 2 * 100

async function getNarrativeScore(ticker: string, transactionDate: string): Promise<number | null> {
  const txMs = new Date(transactionDate).getTime()
  const from = new Date(txMs - 48 * 60 * 60 * 1000).toISOString()
  const to   = new Date(txMs + 48 * 60 * 60 * 1000).toISOString()

  // Step 1: find news event IDs for this ticker in the ±48h window
  const { data: events } = await supabase
    .from('events')
    .select('id')
    .eq('ticker', ticker)
    .eq('event_type', 'news')
    .gte('published_at', from)
    .lte('published_at', to)

  const eventIds = (events ?? []).map((e: { id: string }) => e.id)
  if (eventIds.length === 0) return null

  // Step 2: fetch sentiment scores linked to those events
  const { data: scores } = await supabase
    .from('sentiment_scores')
    .select('score')
    .in('event_id', eventIds)

  if (!scores || scores.length === 0) return null

  const avg = scores.reduce((s: number, e: { score: number }) => s + e.score, 0) / scores.length
  return clamp(Math.round((avg + 1) / 2 * 100), 0, 100)
}

// ─── route handler ────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // Re-score all rows that have price data (no gap_score filter — overwrites existing scores)
  const { data: rows, error } = await supabase
    .from('insider_transactions')
    .select('id, ticker, officer_title, role, purchase_pct_market_cap, price_on_day, adjusted_return_5d, transaction_date')
    .not('price_on_day', 'is', null)
    .order('transaction_date', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ total: 0, scored: 0, failed: 0 })

  let scored = 0
  let failed = 0

  for (const row of rows) {
    try {
      // 1. Purchase size
      const sizePoints = purchaseSizeScore(row.purchase_pct_market_cap)

      // 2. Role
      const rolePoints = roleScore(row.officer_title, row.role)

      // 3. 52-week range
      await sleep(200)
      const range = await get52WeekRange(row.ticker)
      let rangePoints = 12  // default to middle bucket if data unavailable
      if (range != null) {
        const position = (row.price_on_day - range.low52) / (range.high52 - range.low52)
        rangePoints = rangeScore(clamp(position, 0, 1))
      }

      const fundamentalScore = sizePoints + rolePoints + rangePoints

      // 4. Narrative score from sentiment_scores (±48h window)
      const narrativeScore = await getNarrativeScore(row.ticker, row.transaction_date)

      // 5. Gap score
      // With narrative: weighted blend of fundamental, narrative, and return penalty
      // Without narrative: fall back to original formula
      let gapScore: number | null
      if (narrativeScore != null && row.adjusted_return_5d != null) {
        // adjusted_return_penalty: 0–100, high when market fell after buy (more mispriced)
        // 0% return → 50, −10% → 100, +10% → 0
        const adjustedReturnPenalty = clamp(Math.round(50 - row.adjusted_return_5d * 5), 0, 100)
        gapScore = clamp(Math.round(
          fundamentalScore * 0.6 +
          narrativeScore   * 0.2 +
          adjustedReturnPenalty * 0.2
        ), 0, 100)
      } else {
        gapScore = row.adjusted_return_5d != null
          ? clamp(Math.round(fundamentalScore - row.adjusted_return_5d * 2), 0, 100)
          : null
      }

      const { error: updateErr } = await supabase
        .from('insider_transactions')
        .update({ fundamental_score: fundamentalScore, narrative_score: narrativeScore, gap_score: gapScore })
        .eq('id', row.id)

      if (updateErr) { failed++; continue }

      scored++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ total: rows.length, scored, failed })
}
