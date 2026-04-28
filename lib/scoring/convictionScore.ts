// Pure conviction scoring — no I/O. All inputs pre-fetched by caller.
// Calibrated from backtest of 340 insider trades, 2015–2026.

// ─── Exclusion tables (per-item penalties) ────────────────────────────────────

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

// Flat exports for backward compatibility with other callers.
export const EXCLUDED_TICKERS  = Object.keys(EXCLUDED_TICKER_PENALTIES)
export const EXCLUDED_INSIDERS = EXCLUDED_INSIDER_PENALTIES.map(e => e.name)

// Known high-alpha insiders. Both "LAST FIRST" and "FIRST LAST" orderings are
// listed to handle either SEC filing name format. ticker=null applies at any ticker.
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
  is_inferred_opportunistic?: boolean  // true = inferred (base 45) vs confirmed (base 50)
  is_local:                   boolean | null
  sector:                     string | null
  cluster_count:              number        // distinct insiders buying same ticker this calendar month
  cluster_total_value:        number        // total $ of all buys in that cluster
  insider_median_value:       number | null // median past trade size for this insider
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
    stopLoss:         number
    takeProfit:       number
    holdDays:         number
    stopLossPrice:    number | null
    takeProfitPrice:  number | null
  }
}

// ─── Role classifier ──────────────────────────────────────────────────────────
// Priority: CEO/CFO first, then 10% Owner (before President so pure owners
// get the correct +20 bonus), then Co-Founder/Partner, then President.

export function classifyRole(trade: Pick<ConvictionTrade, 'role' | 'officer_title'>): string {
  const r = (trade.role          ?? '').toLowerCase()
  const t = (trade.officer_title ?? '').toLowerCase()
  if (r.includes('ceo')        || r.includes('chief executive') ||
      t.includes('ceo')        || t.includes('chief executive'))  return 'CEO'
  if (r.includes('cfo')        || r.includes('chief financial')  ||
      t.includes('cfo')        || t.includes('chief financial'))   return 'CFO'
  if (r.includes('10%')        || t.includes('10%'))               return '10% Owner'
  if (r.includes('co-founder') || r.includes('partner'))           return 'Co-Founder/Partner'
  if (r.includes('president')  || t.includes('president'))         return 'President'
  if (r.includes('director'))                                       return 'Director'
  if (r.includes('insider'))                                        return 'Insider (other)'
  return 'Other/EVP'
}

// ─── Hold period ──────────────────────────────────────────────────────────────

function holdByRole(role: string): number {
  if (role === '10% Owner' || role === 'CFO') return 180
  if (role === 'CEO'       || role === 'Director') return 90
  return 150
}

// ─── Hit rate helper ──────────────────────────────────────────────────────────

function hitRate(history: TradeOutcome[]): number | null {
  if (history.length < 5) return null
  return history.filter(h => h.isPositive).length / history.length
}

// ─── Main scoring function ────────────────────────────────────────────────────

