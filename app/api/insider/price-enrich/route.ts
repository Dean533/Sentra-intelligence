import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'
import {
  fetchHistory,
  offsetDate,
  computePriceEnrichment,
  PRICE_ENRICH_CUTOFF_DAYS,
  type HistRow,
} from '@/lib/scoring/priceEnrich'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// Vercel Hobby's hard ceiling is 60s; staying well under it is what matters,
// not maxing it out — a smaller batch below leaves headroom for Yahoo's
// variable latency.
export const maxDuration = 60

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // 1. Fetch unenriched insider transactions (only rows old enough that every
  // forward return window has closed)
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - PRICE_ENRICH_CUTOFF_DAYS)
  const cutoffStr = cutoff.toISOString().split('T')[0]

  const { data: rows, error } = await supabase
    .from('insider_transactions')
    .select('id, ticker, transaction_date, total_value')
    .not('transaction_date', 'is', null)
    .lte('transaction_date', cutoffStr)
    .is('price_on_day', null)
    .order('transaction_date', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ total: 0, enriched: 0, failed: 0 })

  console.log(`[price-enrich] fetched ${rows.length} rows. First: ${rows[0].ticker} ${rows[0].transaction_date}`)

  // 2. Load market caps for all tickers in this batch
  const tickerSet = [...new Set(rows.map((r: any) => r.ticker as string))]
  const { data: tickerMeta } = await supabase
    .from('tickers')
    .select('symbol, market_cap')
    .in('symbol', tickerSet)

  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerMeta ?? []) {
    marketCapMap[t.symbol] = t.market_cap ?? null
  }

  // 3. Fetch history per unique ticker (cached) and SPY per unique date (cached).
  // Previously fetchHistory(row.ticker, ...) ran once PER ROW — a ticker with
  // several buys in the batch refetched the same Yahoo window every time.
  // Caching by ticker collapses that to one Yahoo call per distinct ticker.
  const tickerHistoryCache = new Map<string, HistRow[]>()
  const spyCache           = new Map<string, HistRow[]>()

  async function getTickerHistory(ticker: string, txDate: Date): Promise<HistRow[]> {
    if (tickerHistoryCache.has(ticker)) return tickerHistoryCache.get(ticker)!
    const hist = await fetchHistory(ticker, offsetDate(txDate, -10), offsetDate(txDate, 16))
    tickerHistoryCache.set(ticker, hist)
    await sleep(200)
    return hist
  }

  async function getSpyHistory(dateStr: string): Promise<HistRow[]> {
    if (spyCache.has(dateStr)) return spyCache.get(dateStr)!
    const base = new Date(dateStr)
    const hist = await fetchHistory('SPY', offsetDate(base, -10), offsetDate(base, 16))
    spyCache.set(dateStr, hist)
    await sleep(50)
    return hist
  }

  let enriched = 0
  let failed   = 0

  for (const row of rows) {
    try {
      const txDate  = new Date(row.transaction_date)
      const dateStr = row.transaction_date as string

      const history = await getTickerHistory(row.ticker, txDate)
      if (history.length === 0) { console.log(`[price-enrich] ${row.ticker} SKIP: no history returned`); failed++; continue }

      const spyHistory = await getSpyHistory(dateStr)
      const marketCap   = marketCapMap[row.ticker] ?? null

      const result = computePriceEnrichment(row, history, spyHistory, marketCap)
      if (result == null) { console.log(`[price-enrich] ${row.ticker} SKIP: price_on_day is null`); failed++; continue }

      const { error: updateErr } = await supabase
        .from('insider_transactions')
        .update(result)
        .eq('id', row.id)

      if (updateErr) { console.log(`[price-enrich] ${row.ticker} SKIP: supabase update error:`, updateErr.message); failed++; continue }

      enriched++
    } catch (err: any) {
      console.error('ENRICH ERROR:', row.ticker, err)
      failed++
    }
  }

  return NextResponse.json({ total: rows.length, enriched, failed })
}
