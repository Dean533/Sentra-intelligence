// scripts/probe-yahoo-fields.ts
//
// READ-ONLY probe: discovers which Yahoo Finance fields are reliably populated
// across R3000 tickers (mega, large, mid, small, micro-cap buckets).
//
// Outputs per-field fill rates, timing, and rate-limit extrapolation.
// Does NOT write to the DB or any output files.
//
// Usage:  npx tsx scripts/probe-yahoo-fields.ts

import * as path from 'path'
import * as fs   from 'fs'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ── Env ───────────────────────────────────────────────────────────────────────

function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

const yf = new YahooFinance({ validation: { logErrors: false } })
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Ticker sample ─────────────────────────────────────────────────────────────
// We load from the DB so the sample reflects what the refresh job would actually hit.
// Bucket: 10 mega (>100B), 10 large (10B-100B), 10 mid (1B-10B),
//         10 small (100M-1B), 10 micro (<100M or no market_cap).

async function loadSample(): Promise<{ symbol: string; market_cap: number | null; bucket: string }[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
  const sb  = createClient(url, key)

  const [megaR, largeR, midR, smallR, microR] = await Promise.all([
    sb.from('tickers').select('symbol, market_cap').gt('market_cap',  100_000_000_000).order('market_cap', { ascending: false }).limit(10),
    sb.from('tickers').select('symbol, market_cap').gt('market_cap',   10_000_000_000).lte('market_cap', 100_000_000_000).order('market_cap', { ascending: false }).limit(10),
    sb.from('tickers').select('symbol, market_cap').gt('market_cap',    1_000_000_000).lte('market_cap',  10_000_000_000).order('market_cap', { ascending: false }).limit(10),
    sb.from('tickers').select('symbol, market_cap').gt('market_cap',      100_000_000).lte('market_cap',   1_000_000_000).order('market_cap', { ascending: false }).limit(10),
    sb.from('tickers').select('symbol, market_cap').or('market_cap.is.null,market_cap.lt.100000000').order('symbol').limit(10),
  ])

  const out: { symbol: string; market_cap: number | null; bucket: string }[] = []
  const buckets: [any, string][] = [
    [megaR,  'mega  (>$100B)'],
    [largeR, 'large ($10B-100B)'],
    [midR,   'mid   ($1B-10B)'],
    [smallR, 'small ($100M-1B)'],
    [microR, 'micro (<$100M/null)'],
  ]
  for (const [res, bucket] of buckets) {
    for (const r of (res.data ?? []) as any[]) {
      out.push({ symbol: r.symbol, market_cap: r.market_cap ?? null, bucket })
    }
  }
  return out
}

// ── Field tracker ─────────────────────────────────────────────────────────────

type FieldStat = { present: number; total: number; source: string }

function isDefined(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '' && !(typeof v === 'number' && isNaN(v))
}

function track(
  stats: Map<string, FieldStat>,
  fieldPath: string,
  value: unknown,
  source: string,
) {
  if (!stats.has(fieldPath)) stats.set(fieldPath, { present: 0, total: 0, source })
  const s = stats.get(fieldPath)!
  s.total++
  if (isDefined(value)) s.present++
}

