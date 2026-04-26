// Pure conviction scoring — no I/O. All inputs pre-fetched by caller.
// Based on docs/trading-system-spec.md (340-trade backtest, 2015–2026).

export const EXCLUDED_TICKERS  = ['CVS', 'VST', 'MSTR', 'VRTX', 'GME', 'ALLE', 'CRL']
export const EXCLUDED_INSIDERS = [
  'WALLMAN RICHARD F', 'HELM SCOTT B', 'Patten Jarrod M',
  'Cheng Lawrence', 'Stone John H',
]

// ─── Input types ──────────────────────────────────────────────────────────────

export type ConvictionTrade = {
  ticker:               string
  insider_name:         string
  officer_title:        string | null
  role:                 string | null
  total_value:          number | null
  price_per_share:      number | null
  transaction_date:     string
  is_opportunistic:     boolean
  is_local:             boolean | null
  sector:               string | null
  cluster_count:        number        // distinct insiders buying same ticker this calendar month
  cluster_total_value:  number        // total dollar value of all buys in that cluster
  insider_median_value: number | null // median past trade size for this insider
}

// isPositive = market-adjusted return was positive (used for hit rate calculation).
// alpha is optional — used if available (e.g. from backtest data).
export type TradeOutcome = {
  isPositive: boolean
  alpha?: number | null
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
    stopLoss:          number        // fraction, e.g. -0.10
    takeProfit:        number        // fraction, e.g. 0.25
    holdDays:          number
    stopLossPrice:     number | null // stopLoss applied to price_per_share
    takeProfitPrice:   number | null
  }
}

// ─── Role classifier (matches Cohen-Malloy-Pomorski field conventions) ────────

export function classifyRole(trade: Pick<ConvictionTrade, 'role' | 'officer_title'>): string {
  const r = (trade.role ?? '').toLowerCase()
  const t = (trade.officer_title ?? '').toLowerCase()
  if (r.includes('ceo') || r.includes('chief executive') || t.includes('ceo') || t.includes('chief executive')) return 'CEO'
  if (r.includes('cfo') || r.includes('chief financial')  || t.includes('cfo') || t.includes('chief financial'))  return 'CFO'
  if (r.includes('president') || t.includes('president'))  return 'President'
  if (r.includes('director'))                              return 'Director'
  if (r.includes('10%') || t.includes('10%'))              return '10% Owner'
  if (r.includes('co-founder') || r.includes('partner'))   return 'Co-Founder/Partner'
  if (r.includes('insider'))                               return 'Insider (other)'
  return 'Other/EVP'
}

// ─── Hold period tables ───────────────────────────────────────────────────────

function holdByRole(role: string): number {
  if (role === '10% Owner' || role === 'CFO' || role === 'Other/EVP') return 180
  if (role === 'CEO') return 150
  if (role === 'Director') return 90
  return 150
}

