// Cached Yahoo Finance reads for user-facing pages and API routes.
//
// Uses Next's data cache (unstable_cache): shared across requests (and across
// instances on Vercel), persisted under .next/cache locally. Only successful
// results are cached; a thrown Yahoo error is never stored, so the next request
// retries. Values are JSON round-tripped, so Date fields come back as ISO
// strings, which is what the API routes already sent to the browser.
//
// TTLs: quotes and price history 5 min, company facts 24h. News (30 min) is
// cached in lib/news/tickerNews.ts because it also merges Google News.
//
// Batch/cron jobs (scoring, price enrichment) keep calling Yahoo directly.
import { unstable_cache } from 'next/cache'
import YahooFinance from 'yahoo-finance2'

export const yahoo = new YahooFinance({ suppressNotices: ['yahooSurvey'] })

export const TTL = {
  quote: 5 * 60,
  facts: 24 * 60 * 60,
  news: 30 * 60,
} as const

const norm = (s: string) => s.toUpperCase().trim()

/* eslint-disable @typescript-eslint/no-explicit-any -- Yahoo payloads are loosely typed */

const cachedQuote = unstable_cache(
  async (symbol: string): Promise<any> => yahoo.quote(symbol),
  ['yahoo-quote-v1'],
  { revalidate: TTL.quote, tags: ['yahoo', 'yahoo-quote'] },
)

/** Live quote (price, day change, market state...). Cached 5 minutes. */
export function getQuote(symbol: string): Promise<any> {
  return cachedQuote(norm(symbol))
}

const FACT_MODULES = ['assetProfile', 'defaultKeyStatistics', 'financialData'] as const

const cachedFacts = unstable_cache(
  async (symbol: string): Promise<any> => yahoo.quoteSummary(symbol, { modules: [...FACT_MODULES] }),
  ['yahoo-facts-v1'],
  { revalidate: TTL.facts, tags: ['yahoo', 'yahoo-facts'] },
)

/** Company profile, key statistics and financial data. Cached 24 hours. */
export function getCompanyFacts(symbol: string): Promise<any> {
  return cachedFacts(norm(symbol))
}