function flatTrack(
  stats: Map<string, FieldStat>,
  obj: Record<string, unknown> | null | undefined,
  prefix: string,
  source: string,
  // skip these — they're internal yahoo-finance2 fields, not useful for filters
  skip = new Set(['raw', 'fmt', 'longFmt', 'maxAge']),
) {
  if (!obj || typeof obj !== 'object') return
  for (const [key, val] of Object.entries(obj)) {
    if (skip.has(key)) continue
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      // drill one level for nested value objects like { raw: 123, fmt: "123" }
      const inner = val as Record<string, unknown>
      if ('raw' in inner) {
        track(stats, `${prefix}.${key}`, inner.raw, source)
      } else {
        flatTrack(stats, inner, `${prefix}.${key}`, source, skip)
      }
    } else if (!Array.isArray(val)) {
      track(stats, `${prefix}.${key}`, val, source)
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(68))
  console.log('YAHOO FINANCE FIELD PROBE  —  read-only, no DB writes')
  console.log('═'.repeat(68))

  // ── 1. Load sample ────────────────────────────────────────────────────────
  process.stdout.write('\nLoading ticker sample from DB... ')
  const sample = await loadSample()
  console.log(`${sample.length} tickers\n`)

  const bucketCounts: Record<string, number> = {}
  for (const t of sample) bucketCounts[t.bucket] = (bucketCounts[t.bucket] ?? 0) + 1
  for (const [b, n] of Object.entries(bucketCounts)) {
    const mcStr = sample.filter(t => t.bucket === b).map(t =>
      t.market_cap ? (t.market_cap / 1e9).toFixed(1) + 'B' : 'null'
    ).join(', ')
    console.log(`  ${b}: ${n} tickers  [${mcStr}]`)
  }

  const tickers = sample.map(t => t.symbol)
  const stats   = new Map<string, FieldStat>()

  // ── 2. quote() — batched ──────────────────────────────────────────────────
  // quote() can take an array of symbols: one HTTP request per batch.
  // Yahoo's batch limit is generous (~500 symbols/request in practice), but
  // we stay conservative at 20/batch to avoid timeouts.

  const QUOTE_BATCH = 20
  const QUOTE_DELAY = 500   // ms between batches

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[1/2] quote()  — ${Math.ceil(tickers.length / QUOTE_BATCH)} batches of ${QUOTE_BATCH}`)
  console.log(`      delay: ${QUOTE_DELAY}ms between batches (polite)`)
  console.log('─'.repeat(60))

  const quoteT0  = Date.now()
  let   quoteFailed = 0
  const quoteResults: Record<string, any> = {}

  for (let i = 0; i < tickers.length; i += QUOTE_BATCH) {
    const batch   = tickers.slice(i, i + QUOTE_BATCH)
    const batchNo = Math.floor(i / QUOTE_BATCH) + 1
    process.stdout.write(`  batch ${batchNo}/${Math.ceil(tickers.length / QUOTE_BATCH)}  [${batch.join(', ')}]... `)

    try {
      const t0  = Date.now()
      // Pass array → yahoo-finance2 issues one request, returns array
      const res = await (yf.quote(batch as any, {}, { validateResult: false }) as Promise<any>)
      const ms  = Date.now() - t0
      const arr: any[] = Array.isArray(res) ? res : [res]

      for (let j = 0; j < batch.length; j++) {
        const q   = arr[j] ?? null
        const sym = batch[j]
        quoteResults[sym] = q

        // Core price fields
        track(stats, 'quote.regularMarketPrice',         q?.regularMarketPrice,         'quote()')
        track(stats, 'quote.regularMarketChange',        q?.regularMarketChange,        'quote()')
        track(stats, 'quote.regularMarketChangePercent', q?.regularMarketChangePercent, 'quote()')
        track(stats, 'quote.regularMarketOpen',          q?.regularMarketOpen,          'quote()')
        track(stats, 'quote.regularMarketDayHigh',       q?.regularMarketDayHigh,       'quote()')
        track(stats, 'quote.regularMarketDayLow',        q?.regularMarketDayLow,        'quote()')
        track(stats, 'quote.regularMarketVolume',        q?.regularMarketVolume,        'quote()')
        track(stats, 'quote.regularMarketPreviousClose', q?.regularMarketPreviousClose, 'quote()')

        // Moving averages (price-based filters)
        track(stats, 'quote.fiftyDayAverage',            q?.fiftyDayAverage,            'quote()')
        track(stats, 'quote.twoHundredDayAverage',       q?.twoHundredDayAverage,       'quote()')
        track(stats, 'quote.fiftyDayAverageChange',      q?.fiftyDayAverageChange,      'quote()')
        track(stats, 'quote.fiftyDayAverageChangePercent', q?.fiftyDayAverageChangePercent, 'quote()')
        track(stats, 'quote.twoHundredDayAverageChange', q?.twoHundredDayAverageChange, 'quote()')
        track(stats, 'quote.twoHundredDayAverageChangePercent', q?.twoHundredDayAverageChangePercent, 'quote()')

        // Volume
        track(stats, 'quote.averageVolume',              q?.averageVolume,              'quote()')
        track(stats, 'quote.averageDailyVolume10Day',    q?.averageDailyVolume10Day,    'quote()')
        track(stats, 'quote.averageDailyVolume3Month',   q?.averageDailyVolume3Month,   'quote()')

        // 52-week range
        track(stats, 'quote.fiftyTwoWeekHigh',           q?.fiftyTwoWeekHigh,           'quote()')
        track(stats, 'quote.fiftyTwoWeekLow',            q?.fiftyTwoWeekLow,            'quote()')
        track(stats, 'quote.fiftyTwoWeekChange',         q?.fiftyTwoWeekChange,         'quote()')
        track(stats, 'quote.fiftyTwoWeekHighChange',     q?.fiftyTwoWeekHighChange,     'quote()')
        track(stats, 'quote.fiftyTwoWeekHighChangePercent', q?.fiftyTwoWeekHighChangePercent, 'quote()')
        track(stats, 'quote.fiftyTwoWeekLowChange',      q?.fiftyTwoWeekLowChange,      'quote()')
        track(stats, 'quote.fiftyTwoWeekLowChangePercent', q?.fiftyTwoWeekLowChangePercent, 'quote()')

        // Valuation
        track(stats, 'quote.marketCap',                  q?.marketCap,                  'quote()')
        track(stats, 'quote.trailingPE',                 q?.trailingPE,                 'quote()')
        track(stats, 'quote.forwardPE',                  q?.forwardPE,                  'quote()')
        track(stats, 'quote.priceToBook',                q?.priceToBook,                'quote()')
        track(stats, 'quote.bookValue',                  q?.bookValue,                  'quote()')

        // Earnings
        track(stats, 'quote.epsTrailingTwelveMonths',    q?.epsTrailingTwelveMonths,    'quote()')
        track(stats, 'quote.epsForward',                 q?.epsForward,                 'quote()')
        track(stats, 'quote.epsCurrentYear',             q?.epsCurrentYear,             'quote()')

        // Dividends
        track(stats, 'quote.dividendYield',              q?.dividendYield,              'quote()')
        track(stats, 'quote.trailingAnnualDividendRate', q?.trailingAnnualDividendRate, 'quote()')
        track(stats, 'quote.trailingAnnualDividendYield', q?.trailingAnnualDividendYield, 'quote()')

        // Beta
        track(stats, 'quote.beta',                       q?.beta,                       'quote()')

        // Earnings timestamps
        track(stats, 'quote.earningsTimestamp',          q?.earningsTimestamp,          'quote()')
        track(stats, 'quote.earningsTimestampStart',     q?.earningsTimestampStart,     'quote()')

        // Meta
        track(stats, 'quote.quoteType',                  q?.quoteType,                  'quote()')
        track(stats, 'quote.shortName',                  q?.shortName,                  'quote()')
        track(stats, 'quote.longName',                   q?.longName,                   'quote()')
        track(stats, 'quote.exchangeTimezoneName',       q?.exchangeTimezoneName,       'quote()')
        track(stats, 'quote.exchange',                   q?.exchange,                   'quote()')
      }

      console.log(`${ms}ms`)
    } catch (e: any) {
      console.log(`FAILED — ${e.message?.slice(0, 80)}`)
      quoteFailed += batch.length
      // Track as missing for all tickers in the failed batch
      const QUOTE_FIELDS = [
        'regularMarketPrice', 'regularMarketChangePercent', 'regularMarketVolume',
        'averageVolume', 'marketCap', 'trailingPE', 'forwardPE', 'beta',
        'fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'epsTrailingTwelveMonths', 'dividendYield',
      ]
      for (const sym of batch) {
        for (const f of QUOTE_FIELDS) {
          track(stats, `quote.${f}`, null, 'quote()')
        }
      }
    }

    if (i + QUOTE_BATCH < tickers.length) await sleep(QUOTE_DELAY)
  }

  const quoteMs = Date.now() - quoteT0
  const quotePerTicker = quoteMs / tickers.length

  // ── 3. quoteSummary() — sequential with delays ────────────────────────────
  // quoteSummary() is one request per ticker (no batching).
  // Modules requested: the 4 most useful for scanner filters.
  //
  // Available modules (for reference):
  //   summaryDetail       — PE ratios, dividend yield, beta, volumes
  //   defaultKeyStatistics — EPS, book value, short interest, float
  //   financialData       — margins, ROE/ROA, revenue, debt ratios
  //   assetProfile        — sector, industry, employees, description
  //   earningsTrend       — analyst EPS estimates
  //   recommendationTrend — analyst buy/sell/hold counts
  //   calendarEvents      — next earnings date
  //   incomeStatementHistory — annual P&L
  //   cashflowStatementHistory — annual cash flows
  //   balanceSheetHistory — annual balance sheet

  const QS_MODULES  = ['summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile'] as const
  const QS_DELAY    = 300  // ms between requests — conservative for 2,899 tickers

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`[2/2] quoteSummary()  — modules: ${QS_MODULES.join(', ')}`)
  console.log(`      ${tickers.length} requests, ${QS_DELAY}ms delay each`)
  console.log(`      (This is the heavier call — 1 request per ticker, no batching)`)
  console.log('─'.repeat(60))

  const qsT0    = Date.now()
  let   qsFailed = 0
  let   qsOk     = 0

  for (let i = 0; i < tickers.length; i++) {
    const sym    = tickers[i]
    const bucket = sample[i].bucket
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${tickers.length}] ${sym.padEnd(6)} (${bucket.split(' ')[0]})... `)

    try {
      const t0  = Date.now()
      const qs  = await (yf.quoteSummary(sym, { modules: [...QS_MODULES] as any }, { validateResult: false }) as Promise<any>)
      const ms  = Date.now() - t0

      const sd  = qs?.summaryDetail         ?? null
      const dks = qs?.defaultKeyStatistics  ?? null
      const fd  = qs?.financialData         ?? null
      const ap  = qs?.assetProfile          ?? null

      // ── summaryDetail ─────────────────────────────────────────────────────
      track(stats, 'summaryDetail.previousClose',            sd?.previousClose,            'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.open',                     sd?.open,                     'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.dayLow',                   sd?.dayLow,                   'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.dayHigh',                  sd?.dayHigh,                  'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.beta',                     sd?.beta,                     'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.trailingPE',               sd?.trailingPE,               'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.forwardPE',                sd?.forwardPE,                'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.volume',                   sd?.volume,                   'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.averageVolume',            sd?.averageVolume,            'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.averageVolume10days',      sd?.averageVolume10days,      'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.marketCap',                sd?.marketCap,                'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.fiftyTwoWeekLow',          sd?.fiftyTwoWeekLow,          'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.fiftyTwoWeekHigh',         sd?.fiftyTwoWeekHigh,         'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.priceToSalesTrailing12Months', sd?.priceToSalesTrailing12Months, 'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.fiftyDayAverage',          sd?.fiftyDayAverage,          'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.twoHundredDayAverage',     sd?.twoHundredDayAverage,     'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.dividendRate',             sd?.dividendRate,             'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.dividendYield',            sd?.dividendYield,            'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.exDividendDate',           sd?.exDividendDate,           'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.payoutRatio',              sd?.payoutRatio,              'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.trailingAnnualDividendRate', sd?.trailingAnnualDividendRate, 'quoteSummary(summaryDetail)')
      track(stats, 'summaryDetail.trailingAnnualDividendYield', sd?.trailingAnnualDividendYield, 'quoteSummary(summaryDetail)')

      // ── defaultKeyStatistics ─────────────────────────────────────────────
      track(stats, 'defaultKeyStatistics.beta',              dks?.beta,                    'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.enterpriseValue',   dks?.enterpriseValue,         'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.forwardPE',         dks?.forwardPE,               'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.profitMargins',     dks?.profitMargins,           'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.floatShares',       dks?.floatShares,             'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.sharesOutstanding', dks?.sharesOutstanding,       'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.sharesShort',       dks?.sharesShort,             'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.shortRatio',        dks?.shortRatio,              'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.shortPercentOfFloat', dks?.shortPercentOfFloat,   'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.bookValue',         dks?.bookValue,               'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.priceToBook',       dks?.priceToBook,             'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.trailingEps',       dks?.trailingEps,             'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.forwardEps',        dks?.forwardEps,              'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.pegRatio',          dks?.pegRatio,                'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.lastFiscalYearEnd', dks?.lastFiscalYearEnd,       'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.mostRecentQuarter', dks?.mostRecentQuarter,       'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.earningsQuarterlyGrowth', dks?.earningsQuarterlyGrowth, 'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.netIncomeToCommon', dks?.netIncomeToCommon,       'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.impliedSharesOutstanding', dks?.impliedSharesOutstanding, 'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.enterpriseToRevenue', dks?.enterpriseToRevenue,   'quoteSummary(defaultKeyStatistics)')
      track(stats, 'defaultKeyStatistics.enterpriseToEbitda', dks?.enterpriseToEbitda,     'quoteSummary(defaultKeyStatistics)')

      // ── financialData ────────────────────────────────────────────────────
      track(stats, 'financialData.currentPrice',             fd?.currentPrice,             'quoteSummary(financialData)')
      track(stats, 'financialData.targetHighPrice',          fd?.targetHighPrice,          'quoteSummary(financialData)')
      track(stats, 'financialData.targetLowPrice',           fd?.targetLowPrice,           'quoteSummary(financialData)')
      track(stats, 'financialData.targetMeanPrice',          fd?.targetMeanPrice,          'quoteSummary(financialData)')
      track(stats, 'financialData.recommendationMean',       fd?.recommendationMean,       'quoteSummary(financialData)')
      track(stats, 'financialData.recommendationKey',        fd?.recommendationKey,        'quoteSummary(financialData)')
      track(stats, 'financialData.numberOfAnalystOpinions',  fd?.numberOfAnalystOpinions,  'quoteSummary(financialData)')
      track(stats, 'financialData.totalCash',                fd?.totalCash,                'quoteSummary(financialData)')
      track(stats, 'financialData.totalCashPerShare',        fd?.totalCashPerShare,        'quoteSummary(financialData)')
      track(stats, 'financialData.ebitda',                   fd?.ebitda,                   'quoteSummary(financialData)')
      track(stats, 'financialData.totalDebt',                fd?.totalDebt,                'quoteSummary(financialData)')
      track(stats, 'financialData.quickRatio',               fd?.quickRatio,               'quoteSummary(financialData)')
      track(stats, 'financialData.currentRatio',             fd?.currentRatio,             'quoteSummary(financialData)')
      track(stats, 'financialData.totalRevenue',             fd?.totalRevenue,             'quoteSummary(financialData)')
      track(stats, 'financialData.debtToEquity',             fd?.debtToEquity,             'quoteSummary(financialData)')
      track(stats, 'financialData.revenuePerShare',          fd?.revenuePerShare,          'quoteSummary(financialData)')
      track(stats, 'financialData.returnOnAssets',           fd?.returnOnAssets,           'quoteSummary(financialData)')
      track(stats, 'financialData.returnOnEquity',           fd?.returnOnEquity,           'quoteSummary(financialData)')
      track(stats, 'financialData.grossProfits',             fd?.grossProfits,             'quoteSummary(financialData)')
      track(stats, 'financialData.freeCashflow',             fd?.freeCashflow,             'quoteSummary(financialData)')
      track(stats, 'financialData.operatingCashflow',        fd?.operatingCashflow,        'quoteSummary(financialData)')
      track(stats, 'financialData.earningsGrowth',           fd?.earningsGrowth,           'quoteSummary(financialData)')
      track(stats, 'financialData.revenueGrowth',            fd?.revenueGrowth,            'quoteSummary(financialData)')
      track(stats, 'financialData.grossMargins',             fd?.grossMargins,             'quoteSummary(financialData)')
      track(stats, 'financialData.ebitdaMargins',            fd?.ebitdaMargins,            'quoteSummary(financialData)')
      track(stats, 'financialData.operatingMargins',         fd?.operatingMargins,         'quoteSummary(financialData)')
      track(stats, 'financialData.profitMargins',            fd?.profitMargins,            'quoteSummary(financialData)')

      // ── assetProfile ─────────────────────────────────────────────────────
      track(stats, 'assetProfile.industry',                  ap?.industry,                 'quoteSummary(assetProfile)')
      track(stats, 'assetProfile.sector',                    ap?.sector,                   'quoteSummary(assetProfile)')
      track(stats, 'assetProfile.fullTimeEmployees',         ap?.fullTimeEmployees,        'quoteSummary(assetProfile)')
      track(stats, 'assetProfile.country',                   ap?.country,                  'quoteSummary(assetProfile)')
      track(stats, 'assetProfile.state',                     ap?.state,                    'quoteSummary(assetProfile)')
      track(stats, 'assetProfile.website',                   ap?.website,                  'quoteSummary(assetProfile)')

      process.stdout.write(`ok (${ms}ms)\n`)
      qsOk++
    } catch (e: any) {
      process.stdout.write(`FAILED — ${e.message?.slice(0, 60)}\n`)
      qsFailed++
      // Count nulls for all tracked fields for this ticker
      const QS_FIELD_LIST = [
        'summaryDetail.beta', 'summaryDetail.trailingPE', 'summaryDetail.dividendYield',
        'summaryDetail.marketCap', 'summaryDetail.averageVolume', 'summaryDetail.fiftyTwoWeekHigh',
        'defaultKeyStatistics.shortRatio', 'defaultKeyStatistics.bookValue', 'defaultKeyStatistics.pegRatio',
        'financialData.profitMargins', 'financialData.totalRevenue', 'financialData.debtToEquity',
        'financialData.returnOnEquity', 'financialData.revenueGrowth',
        'assetProfile.sector', 'assetProfile.industry', 'assetProfile.fullTimeEmployees',
      ]
      for (const f of QS_FIELD_LIST) {
        const src = f.startsWith('summaryDetail') ? 'quoteSummary(summaryDetail)'
          : f.startsWith('defaultKeyStatistics') ? 'quoteSummary(defaultKeyStatistics)'
          : f.startsWith('financialData') ? 'quoteSummary(financialData)'
          : 'quoteSummary(assetProfile)'
        track(stats, f, null, src)
      }
    }

    if (i < tickers.length - 1) await sleep(QS_DELAY)
  }

  const qsMs         = Date.now() - qsT0
  const qsPerTicker  = qsMs / tickers.length

  // ── 4. Results ────────────────────────────────────────────────────────────

  console.log('\n')
  console.log('═'.repeat(68))
  console.log('FIELD FILL RATES  (by source)')
  console.log('═'.repeat(68))
  console.log()

  // Group by source, then sort by fill rate descending within each group
  const bySource = new Map<string, Array<[string, FieldStat]>>()
  for (const [field, stat] of stats) {
    const src = stat.source
    if (!bySource.has(src)) bySource.set(src, [])
    bySource.get(src)!.push([field, stat])
  }

  const sourceOrder = [
    'quote()',
    'quoteSummary(summaryDetail)',
    'quoteSummary(defaultKeyStatistics)',
    'quoteSummary(financialData)',
    'quoteSummary(assetProfile)',
  ]

  for (const src of sourceOrder) {
    const entries = bySource.get(src) ?? []
    if (entries.length === 0) continue

    entries.sort((a, b) => (b[1].present / b[1].total) - (a[1].present / a[1].total))

    console.log(`── ${src} ─${'─'.repeat(Math.max(0, 60 - src.length - 5))}`)
    console.log()

    const maxLen = Math.max(...entries.map(([f]) => f.length))
    for (const [field, s] of entries) {
      const pct   = Math.round(s.present / s.total * 100)
      const bar   = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5))
      const flag  = pct >= 90 ? '✓' : pct >= 50 ? '~' : '✗'
      const short = field.replace(/^[^.]+\./, '')  // strip prefix for compact display
      console.log(`  ${flag} ${short.padEnd(maxLen - field.indexOf('.') - 1)}  ${bar}  ${String(pct).padStart(3)}%  (${s.present}/${s.total})`)
    }
    console.log()
  }

  // ── 5. Per-bucket analysis ────────────────────────────────────────────────
  console.log('═'.repeat(68))
  console.log('QUALITY DEGRADATION BY MARKET CAP BUCKET')
  console.log('(key fields only)')
  console.log('═'.repeat(68))
  console.log()

  const KEY_FIELDS = [
    'quote.regularMarketPrice',
    'quote.regularMarketChangePercent',
    'quote.regularMarketVolume',
    'quote.marketCap',
    'quote.trailingPE',
    'quote.beta',
    'quote.dividendYield',
    'quote.fiftyTwoWeekHigh',
    'financialData.profitMargins',
    'financialData.totalRevenue',
    'financialData.debtToEquity',
    'financialData.returnOnEquity',
    'defaultKeyStatistics.shortRatio',
    'defaultKeyStatistics.pegRatio',
  ]

  // re-collect per ticker
  const bucketOrder = ['mega', 'large', 'mid', 'small', 'micro']
  const tickerBucket = new Map(sample.map(t => [t.symbol, t.bucket.split(' ')[0]]))

  // For this analysis, we need per-ticker results. Re-scan what we stored.
  // We'll compare fill rates: check which quotes were null per field.
  const perTickerQuote: Map<string, any> = new Map(Object.entries(quoteResults))

  const hdr = `  ${'Field'.padEnd(42)}  mega  large  mid    small  micro`
  console.log(hdr)
  console.log('  ' + '─'.repeat(hdr.length - 2))

  for (const field of KEY_FIELDS) {
    const bucketOk: Record<string, number[]> = {}
    for (const b of bucketOrder) bucketOk[b] = []

    for (const t of sample) {
      const b = t.symbol in Object.fromEntries(tickerBucket) ? tickerBucket.get(t.symbol)! : 'unknown'
      let val: any = null
      if (field.startsWith('quote.')) {
        const f = field.slice('quote.'.length)
        val = perTickerQuote.get(t.symbol)?.[f]
      }
      // For quoteSummary fields we can only do aggregate — skip per-bucket for QS
      const bucket = bucketOrder.find(bk => b.startsWith(bk)) ?? 'micro'
      if (field.startsWith('quote.')) {
        bucketOk[bucket].push(isDefined(val) ? 1 : 0)
      }
    }

    const shortField = field.replace(/^[^.]+\./, '')
    const cols = bucketOrder.map(b => {
      if (!field.startsWith('quote.')) return ' n/a '
      const arr = bucketOk[b]
      if (!arr.length) return '  — '
      const pct = Math.round(arr.reduce((s, v) => s + v, 0) / arr.length * 100)
      const flag = pct >= 90 ? ' ✓' : pct >= 50 ? ' ~' : ' ✗'
      return `${flag}${String(pct).padStart(3)}%`
    })
    console.log(`  ${shortField.padEnd(42)}  ${cols.join('   ')}`)
  }

  console.log()
  console.log('  (quoteSummary fill rates vary by module — see table above;')
  console.log('   financials are consistently missing for micro-caps and some ETFs)')

  // ── 6. Rate limit & timing report ────────────────────────────────────────

  const FULL_SET    = 2899
  const SAFE_DELAY  = 250   // recommended ms between requests for production

  // quote() batch timings
  const quoteRequestsForFull  = Math.ceil(FULL_SET / QUOTE_BATCH)
  const quoteSecondsEst       = (quoteRequestsForFull * (SAFE_DELAY + quoteMs / Math.ceil(tickers.length / QUOTE_BATCH) / 2)) / 1000
  // quoteSummary timings
  const qsSecondsEst          = FULL_SET * (SAFE_DELAY + qsPerTicker) / 1000

  console.log()
  console.log('═'.repeat(68))
  console.log('TIMING & RATE LIMIT ANALYSIS')
  console.log('═'.repeat(68))
  console.log()
  console.log('  Sample timings (observed):')
  console.log(`    quote()  batch of ${QUOTE_BATCH}: ${Math.round(quoteMs / Math.ceil(tickers.length / QUOTE_BATCH))}ms avg per batch  (${quotePerTicker.toFixed(0)}ms per ticker including ${QUOTE_DELAY}ms delay)`)
  console.log(`    quoteSummary():              ${qsPerTicker.toFixed(0)}ms per ticker including ${QS_DELAY}ms delay  (${(qsMs - tickers.length * QS_DELAY).toFixed(0)}ms network only)`)
  console.log()
  console.log('  Failures (sample):')
  console.log(`    quote()       failed: ${quoteFailed}/${tickers.length}`)
  console.log(`    quoteSummary() failed: ${qsFailed}/${tickers.length}`)
  console.log()
  console.log(`  Extrapolation to ${FULL_SET} tickers (with ${SAFE_DELAY}ms delay):`)
  console.log()
  console.log('  ┌─────────────────────────────┬──────────────┬──────────────────────────────┐')
  console.log('  │ Job                         │ Requests     │ Est. time                    │')
  console.log('  ├─────────────────────────────┼──────────────┼──────────────────────────────┤')
  console.log(`  │ quote() only (daily price)  │ ~${String(quoteRequestsForFull).padEnd(10)} │ ~${fmtMin(quoteSecondsEst).padEnd(28)} │`)
  console.log(`  │ quoteSummary() only (weekly)│ ${String(FULL_SET).padEnd(12)} │ ~${fmtMin(qsSecondsEst).padEnd(28)} │`)
  console.log(`  │ Both same run               │ ~${String(FULL_SET + quoteRequestsForFull).padEnd(10)} │ ~${fmtMin(quoteSecondsEst + qsSecondsEst).padEnd(28)} │`)
  console.log('  └─────────────────────────────┴──────────────┴──────────────────────────────┘')
  console.log()
  console.log('  Rate limit notes:')
  console.log(`    • Yahoo rate-limits at roughly 2,000 req/hr from a single IP.`)
  console.log(`    • At ${SAFE_DELAY}ms between requests, you're at ~240 req/min = ~14,400 req/hr — fine.`)
  console.log(`    • Batch quote() (20 tickers/request) reduces total requests ${QUOTE_BATCH}x,`)
  console.log(`      making daily quote refresh well within limits (~${quoteRequestsForFull} requests total).`)
  console.log(`    • quoteSummary() cannot be batched. At ${FULL_SET} tickers it's the bottleneck.`)
  console.log(`      Run weekly or split into multiple cron jobs (e.g. 1/4 of tickers per day).`)
  console.log(`    • Yahoo blocks are rare at these rates but possible. Add retry with backoff.`)
  console.log(`    • Vercel function timeout is 300s (pro) or 60s (hobby). quoteSummary for`)
  console.log(`      all tickers CANNOT run in a single Vercel function — run via GitHub Actions.`)
  console.log()
  console.log('═'.repeat(68))
  console.log('RECOMMENDATION: what to build filters on')
  console.log('═'.repeat(68))
  console.log()

  // Categorize by fill rate
  const reliable: string[] = [], spotty: string[] = [], missing: string[] = []
  for (const [field, s] of stats) {
    const pct = s.present / s.total * 100
    if (pct >= 80) reliable.push(field)
    else if (pct >= 40) spotty.push(field)
    else missing.push(field)
  }

  console.log(`  RELIABLE (≥80% fill — safe to build filters):`)
  for (const f of reliable.sort()) {
    const s   = stats.get(f)!
    const pct = Math.round(s.present / s.total * 100)
    console.log(`    ${String(pct).padStart(3)}%  ${f}  [${s.source}]`)
  }
  console.log()
  console.log(`  SPOTTY (40-79% fill — usable but expect blank values for many tickers):`)
  for (const f of spotty.sort()) {
    const s   = stats.get(f)!
    const pct = Math.round(s.present / s.total * 100)
    console.log(`    ${String(pct).padStart(3)}%  ${f}  [${s.source}]`)
  }
  console.log()
  console.log(`  LOW FILL (<40% — avoid as primary filters, or show only when present):`)
  for (const f of missing.sort()) {
    const s   = stats.get(f)!
    const pct = Math.round(s.present / s.total * 100)
    console.log(`    ${String(pct).padStart(3)}%  ${f}  [${s.source}]`)
  }
}

function fmtMin(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

main().catch(e => { console.error(e); process.exit(1) })
