// Pure conviction scoring — no I/O. All inputs pre-fetched by caller.
// Empirically calibrated from factor analysis of 322 confirmed opportunistic
// trades, 2015–2026. Every point value is justified by measured 90d/180d alpha.
// See output/full-factor-analysis.txt for the source numbers.

// ─── Exclusion tables ─────────────────────────────────────────────────────────

export const EXCLUDED_TICKER_PENALTIES: Record<string, number> = {
  MSTR: -30,
  VST:  -15,
  CVS:  -15,
  VRTX: -15,
  GME:  -15,
  ALLE: -15,
  CRL:  -15,
}

export const EXCLUDED_INSIDER_PENALTIES: Array<{ name: string; penalty: number }> = [
  { name: 'PATTEN JARROD M',   penalty: -25 },
  { name: 'HELM SCOTT B',      penalty: -15 },
  { name: 'WALLMAN RICHARD F', penalty: -10 },
  { name: 'STONE JOHN H',      penalty: -10 },
  { name: 'CHENG LAWRENCE',    penalty: -10 },
]

export const EXCLUDED_TICKERS  = Object.keys(EXCLUDED_TICKER_PENALTIES)
export const EXCLUDED_INSIDERS = EXCLUDED_INSIDER_PENALTIES.map(e => e.name)

// Known high-alpha insiders. Both SEC name orderings listed.
// ticker=null applies at any ticker.
const HIGH_ALPHA_INSIDERS: Array<{ name: string; ticker: string | null; bonus: number }> = [
  { name: 'MYERS FRANKLIN',   ticker: 'FIX',  bonus: 8 },
  { name: 'FRANKLIN MYERS',   ticker: 'FIX',  bonus: 8 },
  { name: 'EMANUEL ARIEL',    ticker: 'TKO',  bonus: 8 },
  { name: 'ARIEL EMANUEL',    ticker: 'TKO',  bonus: 8 },
  { name: 'AUSTIN ROXANNE',   ticker: 'CRWD', bonus: 8 },
  { name: 'ROXANNE AUSTIN',   ticker: 'CRWD', bonus: 8 },
  { name: 'JACOBSON MATTHEW', ticker: 'DDOG', bonus: 6 },
  { name: 'MATTHEW JACOBSON', ticker: 'DDOG', bonus: 6 },
  { name: 'ARORA NIKESH',     ticker: 'PANW', bonus: 6 },
  { name: 'NIKESH ARORA',     ticker: 'PANW', bonus: 6 },
  { name: 'ARES MANAGEMENT',  ticker: null,   bonus: 6 },
]

// ─── Input types ──────────────────────────────────────────────────────────────

export type ConvictionTrade = {
  ticker:                     string
  insider_name:               string
  officer_title:              string | null
  role:                       string | null
  total_value:                number | null
  price_per_share:            number | null
  transaction_date:           string
  is_opportunistic:           boolean
  is_inferred_opportunistic?: boolean
  is_local:                   boolean | null
  sector:                     string | null
  cluster_count:              number
  cluster_total_value:        number
  insider_median_value:       number | null
}

export type TradeOutcome = {
  isPositive: boolean
  alpha?:     number | null
}

// ─── Output type ──────────────────────────────────────────────────────────────

export type ConvictionResult = {
  score:              number
  classification:     'HIGH_CONVICTION' | 'TAKE_TRADE' | 'MONITOR' | 'DO_NOT_TRADE'
  role:               string
  factors:            string[]
  holdDays:           number
  positionMultiplier: number
  exitRules: {
    stopLoss:        number
    takeProfit:      number
    holdDays:        number
    stopLossPrice:   number | null
    takeProfitPrice: number | null
  }
}

// ─── Role classifier ──────────────────────────────────────────────────────────
// Priority order matters: CEO/CFO before 10% Owner before President.