export function computeConvictionScore(
  trade:          ConvictionTrade,
  insiderHistory: TradeOutcome[],
  tickerHistory:  TradeOutcome[],
): ConvictionResult {
  const factors: string[] = []
  let score = 0

  // ── Starting points ────────────────────────────────────────────────────────
  if (trade.is_opportunistic && trade.is_inferred_opportunistic) {
    score = 45
    factors.push('Inferred opportunistic: base 45')
  } else if (trade.is_opportunistic) {
    score = 50
    factors.push('Opportunistic insider: base 50')
  } else {
    score = 1
    // routine: accumulates from 1, hard-capped at 49 before global clamp
  }

  const hasRoleData = !!((trade.role ?? '').trim()) || !!((trade.officer_title ?? '').trim())
  const role   = classifyRole(trade)
  const sector = trade.sector ?? ''
  const val    = trade.total_value ?? 0
  const name   = trade.insider_name.toUpperCase()
  const ticker = trade.ticker.toUpperCase()

  // ── Role bonus / penalty ───────────────────────────────────────────────────
  // Skipped when both role and officer_title are absent — a size-based floor
  // is applied instead (see below) so the trade isn't penalised for missing data.
  if (hasRoleData) {
    if      (role === '10% Owner')          { score += 20; factors.push('10% Owner: +20') }
    else if (role === 'CFO')                { score += 12; factors.push('CFO: +12') }
    else if (role === 'CEO')                { score += 10; factors.push('CEO: +10') }
    else if (role === 'Other/EVP')          { score += 8;  factors.push('Other/EVP: +8') }
    else if (role === 'Director')           { score += 3;  factors.push('Director: +3') }
    else if (role === 'President')          { score += 2;  factors.push('President: +2') }
    else if (role === 'Insider (other)')    { score -= 15; factors.push('Insider (other): -15') }
    else if (role === 'Co-Founder/Partner') { score -= 20; factors.push('Co-Founder/Partner: -20') }
  }

  // ── Trade size ─────────────────────────────────────────────────────────────
  if      (val > 25_000_000) { score -= 10; factors.push('Over $25M trade size: -10') }
  else if (val >= 5_000_000) { score += 15; factors.push('$5M–$25M trade size: +15') }
  else if (val >= 1_000_000) { score += 10; factors.push('$1M–$5M trade size: +10') }
  else if (val >= 500_000)   { score += 8;  factors.push('$500K–$1M trade size: +8') }
  else if (val >= 250_000)   { score += 2;  factors.push('$250K–$500K trade size: +2') }
  else if (val > 0)          { score -= 5;  factors.push('Under $250K trade size: -5') }

  // ── Sector bonus / penalty ─────────────────────────────────────────────────
  if      (sector === 'Communication Services') { score += 12; factors.push('Communication Services sector: +12') }
  else if (sector === 'Financial Services')      { score += 10; factors.push('Financial Services sector: +10') }
  else if (sector === 'Industrials')             { score += 6;  factors.push('Industrials sector: +6') }
  else if (sector === 'Consumer Cyclical')       { score += 4;  factors.push('Consumer Cyclical sector: +4') }
  else if (sector === 'Healthcare')              { score += 3;  factors.push('Healthcare sector: +3') }
  else if (sector === 'Technology')              { score += 2;  factors.push('Technology sector: +2') }
  else if (sector === 'Energy')                  { score -= 12; factors.push('Energy sector: -12') }
  else if (sector === 'Utilities')               { score -= 15; factors.push('Utilities sector: -15') }
  else if (sector === 'Consumer Defensive')      { score -= 18; factors.push('Consumer Defensive sector: -18') }

  // ── Cluster count ──────────────────────────────────────────────────────────
  if      (trade.cluster_count >= 4) { score += 12; factors.push(`${trade.cluster_count} insiders same ticker this month: +12`) }
  else if (trade.cluster_count === 3) { score += 8;  factors.push('3 insiders same ticker this month: +8') }
  else if (trade.cluster_count === 2) { score += 4;  factors.push('2 insiders same ticker this month: +4') }

  // ── Cluster dollar total ───────────────────────────────────────────────────
  const cval = trade.cluster_total_value
  if      (cval >= 5_000_000) { score += 8; factors.push(`Cluster total $${(cval / 1e6).toFixed(1)}M: +8`) }
  else if (cval >= 1_000_000) { score += 4; factors.push(`Cluster total $${(cval / 1e6).toFixed(1)}M: +4`) }

  // ── Track record ───────────────────────────────────────────────────────────
  const insHit = hitRate(insiderHistory)
  if (insHit !== null) {
    if      (insHit >= 0.80) { score += 10; factors.push(`Insider ${Math.round(insHit * 100)}% hit rate (≥5 trades): +10`) }
    else if (insHit >= 0.65) { score += 5;  factors.push(`Insider ${Math.round(insHit * 100)}% hit rate (≥5 trades): +5`) }
  }

  const tikHit = hitRate(tickerHistory)
  if (tikHit !== null) {
    if      (tikHit >= 0.75) { score += 6; factors.push(`Ticker signal history ${Math.round(tikHit * 100)}% bullish: +6`) }
    else if (tikHit >= 0.65) { score += 3; factors.push(`Ticker signal history ${Math.round(tikHit * 100)}% bullish: +3`) }
  }

  // ── High-alpha insider bonus ───────────────────────────────────────────────
  for (const ha of HIGH_ALPHA_INSIDERS) {
    if (name.includes(ha.name) && (ha.ticker === null || ha.ticker === ticker)) {
      score += ha.bonus
      factors.push(`High-alpha insider (${ha.name}): +${ha.bonus}`)
      break
    }
  }

  // ── Local insider bonus ────────────────────────────────────────────────────
  if (trade.is_local === true) {
    score += 4
    factors.push('Local insider (same state as HQ): +4')
  }

  // ── Exclusion penalties ────────────────────────────────────────────────────
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
  // When no role data is available, sector/exclusion penalties can drag an
  // opportunistic trade below its base. Apply a size-based minimum so large
  // trades with missing metadata aren't unfairly penalised.
  if (!hasRoleData && trade.is_opportunistic) {
    const floor = val >= 5_000_000 ? 55 : val >= 1_000_000 ? 52 : 50
    if (score < floor) {
      score = floor
      factors.push(`Unknown role - size-based floor: ${floor}`)
    }
  }

  // ── Routine trade cap ──────────────────────────────────────────────────────
  if (!trade.is_opportunistic) score = Math.min(49, Math.max(1, score))

  // ── Global clamp ───────────────────────────────────────────────────────────
  score = Math.min(100, Math.max(0, score))

  // ── Classification ─────────────────────────────────────────────────────────
  const classification: ConvictionResult['classification'] =
    score >= 85 ? 'HIGH_CONVICTION' :
    score >= 70 ? 'TAKE_TRADE'      :
    score >= 50 ? 'MONITOR'         : 'DO_NOT_TRADE'

  // ── Hold period ────────────────────────────────────────────────────────────
  const holdDays = holdByRole(role)

  // ── Position multiplier ────────────────────────────────────────────────────
  const positionMultiplier =
    score >= 85 ? 2.0 :
    score >= 70 ? 1.5 : 1.0

  // ── Exit rules ─────────────────────────────────────────────────────────────
  const p       = trade.price_per_share
  const round2  = (n: number) => Math.round(n * 100) / 100

  return {
    score,
    classification,
    role,
    factors,
    holdDays,
    positionMultiplier,
    exitRules: {
      stopLoss:        -0.10,
      takeProfit:       0.25,
      holdDays,
      stopLossPrice:   p ? round2(p * 0.90) : null,
      takeProfitPrice: p ? round2(p * 1.25) : null,
    },
  }
}
