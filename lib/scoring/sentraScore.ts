import { SupabaseClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

// ── types ──────────────────────────────────────────────────────────────────────

export interface SentraScoreBreakdown {
  news: number
  sec: number
  mispricing: number
  reasons: string[]
}

export interface SentraScoreResult {
  score: number
  breakdown: SentraScoreBreakdown
}

// ── component 1: news sentiment (0–40) ────────────────────────────────────────

async function scoreNews(
  ticker: string,
  supabase: SupabaseClient<any, any, any>
): Promise<{ score: number; weightedSentiment: number; reason: string }> {
  const { data: events } = await supabase
    .from('events')
    .select('summary, published_at')
    .eq('ticker', ticker)
    .eq('event_type', 'news')
    .order('published_at', { ascending: false })
    .limit(10)

  if (!events || events.length === 0) {
    return { score: 20, weightedSentiment: 0, reason: 'No recent news — neutral baseline' }
  }

  const now = Date.now()
  let weightedSum = 0
  let totalWeight = 0

  for (const ev of events) {
    const ageDays = (now - new Date(ev.published_at).getTime()) / 86_400_000
    const weight = Math.max(0.1, 1 - ageDays / 14) // 1.0 today → 0.1 at 14 days
    const value =
      ev.summary === 'bullish' ? 1 :
      ev.summary === 'bearish' ? -1 : 0
    weightedSum += value * weight
    totalWeight += weight
  }

  const weighted = totalWeight > 0 ? weightedSum / totalWeight : 0
  const score = Math.round(((weighted + 1) / 2) * 40)

  const label =
    weighted > 0.2 ? 'bullish' :
    weighted < -0.2 ? 'bearish' : 'mixed'
  const reason = `News sentiment ${label} (weighted avg ${weighted.toFixed(2)} across ${events.length} articles)`

  return { score, weightedSentiment: weighted, reason }
}

// ── component 2: SEC filing recency (0–35) ────────────────────────────────────

async function scoreSec(
  ticker: string,
  supabase: SupabaseClient<any, any, any>
): Promise<{ score: number; reason: string }> {
  const { data: filings } = await supabase
    .from('events')
    .select('published_at, raw_text')
    .eq('ticker', ticker)
    .eq('event_type', 'sec_filing')
    .order('published_at', { ascending: false })
    .limit(1)

  if (!filings || filings.length === 0) {
    return { score: 5, reason: 'No SEC filings found' }
  }

  const filing = filings[0]
  const ageDays = (Date.now() - new Date(filing.published_at).getTime()) / 86_400_000

  let base =
    ageDays <= 7  ? 35 :
    ageDays <= 14 ? 25 :
    ageDays <= 30 ? 15 : 5

  // Parse item codes from raw_text
  let items: string[] = []
  try {
    const parsed = JSON.parse(filing.raw_text ?? '{}')
    items = Array.isArray(parsed?.items) ? parsed.items : []
  } catch { /* ignore */ }

  const boosts: string[] = []
  if (items.includes('2.02')) { base += 5; boosts.push('earnings (2.02) +5') }
  if (items.includes('1.01')) { base += 5; boosts.push('M&A (1.01) +5') }
  if (items.includes('1.02')) { base -= 5; boosts.push('legal (1.02) -5') }

  const score = Math.min(35, Math.max(0, base))
  const daysLabel = ageDays <= 1 ? 'today' : `${Math.round(ageDays)}d ago`
  const boostText = boosts.length > 0 ? `; ${boosts.join(', ')}` : ''
  const reason = `8-K filed ${daysLabel}${boostText}`

  return { score, reason }
}

// ── component 3: mispricing signal (0–25) ─────────────────────────────────────

async function scoreMispricing(
  ticker: string,
  weightedSentiment: number,
  supabase: SupabaseClient<any, any, any>
): Promise<{ score: number; reason: string }> {
  // Try prices table first
  let priceChangePct: number | null = null

  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const { data: priceRows } = await supabase
    .from('prices')
    .select('date, close')
    .eq('ticker', ticker)
    .gte('date', sevenDaysAgo)
    .order('date', { ascending: true })

  if (priceRows && priceRows.length >= 2) {
    const first = priceRows[0].close
    const last  = priceRows[priceRows.length - 1].close
    if (first && last) priceChangePct = ((last - first) / first) * 100
  }

  // Fall back to Yahoo Finance chart
  if (priceChangePct === null) {
    try {
      const chart: any = await yahooFinance.chart(ticker, {
        period1: new Date(Date.now() - 7 * 86_400_000),
        interval: '1d',
      })
      const quotes = Array.isArray(chart?.quotes) ? chart.quotes : []
      const closes = quotes.map((q: any) => q?.close).filter((c: any) => c != null)
      if (closes.length >= 2) {
        priceChangePct = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
      }
    } catch { /* Yahoo unavailable */ }
  }

  const isBullish = weightedSentiment > 0.2
  const isBearish = weightedSentiment < -0.2

  if (priceChangePct === null) {
    return { score: 12, reason: 'Price data unavailable — neutral mispricing score' }
  }

  const pctLabel = `${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(1)}%`

  if (isBearish && priceChangePct > -2) {
    return {
      score: 25,
      reason: `Bearish sentiment but price only ${pctLabel} — potential mispricing opportunity`,
    }
  }
  if (isBullish && priceChangePct < 2) {
    return {
      score: 25,
      reason: `Bullish sentiment but price only ${pctLabel} — potential mispricing opportunity`,
    }
  }
  if (isBullish && priceChangePct >= 2) {
    return { score: 5, reason: `Bullish signal already priced in (${pctLabel} this week)` }
  }
  if (isBearish && priceChangePct <= -2) {
    return { score: 5, reason: `Bearish signal already priced in (${pctLabel} this week)` }
  }

  return { score: 12, reason: `No strong directional signal (price ${pctLabel} this week)` }
}

// ── valuation ─────────────────────────────────────────────────────────────────

export interface ValuationResult {
  analystTarget: number | null
  currentPrice: number | null
  analystGap: number | null
  weekRange52Position: number | null
  recommendation: string | null
  signal: 'undervalued' | 'overvalued' | 'fairly valued' | null
}

export async function getValuation(ticker: string): Promise<ValuationResult> {
  const summary: any = await yahooFinance.quoteSummary(ticker.toUpperCase(), {
    modules: ['financialData', 'summaryDetail'] as any,
  })

  const fd = summary?.financialData
  const sd = summary?.summaryDetail

  const analystTarget: number | null = fd?.targetMeanPrice ?? null
  const currentPrice: number | null  = fd?.currentPrice ?? null
  const low52  = sd?.fiftyTwoWeekLow  ?? null
  const high52 = sd?.fiftyTwoWeekHigh ?? null
  const recMean: number | null = fd?.recommendationMean ?? null

  const analystGap =
    analystTarget != null && currentPrice != null && currentPrice !== 0
      ? Math.round(((analystTarget - currentPrice) / currentPrice) * 1000) / 10
      : null

  const weekRange52Position =
    currentPrice != null && low52 != null && high52 != null && high52 !== low52
      ? Math.round(((currentPrice - low52) / (high52 - low52)) * 1000) / 10
      : null

  const recommendation =
    recMean == null ? null :
    recMean <= 1.5 ? 'Strong Buy' :
    recMean <= 2.5 ? 'Buy' :
    recMean <= 3.5 ? 'Hold' :
    recMean <= 4.5 ? 'Sell' : 'Strong Sell'

  const signal =
    analystGap == null ? null :
    analystGap > 10    ? 'undervalued' :
    analystGap < -10   ? 'overvalued'  : 'fairly valued'

  return { analystTarget, currentPrice, analystGap, weekRange52Position, recommendation, signal }
}

// ── main export ────────────────────────────────────────────────────────────────

export async function calculateSentraScore(
  ticker: string,
  supabase: SupabaseClient<any, any, any>
): Promise<SentraScoreResult> {
  const [newsResult, secResult] = await Promise.all([
    scoreNews(ticker, supabase),
    scoreSec(ticker, supabase),
  ])

  const mispricingResult = await scoreMispricing(ticker, newsResult.weightedSentiment, supabase)

  const score = Math.round(newsResult.score + secResult.score + mispricingResult.score)

  return {
    score,
    breakdown: {
      news:       newsResult.score,
      sec:        secResult.score,
      mispricing: mispricingResult.score,
      reasons: [
        newsResult.reason,
        secResult.reason,
        mispricingResult.reason,
      ],
    },
  }
}
