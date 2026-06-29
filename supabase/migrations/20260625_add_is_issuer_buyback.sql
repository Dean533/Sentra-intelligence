-- Flags transactions where the "insider" is the company itself (share buybacks).
-- These appear when a company files a Form 4 buy using its own corporate name
-- rather than an individual officer/director.
--
-- Populated by: npx tsx scripts/backfill-issuer-buyback.ts
-- Logic: normalize both insider_name and the ticker's company name (lowercase,
--   strip legal-entity suffixes and punctuation), then flag if one contains the other.
--
-- Why keep the rows: they're legitimate SEC filings; we just don't want them
-- treated as individual insider conviction signals.

ALTER TABLE insider_transactions
  ADD COLUMN IF NOT EXISTS is_issuer_buyback BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN insider_transactions.is_issuer_buyback IS
  'True when the insider_name closely matches the issuer''s own company name — '
  'indicating a corporate buyback or company-entity filing, not an individual insider. '
  'Populated by scripts/backfill-issuer-buyback.ts. Excluded from scoring and signals.';

CREATE INDEX IF NOT EXISTS idx_insider_transactions_buyback
  ON insider_transactions (is_issuer_buyback)
  WHERE is_issuer_buyback = TRUE;
