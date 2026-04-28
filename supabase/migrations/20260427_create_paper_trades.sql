CREATE TABLE IF NOT EXISTS paper_trades (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  ticker           TEXT        NOT NULL,
  entry_price      DECIMAL,
  shares           DECIMAL,
  conviction_score INTEGER,
  signal_month     DATE,
  alpaca_order_id  TEXT,
  status           TEXT        DEFAULT 'open',
  created_at       TIMESTAMP   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paper_trades_ticker_idx        ON paper_trades (ticker);
CREATE INDEX IF NOT EXISTS paper_trades_signal_month_idx  ON paper_trades (signal_month);
CREATE INDEX IF NOT EXISTS paper_trades_status_idx        ON paper_trades (status);
