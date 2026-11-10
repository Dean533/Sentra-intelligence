-- Performance indexes for /api/insider/fetch and /api/signals (the /events page),
-- and for the cleanup-news job, which has been failing on an unindexed scan of
-- events(event_type, published_at).
--
-- CONCURRENTLY can't run inside a transaction, so paste these into the Supabase
-- SQL Editor one statement at a time (each statement below is its own block).
-- IF NOT EXISTS makes every statement safe to rerun.

-- Needed for the role/officer_title wildcard (ILIKE '%text%') filters below.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The sort used by every /api/insider/fetch call.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_filed_txn_date
  ON insider_transactions (filed_date DESC, transaction_date DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_ticker
  ON insider_transactions (ticker);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_transaction_date
  ON insider_transactions (transaction_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_total_value
  ON insider_transactions (total_value);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_conviction_score
  ON insider_transactions (conviction_score);

-- role/officer_title are free text (e.g. "Chairman, President & CEO"), not a
-- fixed set of values, so the role filter's ILIKE '%...%' needs a trigram
-- index rather than a plain btree one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_role_trgm
  ON insider_transactions USING gin (role gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_it_officer_title_trgm
  ON insider_transactions USING gin (officer_title gin_trgm_ops);

-- Used by /api/signals (SEC/News tabs) and by cleanup-news's "find old news" scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_published_at
  ON events (published_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_type_ticker_published
  ON events (event_type, ticker, published_at DESC);
