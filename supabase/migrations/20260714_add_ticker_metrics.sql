-- Migration: add ticker_metrics columns for the ticker scanner
-- Non-destructive: all ADD COLUMN IF NOT EXISTS. Safe to re-run.
--
-- Adds to the existing `tickers` table (symbol, name, sector, market_cap,
-- hq_state, last_updated, sentra_score — not touched here).
--
-- Percentage/ratio storage convention (applies to ALL columns below):
--   Fractions — never raw Yahoo percentages.
--   Yahoo's regularMarketChangePercent returns 2.34 for +2.34%; we divide by 100
--   before storing so it lands as 0.0234.  fiftyTwoWeekChange is already a
--   fraction from Yahoo (0.25 = +25%), stored as-is.
--   Filter queries: price_change_pct > 0.02 means "up more than 2% today".
--
-- Run via Supabase SQL editor or:
--   psql "$DATABASE_URL" -f supabase/migrations/20260714_add_ticker_metrics.sql

-- ── Daily-refresh price metrics  (updated by scripts/refresh-ticker-prices.ts) ──

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS price              numeric;
-- regularMarketPrice

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS price_change_pct   numeric;
-- regularMarketChangePercent / 100  (fraction: 0.0234 = +2.34%)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS volume             bigint;
-- regularMarketVolume

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS avg_volume_3m      bigint;
-- averageDailyVolume3Month

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS ma_50              numeric;
-- fiftyDayAverage

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS ma_200             numeric;
-- twoHundredDayAverage

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS week_52_high       numeric;
-- fiftyTwoWeekHigh

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS week_52_low        numeric;
-- fiftyTwoWeekLow

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS week_52_change_pct numeric;
-- fiftyTwoWeekChange  (Yahoo already returns as fraction: 0.25 = +25%)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS price_updated_at   timestamptz;
-- timestamp of last successful quote() refresh

-- NOTE: market_cap already exists. refresh-ticker-prices.ts also updates it.
-- The legacy fetch-market-caps.ts script continues to work unchanged.

-- ── Weekly fundamental metrics  (updated by scripts/refresh-ticker-fundamentals.ts) ──

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS revenue            numeric;
-- financialData.totalRevenue  (absolute dollars)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS profit_margin      numeric;
-- financialData.profitMargins  (fraction: 0.12 = 12%)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS beta               numeric;
-- summaryDetail.beta  (market sensitivity; 1.0 = moves with market)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS debt_to_equity     numeric;
-- financialData.debtToEquity  (ratio: 1.5 = 150% of equity)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS return_on_equity   numeric;
-- financialData.returnOnEquity  (fraction: 0.15 = 15%)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS ebitda             numeric;
-- financialData.ebitda  (absolute dollars)

ALTER TABLE tickers ADD COLUMN IF NOT EXISTS fundamentals_updated_at timestamptz;
-- timestamp of last successful quoteSummary() refresh

-- ── Scanner indexes ───────────────────────────────────────────────────────────
-- Partial indexes (WHERE col IS NOT NULL) skip the ~10-20% of tickers that
-- lack a given metric; scanner WHERE clauses almost always require non-null anyway.

CREATE INDEX IF NOT EXISTS idx_tickers_price
  ON tickers (price) WHERE price IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_price_change
  ON tickers (price_change_pct) WHERE price_change_pct IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_ma50
  ON tickers (ma_50) WHERE ma_50 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_ma200
  ON tickers (ma_200) WHERE ma_200 IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_week52_change
  ON tickers (week_52_change_pct) WHERE week_52_change_pct IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_revenue
  ON tickers (revenue) WHERE revenue IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_profit_margin
  ON tickers (profit_margin) WHERE profit_margin IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_beta
  ON tickers (beta) WHERE beta IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_debt_to_equity
  ON tickers (debt_to_equity) WHERE debt_to_equity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickers_roe
  ON tickers (return_on_equity) WHERE return_on_equity IS NOT NULL;
