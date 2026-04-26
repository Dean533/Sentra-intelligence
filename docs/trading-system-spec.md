# Sentra Trading System — Final Specification
## Version 1.0 | Based on 340 opportunistic trades, 2015–2026

## Entry Rules
- Dollar size: ≥$1M core, ≥$500K acceptable. Skip sub-$500K standalone.
- Roles to include: CEO, 10% Owner, CFO, Other/EVP
- Roles to exclude: President, Co-Founder/Partner, Insider (other)
- Sectors to include: Communication Services, Financial Services, 
  Industrials, Consumer Cyclical
- Sectors to exclude: Technology (long holds only), Energy, 
  Utilities, Consumer Defensive
- Cluster bonus: 4+ insiders same ticker same month = strong multiplier
- Cluster dollar: ≥$5M total opportunistic buys same month = 
  independent strong signal

## Hold Period by Role
- 10% Owner, CFO, EVP: 180 days
- CEO: 150 days
- Director: 90 days

## Hold Period by Sector
- Financial Services, Healthcare: 180 days
- Communication Services: 150 days
- Technology, Industrials: 90 days
- Consumer Cyclical: 60 days

## Exit Rules
- Stop loss: -10% in first 30 days → exit immediately
- Take profit: +25% → exit (equal alpha, lower risk)
- Time exit: per role and sector hold periods above

## Position Sizing Multipliers
- Base position: 1x
- Trade is 2x–5x insider median trade size: 1.5x multiplier
- High track record insider (≥65% hit rate, ≥5% alpha): 1.25x
- High track record ticker: 1.25x
- Cluster 4+ insiders: 1.5x
- Maximum combined multiplier: 2x — never exceed this

## Market Conditions
- Do NOT avoid signals when SPY is weak — contrarian setup 
  improves alpha
- Prefer low volatility stocks — high volatility kills signal
- Sector ETF down before trade = better setup than momentum

## Conviction Score (0–100)
Routine trades score 1–49. Opportunistic trades start at 50.

### Positive factors
- 10% Owner: +12
- CFO: +8
- Financial Services sector: +8
- Communication Services sector: +7
- $1M–$25M trade size: +10
- Cluster 4+ insiders: +8
- Cluster dollar ≥$5M: +6
- CEO: +5
- High track record insider: +5
- High track record ticker: +5
- Industrials sector: +4
- Local insider (same state as HQ): +3
- Trade size 2x–5x insider median: +4

### Negative factors
- Energy or Utilities sector: -10
- Consumer Defensive sector: -8
- Excluded ticker (see list): -15
- Excluded insider (see list): -20

### Thresholds
- Score ≥70: take the trade
- Score ≥85: high conviction, apply full multipliers
- Score <50: do not trade regardless of classification
- Score <70 but ≥50: monitor only, do not act

## Exclusion Lists

### Excluded tickers
CVS, VST, MSTR, VRTX, GME, ALLE, CRL

### Excluded insiders
WALLMAN RICHARD F, HELM SCOTT B, Patten Jarrod M, 
Cheng Lawrence, Stone John H

## Backtest Summary
- Dataset: 340 opportunistic buy trades, 522 S&P 500 tickers
- Date range: 2015–2026
- Overall market-adjusted win rate: 59.7%
- Average alpha per trade: +3.60%
- Optimal hold: 150 days overall, varies by role and sector
- Best single filter: CEO + no early dip >5% = 80% hit, +10.2% alpha
- Best role: 10% Owner = 85% hit rate, 100% at 180 days
- Best sector: Communication Services = 81% hit, +11.3% alpha
- Academic backing: Cohen, Malloy & Pomorski (2010), Harvard/MIT

## Next Steps
1. Build conviction scoring engine into Sentra signals pipeline
2. Build real-time alerts for signals scoring ≥70
3. Paper trade for 2–3 months tracking every signal
4. Present track record to dad's hedge fund
