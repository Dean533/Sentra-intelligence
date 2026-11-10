-- Moves the holdings-% filter (previously computed row-by-row in Node, after
-- pulling the entire matching result set out of Postgres) into a stored
-- generated column, so app/api/insider/fetch/route.ts can filter on it with a
-- plain indexed WHERE clause instead.
--
-- Reproduces the old passesHoldingsFilter() formula exactly:
--   denom = transaction_code === 'S' ? shares_owned_after + shares : shares_owned_after - shares
--   if denom <= 0: no match (NULL here fails any >= comparison, same effect)
--   pct = min(shares / denom * 100, 999)
--
-- NOTE: unlike CREATE INDEX CONCURRENTLY, adding a STORED generated column
-- takes a brief table lock while Postgres backfills the value for every
-- existing row. Fast for a simple numeric formula, but not zero-downtime.

ALTER TABLE insider_transactions
  ADD COLUMN IF NOT EXISTS holdings_pct_change numeric GENERATED ALWAYS AS (
    CASE
      WHEN shares IS NULL OR shares_owned_after IS NULL THEN NULL
      WHEN UPPER(transaction_code) = 'S' THEN
        CASE WHEN (shares_owned_after + shares) > 0
             THEN LEAST(shares / (shares_owned_after + shares) * 100, 999)
             ELSE NULL END
      ELSE
        CASE WHEN (shares_owned_after - shares) > 0
             THEN LEAST(shares / (shares_owned_after - shares) * 100, 999)
             ELSE NULL END
    END
  ) STORED;

-- This one CAN run concurrently (unlike the column add above), so paste it as
-- its own statement, same as the other indexes in 20261109_add_perf_indexes.sql.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_holdings_pct_change
  ON insider_transactions (holdings_pct_change);
