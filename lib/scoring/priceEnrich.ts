// Shared price-enrichment logic for insider_transactions.
// Used by: app/api/insider/price-enrich/route.ts  AND  scripts/backfill-price-enrich.ts
// Change the return-math or windowing here; both callers update automatically.
//
// Extracted verbatim from the route's previous inline implementation — no
// formula changes, just moved so a one-off backfill script can't drift from
// what the daily cron computes.

import YahooFinance from 'yahoo-finance2'

const yahooFinance = new YahooFinance()

// Rows must be this many days old before price-enrich will touch them, so every
// forward return window (price_10d = 10 trading days out) has already closed.
export const PRICE_ENRICH_CUTOFF_DAYS = 7

export type HistRow = { date: Date; close: number }

export function offsetDate(base: Date, days: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function fetchHistory(symbol: string, from: Date, to: Date): Promise<HistRow[]> {
  console.log(`[fetchHistory] ${symbol} period1=${from.toISOString()} period2=${to.toISOString()}`)
  try {
    const rows = await yahooFinance.historical(symbol, {
      period1:  new Date(from),
      period2:  new Date(to),
      interval: '1d',
    }) as any[]
    console.log(`[fetchHistory] ${symbol} returned ${rows.length} rows`)
    return rows
      .map((r) => ({ date: new Date(r.date), close: r.adjClose ?? r.close }))
      .filter((r) => r.close != null)
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  } catch (err: any) {
    console.error(`[fetchHistory] ${symbol} ERROR:`, err?.message ?? err)
    return []
  }
}

// Returns the Nth trading-day price at or after baseDate (0 = same day, 1 = next, etc.)
export function nthTradingDay(history: HistRow[], baseDate: Date, n: number): number | null {
  const ts = baseDate.getTime()
  const future = history.filter((r) => r.date.getTime() >= ts)
  return future[n]?.close ?? null
}

export type PriceEnrichInput = {
  ticker:           string
  transaction_date: string
  total_value:      number | null
}

export type PriceEnrichResult = {
  price_on_day:            number
  price_1d:                number | null
  price_3d:                number | null
  price_5d:                number | null
  price_10d:               number | null
  actual_return_5d:        number | null
  spy_return_5d:           number | null
  adjusted_return_5d:      number | null
  purchase_pct_market_cap: number | null
} | null // null means "no usable price_on_day — caller should count this as failed/skipped"

// history must already cover [txDate-10, txDate+16]; spyHistory the same window for SPY.
// Mirrors the route's per-row computation exactly — same inputs in, same fields out.
export function computePriceEnrichment(
  row:        PriceEnrichInput,
  history:    HistRow[],
  spyHistory: HistRow[],
  marketCap:  number | null,
): PriceEnrichResult {
  const txDate = new Date(row.transaction_date)

  const price0 = nthTradingDay(history, txDate, 0)
  if (price0 == null) return null

  const price1d  = nthTradingDay(history, txDate, 1)
  const price3d  = nthTradingDay(history, txDate, 3)
  const price5d  = nthTradingDay(history, txDate, 5)
  const price10d = nthTradingDay(history, txDate, 10)

  const spy0  = nthTradingDay(spyHistory, txDate, 0)
  const spy5d = nthTradingDay(spyHistory, txDate, 5)

  const actualReturn5d = price5d != null ? round2((price5d - price0) / price0 * 100) : null
  const spyReturn5d    = (spy0 != null && spy5d != null)
    ? round2((spy5d - spy0) / spy0 * 100) : null
  const adjustedReturn5d = (actualReturn5d != null && spyReturn5d != null)
    ? round2(actualReturn5d - spyReturn5d) : null

  const purchasePctMarketCap = (marketCap && row.total_value)
    ? round2(row.total_value / marketCap * 100) : null

  return {
    price_on_day:            price0,
    price_1d:                price1d,
    price_3d:                price3d,
    price_5d:                price5d,
    price_10d:               price10d,
    actual_return_5d:        actualReturn5d,
    spy_return_5d:           spyReturn5d,
    adjusted_return_5d:      adjustedReturn5d,
    purchase_pct_market_cap: purchasePctMarketCap,
  }
}
