-- Add per-trade conviction_score to insider_transactions.
-- Nullable: null means not yet scored. Populated by the backfill script and
-- the daily cron conviction-score route going forward.
-- Range: 0–100 (SMALLINT). See lib/scoring/convictionScore.ts for formula.
-- Separate from fundamental_score (still kept; just not displayed).

ALTER TABLE insider_transactions
  ADD COLUMN IF NOT EXISTS conviction_score SMALLINT;

COMMENT ON COLUMN insider_transactions.conviction_score IS
  'Per-trade conviction score (0–100) from lib/scoring/convictionScore.ts. '
  'Null = not yet scored. OPPORTUNISTIC ≥70 = strong signal; '
  'see insider_classifications for the CMP color (OPPORTUNISTIC/ROUTINE/UNCLASSIFIABLE).';
