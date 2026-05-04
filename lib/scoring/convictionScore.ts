// Scoring uses a lookup table derived from backtest analysis of unclassifiable
// insider purchases (output/unclassifiable_backtest.csv → output/filter_rankings.txt).
// Each entry maps a (role, sector, min_value) combination to a 1-100 Sentra score
// calibrated by confidence-weighted alpha: score = avg_alpha_180d * ln(n), ranked
// across 820 combinations and linearly scaled to 1-100.
// See scripts/_filter_rankings.mjs for the derivation.

import lookupData from '../../output/sentra_score_lookup.json'

// ─── Lookup types ─────────────────────────────────────────────────────────────

type FilterEntry = {
  rank:             number
  sentra_score:     number
  role:             string | null
  sector:           string | null
  min_value:        number
  max_drawdown_30d: number | null
  n:                number
  avg_alpha_180d:   number
  hit_rate_180d:    number
  conf_score:       number
}

const FILTERS: FilterEntry[] = (lookupData as { filters: FilterEntry[] }).filters

// Pre-filter to only entries with no drawdown constraint — these are the only
// ones applicable at trade entry time before a drawdown can be observed.
const ENTRY_FILTERS = FILTERS.filter(f => f.max_drawdown_30d === null)

// ─── Exclusion tables ─────────────────────────────────────────────────────────

export const EXCLUDED_TICKER_PENALTIES: Record<string, number> = {
  MSTR: -25,
  VST:  -12,
  CVS:  -12,
  VRTX: -12,
  GME:  -12,
  ALLE: -12,
  CRL:  -12,
}

export const EXCLUDED_INSIDER_PENALTIES: Array<{ name: string; penalty: number }> = [
  { name: 'PATTEN JARROD M',   penalty: -20 },
  { name: 'HELM SCOTT B',      penalty: -12 },
  { name: 'WALLMAN RICHARD F', penalty:  -8 },
  { name: 'STONE JOHN H',      penalty:  -8 },
  { name: 'CHENG LAWRENCE',    penalty:  -8 },
]

export const EXCLUDED_TICKERS  = Object.keys(EXCLUDED_TICKER_PENALTIES)
export const EXCLUDED_INSIDERS = EXCLUDED_INSIDER_PENALTIES.map(e => e.name)

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

function holdByRole(role: string): number {
  if (role === 'CFO' || role === '10% Owner') return 180
  if (role === 'CEO' || role === 'Director')  return 90
  if (role === 'Other/EVP')                   return 60
  return 150
}

// ─── Lookup scorer ────────────────────────────────────────────────────────────

function lookupScore(
  role:         string,
  sector:       string,
  total_value:  number,
): { score: number; factor: string } {
  if (total_value < 100_000) {
    return { score: 0, factor: 'Trade value < $100K: score 0' }
  }

  const match = ENTRY_FILTERS.find(f =>
    (f.role   === null || f.role   === role)   &&
    (f.sector === null || f.sector === sector) &&
    total_value >= f.min_value
  )

  if (!match) {
    return { score: 1, factor: 'No matching filter combination: score 1' }
  }

  const sizeLabel = match.min_value >= 25_000_000 ? '$25M+' :
                    match.min_value >= 5_000_000  ? '$5M+'  :
                    match.min_value >= 1_000_000  ? '$1M+'  :
                    match.min_value >= 500_000    ? '$500K+' :
                    match.min_value >= 250_000    ? '$250K+' : '$100K+'

  const roleLabel   = match.role   ?? 'all roles'
  const sectorLabel = match.sector ?? 'all sectors'
  const factor = `Lookup rank ${match.rank}: ${roleLabel} · ${sectorLabel} · ${sizeLabel} — n=${match.n}, avg α=${match.avg_alpha_180d.toFixed(1)}%, hit=${(match.hit_rate_180d * 100).toFixed(0)}%`

  return { score: match.sentra_score, factor }
}

// ─── Main scoring function ────────────────────────────────────────────────────

export function computeConvictionScore(
  trade:           ConvictionTrade,
  _insiderHistory: TradeOutcome[],
  _tickerHistory:  TradeOutcome[],
  _spy_90d_return?: number | null,
): ConvictionResult {
  const factors: string[] = []

  const role   = classifyRole(trade)
  const sector = trade.sector ?? ''
  const val    = trade.total_value ?? 0
  const name   = trade.insider_name.toUpperCase()
  const ticker = trade.ticker.toUpperCase()

  // ── Lookup base score ─────────────────────────────────────────────────────
  const { score: baseScore, factor: lookupFactor } = lookupScore(role, sector, val)
  let score = baseScore
  factors.push(lookupFactor)

  // ── Small-trade cap ───────────────────────────────────────────────────────
  // Trades under $250K can match large generic fallback filters (e.g. Director ·
  // all sectors · $100K+, n=1270) whose high n inflates the confidence score
  // despite weak alpha. Cap these at 30 so small trades stay in MONITOR/DO_NOT_TRADE.
  if (val < 250_000 && score > 30) {
    score = 30
    factors.push('Trade value < $250K: capped at 30')
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

  // ── Global clamp ──────────────────────────────────────────────────────────
  score = Math.min(100, Math.max(0, score))

  // ── Classification ────────────────────────────────────────────────────────
  const classification: ConvictionResult['classification'] =
    score >= 70 ? 'HIGH_CONVICTION' :
    score >= 60 ? 'TAKE_TRADE'      :
    score >= 50 ? 'MONITOR'         : 'DO_NOT_TRADE'

  // ── Hold period and position sizing ───────────────────────────────────────
  const holdDays           = holdByRole(role)
  const positionMultiplier = score >= 85 ? 2.0 : score >= 70 ? 1.5 : 1.0

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
