// Shared scoring logic for fundamental_score and expected_move.
// Used by: app/api/insider/score/route.ts  AND  scripts/backfill-fundamental-score.ts
// Change weights or formulas here; both callers update automatically.

export const WEIGHT_RELATIVE  = 0.40
export const WEIGHT_DOLLAR    = 0.25
export const WEIGHT_ROLE      = 0.15
export const WEIGHT_CLUSTER   = 0.10
export const WEIGHT_OPEN      = 0.10

export const REL_PURCHASE_CAP = 0.5
export const MIN_DOLLAR       = 10_000
export const MAX_DOLLAR_CAP   = 50_000_000
export const BASE_MAX_MOVE    = 8.0

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export function relativePurchaseScore(pct: number | null): number {
  if (pct == null || pct <= 0) return 0
  return clamp(pct / REL_PURCHASE_CAP, 0, 1)
}

export function rawDollarScore(totalValue: number | null): number {
  if (totalValue == null || totalValue < MIN_DOLLAR) return 0
  const minLog = Math.log(MIN_DOLLAR)
  const maxLog = Math.log(MAX_DOLLAR_CAP)
  return clamp((Math.log(totalValue) - minLog) / (maxLog - minLog), 0, 1)
}

export function insiderRoleScore(officerTitle: string | null, role: string | null): number {
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

export function clusterBuyScore(count: number): number {
  if (count >= 3) return 1.0
  if (count === 2) return 0.7
  if (count === 1) return 0.4
  return 0.0
}

export function sizeMultiplier(marketCap: number | null): number {
  if (marketCap == null)                   return 1.0
  if (marketCap < 2_000_000_000)           return 1.35
  if (marketCap < 10_000_000_000)          return 1.15
  if (marketCap < 100_000_000_000)         return 1.0
  return 0.75
}

export interface ScoredRow {
  fundamental_score: number
  expected_move:     number
}

export function computeFundamentalScore(
  row: {
    purchase_pct_market_cap: number | null
    total_value:             number | null
    officer_title:           string | null
    role:                    string | null
  },
  clusterCount: number,
  marketCap:    number | null
): ScoredRow {
  const eventStrength =
    WEIGHT_RELATIVE * relativePurchaseScore(row.purchase_pct_market_cap) +
    WEIGHT_DOLLAR   * rawDollarScore(row.total_value) +
    WEIGHT_ROLE     * insiderRoleScore(row.officer_title, row.role) +
    WEIGHT_CLUSTER  * clusterBuyScore(clusterCount) +
    WEIGHT_OPEN     * 1.0

  return {
    fundamental_score: Math.round(eventStrength * 100),
    expected_move:     Math.round(BASE_MAX_MOVE * eventStrength * sizeMultiplier(marketCap) * 100) / 100,
  }
}
