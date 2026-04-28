ALTER TABLE paper_trades ADD COLUMN IF NOT EXISTS tier INTEGER;

COMMENT ON COLUMN paper_trades.tier IS
  '1 = conviction_score >= 70 (real position size, $1000 budget split equally). '
  '2 = conviction_score 60–69 (tracking only, flat $100 per signal).';
