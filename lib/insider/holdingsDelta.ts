// Holdings change implied by a Form 4 row: shares traded as a % of the stake held
// before the trade. Shared by the events/screener table and the homepage.
//
// Returns null when the prior stake can't be derived (missing data, or
// shares_owned_after <= shares for a buy, i.e. a brand-new position or bad data).
// Values above 500% are capped and flagged so tables don't show absurd numbers.
export function holdingsDeltaPct(row: {
  shares: number | null
  shares_owned_after: number | null
  transaction_code: string | null
}): { pct: number; capped: boolean } | null {
  const s     = row.shares
  const after = row.shares_owned_after
  if (s == null || after == null) return null
  const isBuy = row.transaction_code?.toUpperCase() === 'P'
  const denom = isBuy ? after - s : after + s
  // denom <= 0 means shares_owned_after <= shares (bought more than previously held, or bad data)
  if (denom <= 0) return null
  const raw    = (s / denom) * 100
  const capped = raw > 500
  const pct    = Math.min(raw, 500)
  return { pct: isBuy ? pct : -pct, capped }
}

// Signal bucket label: classification × score threshold of 50 (see /about).
export function convictionLabel(cls: string | null, s: number): string {
  if (cls === 'OPPORTUNISTIC')  return s >= 50 ? 'Very high signal' : 'Moderate signal'
  if (cls === 'UNCLASSIFIABLE') return s >= 50 ? 'High signal'      : 'Low signal'
  if (cls === 'ROUTINE')        return s >= 50 ? 'Low signal'       : 'No signal'
  return 'No signal'
}
