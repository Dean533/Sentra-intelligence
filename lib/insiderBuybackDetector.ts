// Shared buyback-detection logic used by:
//   - scripts/backfill-issuer-buyback.ts   (one-time + periodic backfill)
//   - app/api/insider/ingest/route.ts       (set at insert time for new filings)
//
// Rule: normalize both names (lowercase, strip legal-entity tokens, strip
// punctuation), then flag if all words in the shorter normalized name appear
// in the longer — i.e. the insider IS the issuer or one of its sub-entities.
//
// This catches corporate buybacks ("Equitable Holdings, Inc." on EQH) and
// company-entity filings (Ares Management LLC on ARES) while leaving genuine
// institutional 10% owners (Berkshire on OXY, RA Capital on biotech) untouched,
// because those names don't overlap with the issuer's company name.

const ENTITY_TOKENS = new Set([
  'inc', 'corp', 'llc', 'ltd', 'lp', 'plc', 'sa', 'nv', 'bv', 'ag',
  'co', 'company', 'companies', 'holdings', 'holding', 'group', 'groups',
  'trust', 'fund', 'funds', 'limited', 'incorporated', 'corporation',
  'partners', 'partnership', 'ventures', 'venture',
])

export function normalizeEntityName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !ENTITY_TOKENS.has(w))
}

/**
 * Returns true when insiderName closely matches companyName after normalization —
 * i.e. the "insider" is the issuing company itself (a corporate buyback filing).
 *
 * Safe to call with null companyName (returns false — can't match without a name).
 */
export function isIssuerBuyback(
  insiderName: string | null | undefined,
  companyName: string | null | undefined,
): boolean {
  if (!insiderName || !companyName) return false

  const wi = normalizeEntityName(insiderName)
  const wc = normalizeEntityName(companyName)
  if (wi.length === 0 || wc.length === 0) return false

  const [shorter, longer] = wi.length <= wc.length ? [wi, wc] : [wc, wi]
  const longerSet = new Set(longer)
  return shorter.every(w => longerSet.has(w))
}
