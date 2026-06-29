// Insider trade scoring engine — walk-forward validated factors only.
//
// TWO CHANNELS:
//   color  = CMP classification (green/yellow/red) — not predicted by the number
//   score  = 0-100 RELATIVE RANKING within classification, not a profit prediction
//
// Validated factors (walk-forward IC scan, backtest 2021–2025):
//   • Stake increase %   IC ≈ +0.04 (Pearson + Spearman consistent)
//   • Price momentum 90d IC ≈ +0.06 (UNCL/ROUT only; OPP flat)
//   • Role               IC ≈ −0.05 (mild mean-reversion; smaller role tiers score higher)
//   • Cap tilt           IC ≈ −0.11 Pearson / ~0 Spearman (lottery effect, modest weight)
//
// Composite IC ≈ 0.05–0.09.  Score = "top X% of [classification] buys by these signals."
// This is descriptive (notable trade characteristics), not predictive (profit likelihood).
//
// Factors explicitly excluded (noise or lookahead):
//   track record, cluster buying, trade size, insider breadth, sector, volatility.

// ─── Types ───────────────────────────────────────────────────────────────────

export type ConvictionTrade = {
  ticker:                     string
  insider_name:               string
  officer_title:              string | null
  role:                       string | null
  total_value:                number | null
  price_per_share:            number | null
  transaction_date:           string
  is_opportunistic:           boolean                    // kept for backward compat
  is_inferred_opportunistic?: boolean
  is_local:                   boolean | null
  sector:                     string | null
  cluster_count:              number
  cluster_total_value:        number
  insider_median_value:       number | null
  // ── New validated-factor inputs (all optional; graceful null handling) ───
  classification?:     'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null
  shares?:             number | null
  shares_owned_after?: number | null
  market_cap?:         number | null
  // 90d stock return BEFORE trade (e.g., +12.5 means stock rose 12.5%).
  // null → graceful neutral (20 pts = sigmoid midpoint). UNCL/ROUT only.
  momentum_90d?:       number | null
}

export type TradeOutcome = {
  isPositive: boolean
  alpha?:     number | null
}

export type ScoreBreakdown = {
  factor:    string   // human label shown in tap-to-explain UI
  points:    number   // actual points awarded for this trade
  maxPoints: number   // maximum this factor can contribute
  reason:    string   // one-line explanation with the raw input value
}

