-- Add stored classification to insider_transactions.
-- The daily conviction-score cron writes resolveClassification() output here
-- alongside conviction_score, so both display and filter read from the same source.
ALTER TABLE insider_transactions
  ADD COLUMN IF NOT EXISTS classification TEXT;

-- Partial index for the classification filter in /api/insider/fetch.
-- WHERE IS NOT NULL keeps the index small (NULL rows are the unscored majority).
CREATE INDEX IF NOT EXISTS idx_it_classification
  ON insider_transactions (classification)
  WHERE classification IS NOT NULL;