export function classifyRole(trade: Pick<ConvictionTrade, 'role' | 'officer_title'>): string {
  const r = (trade.role          ?? '').toLowerCase()
  const t = (trade.officer_title ?? '').toLowerCase()
  if (r.includes('ceo')        || r.includes('chief executive') ||
      t.includes('ceo')        || t.includes('chief executive'))  return 'CEO'
  if (r.includes('cfo')        || r.includes('chief financial')  ||
      t.includes('cfo')        || t.includes('chief financial'))  return 'CFO'
  if (r.includes('10%')        || t.includes('10%'))              return '10% Owner'
  if (r.includes('co-founder') || r.includes('partner'))          return 'Co-Founder/Partner'
  if (r.includes('president')  || t.includes('president'))        return 'President'
  if (r.includes('director'))                                      return 'Director'
  if (r.includes('insider'))                                       return 'Insider (other)'
  return 'Other/EVP'
}

// ─── Hold period ──────────────────────────────────────────────────────────────
// Calibrated on 180d vs 90d alpha divergence per role.
// CFO/10%Owner: 180d — both show materially stronger 180d alpha.
// CEO: 90d — alpha peaks at 90d (+6.40%) then fades.
// Other/EVP: 60d — negative by 180d (-7.30%), cut early.

function holdByRole(role: string): number {
  if (role === 'CFO' || role === '10% Owner')  return 180
  if (role === 'CEO' || role === 'Director')   return 90
  if (role === 'Other/EVP')                    return 60
  return 150
}

// ─── Hit rate helper ──────────────────────────────────────────────────────────

function hitRate(history: TradeOutcome[]): number | null {
  if (history.length < 5) return null
  return history.filter(h => h.isPositive).length / history.length
}

// ─── Main scoring function ────────────────────────────────────────────────────

