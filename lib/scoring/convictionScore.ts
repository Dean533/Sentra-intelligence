// Pure conviction scoring — no I/O. All inputs pre-fetched by caller.
// Empirically calibrated from factor analysis of 322 confirmed opportunistic
// trades, 2015–2026. Every point value is justified by measured alpha.
// See output/full-factor-analysis.txt for source data.

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

// Known high-alpha insiders. Both SEC name orderings listed.
// ticker=null applies at any ticker. Only applied to confirmed opportunistic.
const HIGH_ALPHA_INSIDERS: Array<{ name: string; ticker: string | null; bonus: number }> = [
  { name: 'MYERS FRANKLIN',   ticker: 'FIX',  bonus: 6 },
  { name: 'FRANKLIN MYERS',   ticker: 'FIX',  bonus: 6 },
  { name: 'EMANUEL ARIEL',    ticker: 'TKO',  bonus: 6 },
  { name: 'ARIEL EMANUEL',    ticker: 'TKO',  bonus: 6 },
  { name: 'AUSTIN ROXANNE',   ticker: 'CRWD', bonus: 6 },
  { name: 'ROXANNE AUSTIN',   ticker: 'CRWD', bonus: 6 },
  { name: 'JACOBSON MATTHEW', ticker: 'DDOG', bonus: 5 },
  { name: 'MATTHEW JACOBSON', ticker: 'DDOG', bonus: 5 },
  { name: 'ARORA NIKESH',     ticker: 'PANW', bonus: 5 },
  { name: 'NIKESH ARORA',     ticker: 'PANW', bonus: 5 },
  { name: 'ARES MANAGEMENT',  ticker: null,   bonus: 5 },
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
// CFO/10%Owner: 180d — both show materially stronger 180d alpha.
// CEO: 90d — peaks at 90d (+6.40%), fades after.
// Other/EVP: 60d — negative by 180d (-7.30%), cut early.

function holdByRole(role: string): number {
  if (role === 'CFO' || role === '10% Owner') return 180
  if (role === 'CEO' || role === 'Director')  return 90
  if (role === 'Other/EVP')                   return 60
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

  // ── Tier flags ───────────────────────────────────────────────────────────
  const isConfirmed = trade.is_opportunistic && !trade.is_inferred_opportunistic
  const isInferred  = trade.is_opportunistic && !!trade.is_inferred_opportunistic
  const isRoutine   = !trade.is_opportunistic

  // ── Starting points ──────────────────────────────────────────────────────
  // Confirmed: 55 base (avg trade with modest factors lands ~65).
  // Inferred/unclassifiable: 20 base, hard cap 55 — shown on alerts as MONITOR only.
  // Routine: 10 base, hard cap 30 — never traded.
  if (isConfirmed) {
    score = 55
    factors.push('Opportunistic confirmed: base 55')
  } else if (isInferred) {
    score = 20
    factors.push('Inferred opportunistic: base 20')
  } else {
    score = 10
    factors.push('Routine: base 10')
  }

  const hasRoleData = !!((trade.role ?? '').trim()) || !!((trade.officer_title ?? '').trim())
  const role   = classifyRole(trade)
  const sector = trade.sector ?? ''
  const val    = trade.total_value ?? 0
  const name   = trade.insider_name.toUpperCase()
  const ticker = trade.ticker.toUpperCase()

  // ── Hold period (needed for long-hold bonuses) ───────────────────────────
  const holdDays = holdByRole(role)

  // ── Role bonus / penalty ─────────────────────────────────────────────────
  // Full bonuses for confirmed opportunistic only.
  // Routine/inferred: role contribution capped at +5 (classification dominates).
  // Negative penalties apply at all tiers — they indicate bad actors.
  let rolePoints = 0
  if (hasRoleData) {
    if      (role === 'CFO')                { rolePoints = 12 }
    else if (role === 'CEO')                { rolePoints = 8  }
    else if (role === '10% Owner') {
      rolePoints = 6
      // 180d alpha +15.96% vs 90d +5.75% — reward long-hold conviction
      if (holdDays >= 180) rolePoints += 10
    }
    else if (role === 'Director')           { rolePoints =  1  }
    else if (role === 'President')          { rolePoints = -6  }
    else if (role === 'Other/EVP')          { rolePoints = -8  }
    else if (role === 'Insider (other)')    { rolePoints = -12 }
    else if (role === 'Co-Founder/Partner') { rolePoints = -15 }

    // Cap positive role contribution for non-confirmed tiers
    if (!isConfirmed && rolePoints > 5) rolePoints = 5

    if (rolePoints !== 0) {
      score += rolePoints
      const label = role === '10% Owner' && holdDays >= 180
        ? `10% Owner + long-hold bonus`
        : role
      factors.push(`${label}: ${rolePoints > 0 ? '+' : ''}${rolePoints}`)
    }
  } else if (isConfirmed) {
    // Unknown role floor: size-based minimum so large trades aren't penalised for missing metadata
    const floor = val >= 5_000_000 ? 60 : val >= 1_000_000 ? 57 : 55
    if (score < floor) {
      score = floor
      factors.push(`Unknown role — size floor: ${floor}`)
    }
  }

  // ── Trade size ───────────────────────────────────────────────────────────
  // $500K–$1M is empirically the best bucket (alpha +8.96%, t=1.75).
  // >$25M trades show negative 90d alpha (-1.22%).
  let sizePoints = 0
  if      (val > 25_000_000) { sizePoints = -8  }
  else if (val >= 5_000_000) { sizePoints =  8  }
  else if (val >= 1_000_000) { sizePoints =  6  }
  else if (val >= 500_000)   { sizePoints = 12  }
  else if (val >= 250_000)   { sizePoints =  2  }
  else if (val > 0)          { sizePoints = -2  }

  if (!isConfirmed && sizePoints > 5) sizePoints = 5

  if (sizePoints !== 0) {
    const label =
      val > 25_000_000  ? 'Over $25M trade size' :
      val >= 5_000_000  ? '$5M–$25M trade size'  :
      val >= 1_000_000  ? '$1M–$5M trade size'   :
      val >= 500_000    ? '$500K–$1M trade size'  :
      val >= 250_000    ? '$250K–$500K trade size' : 'Under $250K trade size'
    score += sizePoints
    factors.push(`${label}: ${sizePoints > 0 ? '+' : ''}${sizePoints}`)
  }

  // ── Sector bonus / penalty ───────────────────────────────────────────────
  // Communication Services t=2.85, Utilities t=-2.82 — only statistically
  // significant sectors in the dataset.
  // Financial Services: weak 90d (+3.56%) but strong 180d (+11.26%).
  let sectorPoints = 0
  if      (sector === 'Communication Services') { sectorPoints = 12 }
  else if (sector === 'Consumer Cyclical')       { sectorPoints =  6 }
  else if (sector === 'Industrials')             { sectorPoints =  5 }
  else if (sector === 'Technology')              { sectorPoints =  4 }
  else if (sector === 'Financial Services') {
    sectorPoints = holdDays >= 180 ? 8 : 4
  }
  else if (sector === 'Healthcare')              { sectorPoints =  2 }
  else if (sector === 'Real Estate')             { sectorPoints =  2 }
  // Energy and Basic Materials: too few observations (n=4, n=2), no adjustment
  else if (sector === 'Consumer Defensive')      { sectorPoints = -10 }
  else if (sector === 'Utilities')               { sectorPoints = -12 }

  if (!isConfirmed && sectorPoints > 4) sectorPoints = 4

  if (sectorPoints !== 0) {
    const holdSuffix = sector === 'Financial Services' && holdDays >= 180 ? ' (long-hold)' : ''
    score += sectorPoints
    factors.push(`${sector} sector${holdSuffix}: ${sectorPoints > 0 ? '+' : ''}${sectorPoints}`)
  }

  // ── Confirmed-only factors ────────────────────────────────────────────────
  // Cluster, market condition, relative size, and high-alpha insiders only
  // apply to confirmed opportunistic trades — no empirical basis for the others.

  if (isConfirmed) {
    // ── Cluster count ───────────────────────────────────────────────────────
    // 2–3 insiders: alpha +6.41% vs +3.65% single. 4+ removed: zero trades.
    if (trade.cluster_count >= 2 && trade.cluster_count <= 3) {
      score += 6
      factors.push(`${trade.cluster_count} insiders same ticker this month: +6`)
    }

    // ── Cluster dollar total ────────────────────────────────────────────────
    if (trade.cluster_total_value >= 5_000_000) {
      score += 3
      factors.push(`Cluster total $${(trade.cluster_total_value / 1e6).toFixed(1)}M: +3`)
    }

    // ── Market condition (SPY 90d return) ───────────────────────────────────
    // Insiders in falling markets generate the strongest alpha — contrarian.
    // SPY < -10%: alpha +13.84%.  SPY 0–5%: alpha +1.25% (weakest env).
    if (spy_90d_return != null) {
      if      (spy_90d_return < -10) { score += 10; factors.push(`SPY ${spy_90d_return.toFixed(1)}% (bear market): +10`) }
      else if (spy_90d_return < -5)  { score +=  5; factors.push(`SPY ${spy_90d_return.toFixed(1)}% (weak market): +5`) }
      else if (spy_90d_return < 0)   { /* neutral */ }
      else if (spy_90d_return < 5)   { score -=  2; factors.push(`SPY ${spy_90d_return.toFixed(1)}% (low-alpha env): -2`) }
      // SPY >= 5%: decent alpha, no adjustment
    }

    // ── Trade size relative to insider median ───────────────────────────────
    // 2×–5× own median: alpha +8.71%, t=1.88. >5× drops to +1.90%.
    if (trade.insider_median_value && trade.insider_median_value > 0 && val > 0) {
      const ratio = val / trade.insider_median_value
      if      (ratio >= 2 && ratio < 5) { score += 6; factors.push(`Trade ${ratio.toFixed(1)}× insider median: +6`) }
      else if (ratio >= 5)               { score += 1; factors.push(`Trade ${ratio.toFixed(1)}× insider median (>5×): +1`) }
      else if (ratio < 0.5)              { score -= 2; factors.push(`Trade ${ratio.toFixed(1)}× insider median (<0.5×): -2`) }
    }

    // ── High-alpha insider bonus ────────────────────────────────────────────
    for (const ha of HIGH_ALPHA_INSIDERS) {
      if (name.includes(ha.name) && (ha.ticker === null || ha.ticker === ticker)) {
        score += ha.bonus
        factors.push(`High-alpha insider (${ha.name}): +${ha.bonus}`)
        break
      }
    }
  }

  // ── Track record (all tiers) ─────────────────────────────────────────────
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

  // ── Local insider ─────────────────────────────────────────────────────────
  // Confirmed local: +5.02% alpha vs +1.56% non-local (+3.46% edge).
  if (trade.is_local === true) {
    const localBonus = isConfirmed ? 3 : 1
    score += localBonus
    factors.push(`Local insider (same state as HQ): +${localBonus}`)
  }

  // ── Exclusion penalties (all tiers) ──────────────────────────────────────
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

  // ── Tier caps ─────────────────────────────────────────────────────────────
  if (isInferred) score = Math.min(55, Math.max(0, score))
  if (isRoutine)  score = Math.min(30, Math.max(0, score))

  // ── Global clamp ──────────────────────────────────────────────────────────
  score = Math.min(100, Math.max(0, score))

  // ── Classification ────────────────────────────────────────────────────────
  // Trading tiers only apply to confirmed opportunistic.
  // Inferred and routine are always MONITOR or DO_NOT_TRADE.
  let classification: ConvictionResult['classification']
  if (isConfirmed) {
    classification =
      score >= 70 ? 'HIGH_CONVICTION' :
      score >= 60 ? 'TAKE_TRADE'      :
      score >= 50 ? 'MONITOR'         : 'DO_NOT_TRADE'
  } else {
    classification = score >= 20 ? 'MONITOR' : 'DO_NOT_TRADE'
  }

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
