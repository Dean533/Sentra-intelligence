import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Tunable constants ────────────────────────────────────────────────────────
// Adjust these weights and caps to tune the model without touching formulas.

const WEIGHT_RELATIVE  = 0.40   // purchase size vs market cap — highest weight
const WEIGHT_DOLLAR    = 0.25   // raw dollar size, log-scaled
const WEIGHT_ROLE      = 0.15   // who bought
const WEIGHT_CLUSTER   = 0.10   // how many insiders buying the same stock in 30 days
const WEIGHT_OPEN      = 0.10   // open-market quality — always 1.0 (P-code filtered at ingest)

const REL_PURCHASE_CAP = 0.5    // % of market cap at which relative score maxes out
const MIN_DOLLAR       = 10_000     // ingest floor — $10k minimum purchase
const MAX_DOLLAR_CAP   = 50_000_000 // $50M+ treated as maximum signal

const BASE_MAX_MOVE    = 8.0    // % expected move for a perfect EventStrength of 1.0

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

// ─── EventStrength component helpers (all pure, no DB calls) ─────────────────

// How big was this buy relative to the company?
// A $5M buy in a $500M company (0.5%) means much more than in Apple.
// Linear scale: 0.5%+ of market cap = full score.
function relativePurchaseScore(pct: number | null): number {
  if (pct == null || pct <= 0) return 0
  return clamp(pct / REL_PURCHASE_CAP, 0, 1)
}

// How much raw money was committed?
// Log-scaled so a $100M buy doesn't dwarf a $5M buy.
// $10k → ~0, $1M → ~0.54, $5M → ~0.73, $50M+ → 1.0
function rawDollarScore(totalValue: number | null): number {
  if (totalValue == null || totalValue < MIN_DOLLAR) return 0
  const minLog = Math.log(MIN_DOLLAR)
  const maxLog = Math.log(MAX_DOLLAR_CAP)
  return clamp((Math.log(totalValue) - minLog) / (maxLog - minLog), 0, 1)
}

// Who made the buy?
// A CEO buying signals more conviction than a random director.
function insiderRoleScore(officerTitle: string | null, role: string | null): number {
  const t = (officerTitle ?? role ?? '').toLowerCase()
  if (!t) return 0.4
  if (
    t.includes('chief executive') || t.includes('ceo') ||
    t.includes('chairman') || t.includes('founder')
  ) return 1.0
  if (
    t.includes('chief financial') || t.includes('cfo') ||
    t.includes('president') ||
    t.includes('chief operating') || t.includes('coo') ||
    t.includes('chief technology') || t.includes('cto') ||
    t.includes('chief information') || t.includes('cio')
  ) return 0.8
  if (t.includes('director')) return 0.55
  return 0.4
}

// Did multiple insiders buy around the same time?
// Cluster buys are a stronger signal than isolated buys.
// count = distinct other insiders who bought the same ticker in the past 30 days.
function clusterBuyScore(count: number): number {
  if (count >= 3) return 1.0
  if (count === 2) return 0.7
  if (count === 1) return 0.4
  return 0.0
}

// ─── Size multiplier ──────────────────────────────────────────────────────────
// Smaller companies have higher expected moves on insider buys —
// less analyst coverage, less efficient pricing.
// Mega-caps are heavily followed; insider signals matter less at the margin.
function sizeMultiplier(marketCap: number | null): number {
  if (marketCap == null)                   return 1.0   // no data → neutral
  if (marketCap < 2_000_000_000)           return 1.35  // micro / small cap
  if (marketCap < 10_000_000_000)          return 1.15  // mid cap
  if (marketCap < 100_000_000_000)         return 1.0   // large cap
  return 0.75                                           // mega cap
}

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
  return clamp(Math.round((avg + 1) / 2 * 100), 0, 100)
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
    .order('transaction_date', { ascending: false })
    .limit(50)

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

      // ── Step 2: EventStrength (0–1) ────────────────────────────────────────
      // Weighted sum of five signals. Weights sum to 1.0.
      // We value the size of the buy relative to company size the most (40%),
      // put strong but lesser weight on raw dollars (25%), and apply lighter
      // adjustments for who bought (15%) and whether multiple insiders were buying (10%).
      // The remaining 10% is a flat open-market quality credit — every row earns it
      // since this query filters to transaction_code='P' (open-market purchases only).
      const eventStrength =
        WEIGHT_RELATIVE * relativePurchaseScore(row.purchase_pct_market_cap) +
        WEIGHT_DOLLAR   * rawDollarScore(row.total_value) +
        WEIGHT_ROLE     * insiderRoleScore(row.officer_title, row.role) +
        WEIGHT_CLUSTER  * clusterBuyScore(clusterCount) +
        WEIGHT_OPEN     * 1.0

      // ── Step 3: ExpectedMove (%) ───────────────────────────────────────────
      // What price move does this insider signal imply?
      // A perfect EventStrength of 1.0 in a small-cap implies ~8% × 1.35 ≈ 10.8%.
      // A mega-cap with the same signal implies ~8% × 0.75 ≈ 6%.
      // Stored as a plain percentage: 4.2 means 4.2%.
      const marketCap    = marketCapMap[row.ticker] ?? null
      const expectedMove = Math.round(BASE_MAX_MOVE * eventStrength * sizeMultiplier(marketCap) * 100) / 100

      if (rows.indexOf(row) < 5) {
        console.log(`[score:debug] ${row.ticker} | eventStrength=${eventStrength.toFixed(3)} | marketCap=${marketCap ? (marketCap / 1e9).toFixed(1) + 'B' : 'null'} | expectedMove=${expectedMove}%`)
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
          fundamental_score: Math.round(eventStrength * 100),
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