export function computeConvictionScore(
  trade:           ConvictionTrade,
  insiderHistory:  TradeOutcome[],
  tickerHistory:   TradeOutcome[],
  spy_90d_return?: number | null,
): ConvictionResult {
  const factors: string[] = []
  let score = 0

  // ── Starting points ──────────────────────────────────────────────────────
  if (trade.is_opportunistic && trade.is_inferred_opportunistic) {
    score = 45
    factors.push('Inferred opportunistic: base 45')
  } else if (trade.is_opportunistic) {
    score = 50
    factors.push('Opportunistic insider: base 50')
  } else {
    score = 1
    // Routine: accumulates from 1, hard-capped at 49
  }

  const hasRoleData = !!((trade.role ?? '').trim()) || !!((trade.officer_title ?? '').trim())
  const role   = classifyRole(trade)
  const sector = trade.sector ?? ''
  const val    = trade.total_value ?? 0
  const name   = trade.insider_name.toUpperCase()
  const ticker = trade.ticker.toUpperCase()

  // ── Hold period (needed for long-hold bonuses below) ─────────────────────
  const holdDays = holdByRole(role)

  // ── Role bonus / penalty ─────────────────────────────────────────────────
  // Skipped when both role and officer_title are absent — size floor applied
  // instead so trades with missing metadata aren't unfairly penalised.
  //
  // Source alphas vs 3.89% baseline:
  //   CFO +12.61%, CEO +6.40%, 10%Owner +5.75%, Director +3.72%,
  //   President -2.34%, Other/EVP -2.17% (180d: -7.30%)
  if (hasRoleData) {
    if      (role === 'CFO')                { score += 15; factors.push('CFO: +15') }
    else if (role === 'CEO')                { score += 10; factors.push('CEO: +10') }
    else if (role === '10% Owner') {
      score += 8
      factors.push('10% Owner: +8')
      // 10% Owner 180d alpha +15.96% vs 90d +5.75% — strong long-hold case
      if (holdDays > 150) { score += 12; factors.push('10% Owner long-hold bonus (180d alpha +15.96%): +12') }
    }
    else if (role === 'Director')           { score += 2;  factors.push('Director: +2') }
    else if (role === 'President')          { score -= 8;  factors.push('President: -8') }
    else if (role === 'Other/EVP')          { score -= 10; factors.push('Other/EVP: -10') }
    else if (role === 'Insider (other)')    { score -= 15; factors.push('Insider (other): -15') }
    else if (role === 'Co-Founder/Partner') { score -= 20; factors.push('Co-Founder/Partner: -20') }
  }

  // ── Trade size ───────────────────────────────────────────────────────────
  // Best bucket is $500K–$1M (alpha +8.96%, t=1.75) — not the largest trades.
  // >$25M trades show negative 90d alpha (-1.22%).
  if      (val > 25_000_000)  { score -= 10; factors.push('Over $25M trade size: -10') }
  else if (val >= 5_000_000)  { score += 10; factors.push('$5M–$25M trade size: +10') }
  else if (val >= 1_000_000)  { score +=  8; factors.push('$1M–$5M trade size: +8') }
  else if (val >= 500_000)    { score += 15; factors.push('$500K–$1M trade size: +15') }
  else if (val >= 250_000)    { score +=  2; factors.push('$250K–$500K trade size: +2') }
  else if (val > 0)           { score -=  3; factors.push('Under $250K trade size: -3') }

  // ── Sector bonus / penalty ───────────────────────────────────────────────
  // Communication Services t=2.85 (only statistically significant positive).
  // Utilities t=-2.82 (only statistically significant negative).
  // Financial Services weak at 90d (+3.56%) but strong at 180d (+11.26%).
  if      (sector === 'Communication Services') { score += 15; factors.push('Communication Services sector: +15') }
  else if (sector === 'Consumer Cyclical')       { score +=  8; factors.push('Consumer Cyclical sector: +8') }
  else if (sector === 'Industrials')             { score +=  6; factors.push('Industrials sector: +6') }
  else if (sector === 'Technology')              { score +=  5; factors.push('Technology sector: +5') }
  else if (sector === 'Financial Services') {
    score += 5
    factors.push('Financial Services sector: +5')
    // Weak 90d (+3.56%) but strong 180d (+11.26%) — reward long hold
    if (holdDays > 150) { score += 5; factors.push('Financial Services long-hold bonus (180d alpha +11.26%): +5') }
  }
  else if (sector === 'Healthcare')              { score +=  3; factors.push('Healthcare sector: +3') }
  else if (sector === 'Real Estate')             { score +=  3; factors.push('Real Estate sector: +3') }
  else if (sector === 'Energy')                  { /* 0 — n=4, unreliable */ }
  else if (sector === 'Basic Materials')         { /* 0 — n=2, too small  */ }
  else if (sector === 'Consumer Defensive')      { score -= 12; factors.push('Consumer Defensive sector: -12') }
  else if (sector === 'Utilities')               { score -= 15; factors.push('Utilities sector: -15') }

  // ── Cluster count ────────────────────────────────────────────────────────
  // 2–3 insiders: alpha +6.41% vs +3.65% single (+2.76% delta).
  // 4+ insiders: zero trades in dataset — bonus removed entirely.
  if (trade.cluster_count >= 2 && trade.cluster_count <= 3) {
    score += 8
    factors.push(`${trade.cluster_count} insiders same ticker this month: +8`)
  }
  // Note: cluster_count >= 4 intentionally gets no bonus (no empirical support).

  // ── Cluster dollar total ─────────────────────────────────────────────────
  if (trade.cluster_total_value >= 5_000_000) {
    score += 4
    factors.push(`Cluster total $${(trade.cluster_total_value / 1e6).toFixed(1)}M: +4`)
  }

  // ── Market condition (SPY 90d return) ────────────────────────────────────
  // Insiders in falling markets generate the strongest alpha — contrarian signal.
  // SPY < -10%: alpha +13.84%; SPY 0–5%: alpha +1.25% (weakest environment).
  if (spy_90d_return != null) {
    if      (spy_90d_return < -10) { score += 12; factors.push(`SPY ${spy_90d_return.toFixed(1)}% (bear market contrarian): +12`) }
    else if (spy_90d_return < -5)  { score +=  6; factors.push(`SPY ${spy_90d_return.toFixed(1)}% (weak market): +6`) }
    else if (spy_90d_return < 0)   { /* ~0 alpha, no adjustment */ }
    else if (spy_90d_return < 5)   { score -=  3; factors.push(`SPY ${spy_90d_return.toFixed(1)}% (weakest insider alpha env): -3`) }
    // SPY >= 5%: alpha +5–6%, decent — no bonus or penalty
  }

  // ── Trade size relative to insider median ────────────────────────────────
  // 2×–5× own median is the sweet spot: alpha +8.71%, t=1.88.
  // >5× drops to +1.90% — outsized trades aren't reliably better.
  if (trade.insider_median_value && trade.insider_median_value > 0 && val > 0) {
    const ratio = val / trade.insider_median_value
    if      (ratio >= 2 && ratio < 5) { score += 8; factors.push(`Trade ${ratio.toFixed(1)}× insider median (sweet spot): +8`) }
    else if (ratio >= 5)               { score += 2; factors.push(`Trade ${ratio.toFixed(1)}× insider median (>5×): +2`) }
  }

  // ── Track record ─────────────────────────────────────────────────────────
  const insHit = hitRate(insiderHistory)
  if (insHit !== null) {
    if      (insHit >= 0.80) { score += 10; factors.push(`Insider ${Math.round(insHit * 100)}% hit rate (≥5 trades): +10`) }
    else if (insHit >= 0.65) { score +=  5; factors.push(`Insider ${Math.round(insHit * 100)}% hit rate (≥5 trades): +5`) }
  }

  const tikHit = hitRate(tickerHistory)
  if (tikHit !== null) {
    if      (tikHit >= 0.75) { score += 6; factors.push(`Ticker signal history ${Math.round(tikHit * 100)}% bullish: +6`) }
    else if (tikHit >= 0.65) { score += 3; factors.push(`Ticker signal history ${Math.round(tikHit * 100)}% bullish: +3`) }
  }

  // ── High-alpha insider bonus ──────────────────────────────────────────────
  for (const ha of HIGH_ALPHA_INSIDERS) {
    if (name.includes(ha.name) && (ha.ticker === null || ha.ticker === ticker)) {
      score += ha.bonus
      factors.push(`High-alpha insider (${ha.name}): +${ha.bonus}`)
      break
    }
  }

  // ── Local insider bonus ───────────────────────────────────────────────────
  // Local: +5.02% alpha vs +1.56% non-local — measured +3.46% edge.
  if (trade.is_local === true) {
    score += 4
    factors.push('Local insider (same state as HQ): +4')
  }

  // ── Exclusion penalties ───────────────────────────────────────────────────
  const tickerPenalty = EXCLUDED_TICKER_PENALTIES[ticker]
  if (tickerPenalty != null) {
    score += tickerPenalty
    factors.push(`Excluded ticker ${ticker}: ${tickerPenalty}`)
  }

  for (const excl of EXCLUDED_INSIDER_PENALTIES) {
    if (name.includes(excl.name)) {
      score += excl.penalty
      factors.push(`Excluded insider (${excl.name}): ${excl.penalty}`)
      break
    }
  }

  // ── Unknown-role floor (opportunistic only) ───────────────────────────────
  // Prevents large trades with missing SEC metadata from being penalised
  // purely on sector/exclusion adjustments.
  if (!hasRoleData && trade.is_opportunistic) {
    const floor = val >= 5_000_000 ? 55 : val >= 1_000_000 ? 52 : 50
    if (score < floor) {
      score = floor
      factors.push(`Unknown role — size-based floor: ${floor}`)
    }
  }

  // ── Routine trade cap ─────────────────────────────────────────────────────
  if (!trade.is_opportunistic) score = Math.min(49, Math.max(1, score))

  // ── Global clamp ──────────────────────────────────────────────────────────
  score = Math.min(100, Math.max(0, score))

  // ── Classification ────────────────────────────────────────────────────────
  const classification: ConvictionResult['classification'] =
    score >= 85 ? 'HIGH_CONVICTION' :
    score >= 70 ? 'TAKE_TRADE'      :
    score >= 50 ? 'MONITOR'         : 'DO_NOT_TRADE'

  // ── Position multiplier ───────────────────────────────────────────────────
  const positionMultiplier =
    score >= 85 ? 2.0 :
    score >= 70 ? 1.5 : 1.0

  // ── Exit rules ────────────────────────────────────────────────────────────
  const p      = trade.price_per_share
  const round2 = (n: number) => Math.round(n * 100) / 100

  return {
    score,
    classification,
    role,
    factors,
    holdDays,
    positionMultiplier,
    exitRules: {
      stopLoss:        -0.15,
      takeProfit:       0.25,
      holdDays,
      stopLossPrice:   p ? round2(p * 0.85) : null,
      takeProfitPrice: p ? round2(p * 1.25) : null,
    },
  }
}