// score: within-classification percentile rank (0 = bottom, 100 = top).
//        Label in UI as "top X% of [green/yellow/red] buys by conviction signals."
// color: CMP classification — shown separately from the number.
// tier:  coarse label derived from score for backward-compat callers.
export type ConvictionResult = {
  score:              number
  color:              'green' | 'yellow' | 'red' | 'gray'
  breakdown:          ScoreBreakdown[]
  // Backward-compat fields kept for existing API consumers
  classification:     'HIGH_CONVICTION' | 'TAKE_TRADE' | 'MONITOR' | 'DO_NOT_TRADE'
  role:               string
  factors:            string[]  // = breakdown.map(b => b.reason)
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

// ─── Role classifier (unchanged — also used by scripts) ──────────────────────

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

// ─── Hold period (exported for callers that store it separately) ──────────────

export function holdByRole(role: string): number {
  if (role === 'CFO' || role === '10% Owner') return 180
  if (role === 'CEO' || role === 'Director')  return 90
  if (role === 'Other/EVP')                   return 60
  return 150
}

// ─── Factor formulas ─────────────────────────────────────────────────────────
// Each returns a numeric score in [0, maxBudget].

// F1 — Stake increase (max 30 pts)
// Michaelis-Menten: half-saturation at 50% stake increase.
//
// New positions (no prior holdings) cannot be scored by %, so we use dollar size instead:
//   < $50K   →  5 pts  — nominal / compliance-sized, not a conviction signal
//   $50K–500K → 15 pts  — meaningful personal investment
//   > $500K  → 25 pts  — large new bet, real conviction
//   (capped at 25/30: a proportional increase on an existing holding is a cleaner
//    signal than a first-ever purchase, which could be a new hire or compliance buy)
function f1_stakePts(
  shares:          number|null|undefined,
  sharesOwnedAfter: number|null|undefined,
  totalValue:      number|null|undefined,
): {pts: number; reason: string} {
  if (!shares || shares <= 0 || !sharesOwnedAfter) {
    return { pts: 0, reason: 'Stake increase: no holdings data → 0/30 pts' }
  }
  const before = sharesOwnedAfter - shares

  if (before <= 0) {
    // New position — no prior holdings. Score by dollar size, cap at 25.
    const tv  = totalValue ?? 0
    const pts = tv >= 500_000 ? 25 : tv >= 50_000 ? 15 : 5
    const tvLabel = tv >= 1e6 ? `$${(tv/1e6).toFixed(1)}M`
                  : tv >= 1e3 ? `$${(tv/1e3).toFixed(0)}K`
                  : `$${tv.toFixed(0)}`
    const tier = tv >= 500_000 ? 'large new bet' : tv >= 50_000 ? 'moderate new bet' : 'nominal/compliance'
    return {
      pts,
      reason: `Stake increase: new position ${tvLabel} (${tier}, no prior holdings) → ${pts}/30 pts`,
    }
  }

  const pct = (shares / before) * 100
  const pts = Math.round((30 * pct / (pct + 50)) * 10) / 10
  const pctLabel = pct >= 1000 ? '>1000%' : `${pct.toFixed(0)}%`
  return { pts, reason: `Stake increase: bought ${pctLabel} of prior holdings → ${pts}/30 pts` }
}

// F2 — Price momentum 90d (max 40 pts; UNCL/ROUT only)
// Sigmoid centered at +5% (slight positive momentum = neutral midpoint).
// null → 20 pts (neutral, sigmoid midpoint) so denominator stays constant at 90.
function f2_momPts(mom: number|null|undefined, applicable: boolean): {pts: number; reason: string} {
  if (!applicable) {
    return { pts: 0, reason: 'Price momentum: not used for Opportunistic trades (IC ≈ 0)' }
  }
  if (mom == null) {
    return { pts: 20, reason: 'Price momentum: unavailable → neutral 20/40 pts' }
  }
  const pts = Math.round((40 / (1 + Math.exp(-(mom - 5) / 25))) * 10) / 10
  const dir = mom >= 5 ? `+${mom.toFixed(1)}%` : `${mom.toFixed(1)}%`
  const label = mom > 15 ? 'strong uptrend' : mom > 0 ? 'mild uptrend' : mom > -15 ? 'mild pullback' : 'sharp pullback'
  return { pts, reason: `Price momentum: stock ${dir} in 90d before trade (${label}) → ${pts}/40 pts` }
}

// F3 — Role (3-tier static table; max 12 pts)
// Tier A: concentrated / long-horizon holders (10% Owner, Co-Founder)
// Tier B: standard C-suite and board (CEO, CFO, President, Director)
// Tier C: other titles (less differentiated)
// Negative walk-forward IC means recently "hot" roles slightly disappoint.
// Static table approximates this without requiring a rolling window.
function f3_rolePts(role: string): {pts: number; reason: string} {
  if (role === '10% Owner' || role === 'Co-Founder/Partner') {
    return { pts: 12, reason: `Role: ${role} (concentrated / long-horizon stake) → 12/12 pts` }
  }
  if (['CEO','CFO','President','Director'].includes(role)) {
    return { pts: 9, reason: `Role: ${role} (standard officer/director) → 9/12 pts` }
  }
  return { pts: 7, reason: `Role: ${role} (other/EVP — mild mean-reversion discount) → 7/12 pts` }
}

// F4 — Cap tilt (max 8 pts)
// Smaller cap → higher points. Pearson IC −0.11, Spearman ≈ 0.
// IMPORTANT: labeled in breakdown as a LOTTERY TILT, not a consistent edge.
// Anchored: $200M → 8 pts, $50B → 0 pts, log-linear between.
function f4_capPts(marketCap: number|null|undefined): {pts: number; reason: string} {
  if (!marketCap || marketCap <= 0) {
    return { pts: 4, reason: 'Cap tilt: market cap unknown → neutral 4/8 pts' }
  }
  const logMC = Math.log10(marketCap)
  const pts = Math.round(8 * Math.max(0, Math.min(1, (10.7 - logMC) / 2.4)) * 10) / 10
  const mcLabel = marketCap >= 1e12 ? `$${(marketCap/1e12).toFixed(1)}T`
                : marketCap >= 1e9  ? `$${(marketCap/1e9).toFixed(1)}B`
                : `$${(marketCap/1e6).toFixed(0)}M`
  return {
    pts,
    reason: `Cap tilt: ${mcLabel} market cap → ${pts}/8 pts ` +
             `(size tilt — Pearson IC 0.11, Spearman ≈ 0: adds high-variance upside, not consistent edge)`,
  }
}

// ─── Percentile anchor arrays (calibrated from 17,264 backtest buys) ─────────
// 19 anchors per classification: p5, p10, p15, ..., p95 of raw composite score.
// Raw composite ∈ [0, 1]. Binary-search + interpolate to get 0–100 rank.
// Recalibrate with npx tsx scripts/calibrate-score.ts if factor formulas change.
const ANCHORS: Record<string, number[]> = {
  OPPORTUNISTIC:  [0.21445,0.2389,0.25249,0.27347,0.28666,0.30009,0.30429,0.31587,0.32406,0.33035,0.34115,0.35066,0.3655,0.38582,0.40904,0.44272,0.49976,0.55923,0.66657],
  UNCLASSIFIABLE: [0.34896,0.36552,0.37794,0.38316,0.39066,0.39696,0.40478,0.41191,0.41839,0.42596,0.43481,0.44368,0.45493,0.47256,0.49498,0.51933,0.54464,0.57778,0.62615],
  ROUTINE:        [0.34376,0.35575,0.36538,0.37494,0.38087,0.38521,0.38946,0.39446,0.3996,0.40457,0.40691,0.412,0.41822,0.42585,0.43142,0.44363,0.4546,0.49263,0.55333],
}

// Map raw composite [0,1] to percentile rank [0,100] using anchor array.
// Anchors are [p5, p10, ..., p95]. Linear interpolation within each bracket.
function rawToPercentile(raw: number, anchors: number[]): number {
  const n = anchors.length  // 19
  if (raw <= anchors[0])  return Math.round(5  * raw / anchors[0])       // 0–5
  if (raw >= anchors[n-1]) return Math.round(95 + 5 * Math.min((raw - anchors[n-1]) / (1 - anchors[n-1]), 1))  // 95–100

  for (let i = 0; i < n - 1; i++) {
    if (raw <= anchors[i+1]) {
      const frac = (raw - anchors[i]) / (anchors[i+1] - anchors[i])
      return Math.round((i + 1) * 5 + frac * 5)  // each bracket = 5 percentile pts
    }
  }
  return 95
}

// ─── Main scoring function ────────────────────────────────────────────────────

export function computeConvictionScore(
  trade:           ConvictionTrade,
  _insiderHistory: TradeOutcome[],
  _tickerHistory:  TradeOutcome[],
  _spy_90d_return?: number | null,
): ConvictionResult {
  const role     = classifyRole(trade)
  const holdDays = holdByRole(role)
  const p        = trade.price_per_share
  const round2   = (n: number) => Math.round(n * 100) / 100

  // Resolve CMP classification — prefer explicit field, fall back to is_opportunistic boolean.
  const cls: 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null =
    trade.classification != null ? trade.classification
    : trade.is_opportunistic     ? 'OPPORTUNISTIC'
    : null

  const color: ConvictionResult['color'] =
    cls === 'OPPORTUNISTIC'  ? 'green'  :
    cls === 'UNCLASSIFIABLE' ? 'yellow' :
    cls === 'ROUTINE'        ? 'red'    : 'gray'

  // ── Compute factor points ──────────────────────────────────────────────────
  const momApplicable = cls === 'UNCLASSIFIABLE' || cls === 'ROUTINE'

  const f1 = f1_stakePts(trade.shares, trade.shares_owned_after, trade.total_value)
  const f2 = f2_momPts(trade.momentum_90d, momApplicable)
  const f3 = f3_rolePts(role)
  const f4 = f4_capPts(trade.market_cap)

  // Raw composite [0, 1]
  const rawPts = f1.pts + (momApplicable ? f2.pts : 0) + f3.pts + f4.pts
  const maxPts = 30 + (momApplicable ? 40 : 0) + 12 + 8
  const raw    = rawPts / maxPts

  // Map to 0-100 percentile within classification
  let score: number
  if (cls != null && ANCHORS[cls]) {
    score = rawToPercentile(raw, ANCHORS[cls])
  } else {
    // Unclassified trades: use a flat universal score based on raw only
    // (no classification = no relative context = score 0-50 max)
    score = Math.round(raw * 50)
  }
  score = Math.max(0, Math.min(100, score))

  // Breakdown for tap-to-explain
  const breakdown: ScoreBreakdown[] = [
    { factor: 'Stake increase',     points: f1.pts, maxPoints: 30,                reason: f1.reason },
    ...(momApplicable ? [{ factor: 'Price momentum', points: f2.pts, maxPoints: 40, reason: f2.reason }] : []),
    { factor: 'Role',               points: f3.pts, maxPoints: 12,                reason: f3.reason },
    { factor: 'Size tilt',          points: f4.pts, maxPoints: 8,                 reason: f4.reason },
  ]

  // Backward-compat tier label derived from score
  const classification: ConvictionResult['classification'] =
    score >= 75 ? 'HIGH_CONVICTION' :
    score >= 55 ? 'TAKE_TRADE'      :
    score >= 35 ? 'MONITOR'         : 'DO_NOT_TRADE'

  const positionMultiplier = score >= 85 ? 2.0 : score >= 70 ? 1.5 : 1.0

  return {
    score,
    color,
    breakdown,
    classification,
    role,
    factors: breakdown.map(b => b.reason),
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
