-- Add hold_days to insider_signals_monthly
-- Stores the recommended hold period (in days) for the highest-conviction buy in that month.
-- Derived from min(holdByRole, holdBySector) in lib/scoring/convictionScore.ts.
-- NULL when no qualifying buys were scored.

ALTER TABLE insider_signals_monthly
  ADD COLUMN IF NOT EXISTS hold_days SMALLINT DEFAULT NULL;

COMMENT ON COLUMN insider_signals_monthly.hold_days IS
  'Recommended hold period (days) for the best-scoring insider buy this month. '
  'min(role-based hold, sector-based hold) from the conviction scoring engine. '
  'NULL when there are no qualifying buy trades.';
