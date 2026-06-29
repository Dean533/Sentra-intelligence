// Canonical GICS sector name normalization.
// Source data (iShares ETF holdings CSVs, Yahoo Finance) uses non-GICS labels.
// This map remaps every known alias to the canonical GICS name so the DB
// stays consistent regardless of where a ticker's sector value originates.

export const GICS_SECTOR_MAP: Record<string, string> = {
  // Yahoo / iShares aliases → GICS canonical
  'Technology':           'Information Technology',
  'Financial Services':   'Financials',
  'Healthcare':           'Health Care',
  'Consumer Cyclical':    'Consumer Discretionary',
  'Consumer Defensive':   'Consumer Staples',
  'Basic Materials':      'Materials',
  'Communication':        'Communication Services',   // truncated iShares label

  // Pass-through: already GICS — listed explicitly so callers can validate
  'Communication Services': 'Communication Services',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Staples':       'Consumer Staples',
  'Energy':                 'Energy',
  'Financials':             'Financials',
  'Health Care':            'Health Care',
  'Industrials':            'Industrials',
  'Information Technology': 'Information Technology',
  'Materials':              'Materials',
  'Real Estate':            'Real Estate',
  'Utilities':              'Utilities',
}

export const GICS_SECTORS = [
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Financials',
  'Health Care',
  'Industrials',
  'Information Technology',
  'Materials',
  'Real Estate',
  'Utilities',
] as const

export type GicsSector = typeof GICS_SECTORS[number]

/**
 * Normalize a raw sector string to its canonical GICS name.
 * Returns the canonical name if known, or the original string if not in the map.
 */
export function toGicsSector(raw: string | null | undefined): string {
  if (!raw) return ''
  return GICS_SECTOR_MAP[raw.trim()] ?? raw.trim()
}