function holdBySector(sector: string | null): number {
  if (!sector) return 150
  if (sector === 'Financial Services' || sector === 'Healthcare') return 180
  if (sector === 'Communication Services') return 150
  if (sector === 'Technology' || sector === 'Industrials') return 90
  if (sector === 'Consumer Cyclical') return 60
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
  insiderHistory: TradeOutcome[],  // past trades by this insider with outcome flags
  tickerHistory:  TradeOutcome[],  // past monthly signals for this ticker
): ConvictionResult {
  const factors: string[] = []
  let score = 0

  // Routine trades accumulate from 0 (capped at 49).
  // Opportunistic trades start at 50.
  if (trade.is_opportunistic) {
    score = 50
    factors.push('Opportunistic insider classification: base 50')
  }

  const role   = classifyRole(trade)
  const sector = trade.sector ?? ''
  const val    = trade.total_value ?? 0

  // ── Role bonuses (mutually exclusive; highest-ranked wins) ─────────────────
  if      (role === '10% Owner') { score += 12; factors.push('10% Owner: +12') }
  else if (role === 'CFO')       { score += 8;  factors.push('CFO: +8') }
  else if (role === 'CEO')       { score += 5;  factors.push('CEO: +5') }
  // Director, President, Other/EVP, etc. earn no role bonus

  // ── Sector bonuses ─────────────────────────────────────────────────────────
  if      (sector === 'Financial Services')     { score += 8; factors.push('Financial Services sector: +8') }
  else if (sector === 'Communication Services') { score += 7; factors.push('Communication Services sector: +7') }
  else if (sector === 'Industrials')            { score += 4; factors.push('Industrials sector: +4') }

  // ── Sector penalties ───────────────────────────────────────────────────────
  if (sector === 'Energy' || sector === 'Utilities') {
    score -= 10; factors.push('Energy/Utilities sector: -10')
  } else if (sector === 'Consumer Defensive') {
    score -= 8; factors.push('Consumer Defensive sector: -8')
  }

  // ── Trade size ─────────────────────────────────────────────────────────────
  if (val >= 1_000_000 && val <= 25_000_000) {
    score += 10; factors.push('$1M–$25M trade size: +10')
  }

  // ── Conviction proxy: size vs insider's median ─────────────────────────────
  if (trade.insider_median_value && val > 0) {
    const ratio = val / trade.insider_median_value
    if (ratio >= 2 && ratio <= 5) {
      score += 4; factors.push('Trade 2x–5x insider median: +4')
    }
  }

  // ── Cluster count ──────────────────────────────────────────────────────────
  if (trade.cluster_count >= 4) {
    score += 8; factors.push(`${trade.cluster_count} insiders same ticker this month: +8`)
  }

  // ── Cluster dollar total ───────────────────────────────────────────────────
  if (trade.cluster_total_value >= 5_000_000) {
    const cval = trade.cluster_total_value >= 1e6
      ? `$${(trade.cluster_total_value / 1e6).toFixed(1)}M`
      : `$${(trade.cluster_total_value / 1e3).toFixed(0)}K`
    score += 6; factors.push(`Cluster total ${cval} this month: +6`)
  }

  // ── Insider track record ───────────────────────────────────────────────────
  // Note: uses 5d adjusted returns as proxy in live DB; full 90d data from backtest CSV.
  const insHit = hitRate(insiderHistory)
  if (insHit !== null && insHit >= 0.65) {
    score += 5; factors.push(`Insider track record ${Math.round(insHit * 100)}% hit rate: +5`)
  }

  // ── Ticker track record ────────────────────────────────────────────────────
  const tikHit = hitRate(tickerHistory)
  if (tikHit !== null && tikHit >= 0.65) {
    score += 5; factors.push(`Ticker signal history ${Math.round(tikHit * 100)}% bullish: +5`)
  }

  // ── Local insider ──────────────────────────────────────────────────────────
  if (trade.is_local === true) {
    score += 3; factors.push('Local insider (same state as HQ): +3')
  }

  // ── Exclusion penalties ────────────────────────────────────────────────────
  if (EXCLUDED_TICKERS.includes(trade.ticker.toUpperCase())) {
    score -= 15; factors.push('Excluded ticker (negative alpha history): -15')
  }
  const isExcludedInsider = EXCLUDED_INSIDERS.some(
    name => trade.insider_name.toUpperCase().includes(name.toUpperCase())
  )
  if (isExcludedInsider) {
    score -= 20; factors.push('Excluded insider (negative alpha history): -20')
  }

  // Cap routine trades at 49; floor at 1 (routine trades always get at least a score)
  if (!trade.is_opportunistic) score = Math.min(49, Math.max(1, score))

  // Global clamp
  score = Math.min(100, Math.max(0, score))

  // ── Hold period: take the minimum of role and sector recommendations ────────
  const holdRole   = holdByRole(role)
  const holdSector = holdBySector(trade.sector)
  const holdDays   = Math.min(holdRole, holdSector)

  // ── Classification ─────────────────────────────────────────────────────────
  const classification =
    score >= 85 ? 'HIGH_CONVICTION' :
    score >= 70 ? 'TAKE_TRADE'      :
    score >= 50 ? 'MONITOR'         : 'DO_NOT_TRADE'

  // ── Position multiplier (multiplicative, cap 2×) ───────────────────────────
  let multiplier = 1.0
  if (trade.insider_median_value && val > 0) {
    const r = val / trade.insider_median_value
    if (r >= 2 && r <= 5) multiplier *= 1.5
  }
  if (insHit !== null && insHit >= 0.65) multiplier *= 1.25
  if (tikHit !== null && tikHit >= 0.65) multiplier *= 1.25
  if (trade.cluster_count >= 4)          multiplier *= 1.5
  multiplier = Math.min(2.0, Math.round(multiplier * 100) / 100)

  // ── Exit rules ─────────────────────────────────────────────────────────────
  const p = trade.price_per_share
  const r = (n: number) => Math.round(n * 100) / 100

  return {
    score,
    classification,
    role,
    factors,
    holdDays,
    positionMultiplier: multiplier,
    exitRules: {
      stopLoss:          -0.10,
      takeProfit:         0.25,
      holdDays,
      stopLossPrice:    p ? r(p * 0.90) : null,
      takeProfitPrice:  p ? r(p * 1.25) : null,
    },
  }
}
