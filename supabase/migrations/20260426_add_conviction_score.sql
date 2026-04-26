-- Add conviction_score to insider_signals_monthly
-- Stores the highest conviction score seen for that ticker in that signal month.
-- Range: 0–100 (SMALLINT). Default 0 = not yet scored.
-- Populated by the conviction scoring engine when signals are recomputed.

ALTER TABLE insider_signals_monthly
  ADD COLUMN IF NOT EXISTS conviction_score SMALLINT DEFAULT 0;

COMMENT ON COLUMN insider_signals_monthly.conviction_score IS
  'Highest conviction score (0–100) among all insider buys for this ticker in this signal month. '
  'Scores ≥70 = take trade, ≥85 = high conviction. See lib/scoring/convictionScore.ts.';
