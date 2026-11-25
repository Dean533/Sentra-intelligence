import type { Metadata } from 'next'
import { Suspense } from 'react'
import { unstable_cache } from 'next/cache'
import { createClient } from '@supabase/supabase-js'
import { computeConvictionScore } from '@/lib/scoring/convictionScore'
import { holdingsDeltaPct, convictionLabel } from '@/lib/insider/holdingsDelta'
import { displayRole, formatInsiderName, toBreakdown } from '@/lib/insider/format'
import { getTickerNewsWithTime, type TickerNews as TickerNewsData } from '@/lib/news/tickerNews'
import TickerView, { type InsiderTrade, type TickerSignal } from './TickerView'
import TickerNews from './TickerNews'
import SimilarCompanies, { type SimilarCompany } from './SimilarCompanies'
import TickerSkeleton from './TickerSkeleton'

// Rendering: the page renders per request and streams. The shell + skeleton
// flush immediately; the insider view, news and "You may also like" each stream
// in their own Suspense boundary as their data arrives. Quote, company facts and
// chart are fetched client-side from the API routes.
//
// Caching (Next data cache, shared across requests):
//   - insider trades, ticker row and peers: 1 hour (INSIDER_TTL below). Insider
//     data only changes when the daily cron ingests new Form 4s.
//   - Yahoo quote/facts/chart: lib/yahoo.ts; news: lib/news/tickerNews.ts.
// A query error is never cached: the loader throws Uncacheable, so the page
// shows that request's partial result (as before) and the next request retries.
const INSIDER_TTL = 60 * 60

// "Recent" for the signal strip: an opportunistic buy filed in the last 90 days
// (the same longest window the homepage's top-10 widens to).
const SIGNAL_WINDOW_DAYS = 90
// Purchases are fetched separately from sales: heavy sellers (NVDA has ~1,900
// sale rows) would otherwise push every purchase past the row cap.
const BUY_LIMIT = 1000
const SALE_LIMIT = 2000
const PAGE = 1000 // PostgREST max rows per request

type Row = {
  id: string | number
  insider_name: string | null
  role: string | null
  officer_title: string | null
  transaction_date: string
  transaction_code: string | null
  filed_date: string | null
  shares: number | null
  shares_owned_after: number | null
  price_per_share: number | null
  total_value: number | null
  conviction_score: number | null
  classification: 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null
}

const SELECT_COLS =
  'id, insider_name, role, officer_title, transaction_date, transaction_code, filed_date, ' +
  'shares, shares_owned_after, price_per_share, total_value, conviction_score, classification'

function supabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

type Meta = { name: string | null; sector: string | null; market_cap: number | null } | null

// Thrown from a cached loader when one of its queries failed. unstable_cache
// never stores a rejection, so the partial value is served for this request
// only (see orFallback) and the next request queries again.
class Uncacheable<T> extends Error {
  constructor(readonly value: T) { super('partial result, not cached') }
}

async function orFallback<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof Uncacheable) return e.value as T
    throw e
  }
}

async function getMeta(sb: ReturnType<typeof supabase>, symbol: string): Promise<Meta> {
  const { data, error } = await sb.from('tickers').select('symbol, name, sector, market_cap').eq('symbol', symbol).maybeSingle()
  if (error) {
    console.error('[ticker] tickers query failed:', error.message)
    throw new Uncacheable<Meta>(null)
  }
  return (data as Meta) ?? null
}

async function getInsiderData(sb: ReturnType<typeof supabase>, symbol: string, metaP: Promise<Meta>) {
  let failed = false
  // All pages of a code are requested in parallel (the row cap is known up front);
  // results are kept in page order and stop at the first short page, exactly as
  // the previous one-page-at-a-time loop did.
  async function fetchCode(code: 'P' | 'S', max: number): Promise<{ rows: Row[]; full: boolean }> {
    const starts: number[] = []
    for (let from = 0; from < max; from += PAGE) starts.push(from)
    const pages = await Promise.all(starts.map((from) =>
      sb
        .from('insider_transactions')
        .select(SELECT_COLS)
        .eq('ticker', symbol)
        .eq('transaction_code', code)
        .order('filed_date', { ascending: false })
        .order('transaction_date', { ascending: false })
        .range(from, Math.min(from + PAGE, max) - 1),
    ))
    const out: Row[] = []
    for (const { data, error } of pages) {
      if (error) { console.error(`[ticker] ${code} query failed:`, error.message); failed = true; break }
      out.push(...((data ?? []) as unknown as Row[]))
      if (!data || data.length < PAGE) return { rows: out, full: false }
    }
    return { rows: out, full: out.length >= max }
  }

  const [buysRes, salesRes, meta] = await Promise.all([
    fetchCode('P', BUY_LIMIT),
    fetchCode('S', SALE_LIMIT),
    metaP,
  ])

  const byFiled = (a: Row, b: Row) =>
    (b.filed_date ?? b.transaction_date).localeCompare(a.filed_date ?? a.transaction_date) ||
    b.transaction_date.localeCompare(a.transaction_date)
  const rows = [...buysRes.rows, ...salesRes.rows].sort(byFiled)

  const trades: InsiderTrade[] = rows.map((r) => {
    const isBuy = r.transaction_code === 'P'
    return {
      id: String(r.id),
      filed: (r.filed_date ?? r.transaction_date).slice(0, 10),
      date: r.transaction_date.slice(0, 10),
      insider: formatInsiderName(r.insider_name),
      role: displayRole(r),
      isBuy,
      value: r.total_value,
      shares: r.shares,
      sharesOwnedAfter: r.shares_owned_after,
      stake: holdingsDeltaPct(r),
      cls: r.classification,
      // Only purchases are scored.
      score: isBuy ? r.conviction_score : null,
    }
  })

  // Signal strip: best-scored opportunistic buy filed inside the window.
  const cutoff = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const candidates = rows.filter(
    (r) =>
      r.transaction_code === 'P' &&
      r.classification === 'OPPORTUNISTIC' &&
      r.conviction_score != null &&
      (r.filed_date ?? r.transaction_date) >= cutoff,
  )
  candidates.sort(
    (a, b) =>
      (b.conviction_score ?? 0) - (a.conviction_score ?? 0) ||
      (b.total_value ?? 0) - (a.total_value ?? 0),
  )
  const top = candidates[0]

  let signal: TickerSignal | null
  if (top) {
    const result = computeConvictionScore(
      {
        ticker: symbol,
        insider_name: top.insider_name ?? '',
        officer_title: top.officer_title,
        role: top.role,
        total_value: top.total_value,
        price_per_share: top.price_per_share,
        transaction_date: top.transaction_date,
        is_opportunistic: true,
        is_local: null,
        sector: null,
        cluster_count: 0,
        cluster_total_value: 0,
        insider_median_value: null,
        classification: top.classification,
        shares: top.shares,
        shares_owned_after: top.shares_owned_after,
        market_cap: meta?.market_cap ?? null,
      },
      [],
      [],
    )
    const role = displayRole(top)
    const score = top.conviction_score ?? result.score
    signal = {
      tradeId: String(top.id),
      score,
      label: convictionLabel('OPPORTUNISTIC', score),
      insider: formatInsiderName(top.insider_name),
      role,
      value: top.total_value,
      stake: holdingsDeltaPct(top),
      date: top.transaction_date.slice(0, 10),
      breakdown: toBreakdown(result.breakdown, role),
    }
  } else {
    signal = null
  }

  const result = {
    trades,
    truncated: buysRes.full || salesRes.full,
    signal,
    company: meta?.name ?? null,
    sector: meta?.sector ?? null,
  }
  if (failed) throw new Uncacheable(result)
  return result
}

// "You may also like": nearest market cap (log scale) within the same sector —
// NOTE: matching by industry (not sector) was requested, but `tickers` has no
// industry column (only Yahoo's live assetProfile.industry, fetched per-ticker
// client-side, not stored in bulk for peer discovery). Sector is the closest
// buildable proxy without a schema change; flagged to the user rather than
// faked with per-candidate live Yahoo calls.
// Peers with a recent opportunistic buy sort first; others keep market-cap order.
async function getSimilar(
  sb: ReturnType<typeof supabase>,
  symbol: string,
  meta: { sector: string | null; market_cap: number | null } | null,
): Promise<SimilarCompany[]> {
  if (!meta?.sector) return []
  const { data, error } = await sb
    .from('tickers')
    .select('symbol, name, market_cap')
    .eq('sector', meta.sector)
    .neq('symbol', symbol)
    .not('market_cap', 'is', null)
    .limit(1000)
  if (error) throw new Uncacheable<SimilarCompany[]>([])
  if (!data?.length) return []
  const target = Math.log10(meta.market_cap ?? 1e10)
  const peers = (data as { symbol: string; name: string | null; market_cap: number }[])
    .filter((t) => t.market_cap > 0)
    .sort((a, b) => Math.abs(Math.log10(a.market_cap) - target) - Math.abs(Math.log10(b.market_cap) - target))
    .slice(0, 5)
  if (peers.length === 0) return []

  const symbols = peers.map((p) => p.symbol)
  const cutoff = new Date(Date.now() - SIGNAL_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const [sigRes, lastBuyRes] = await Promise.all([
    sb.from('insider_transactions')
      .select('ticker, conviction_score')
      .in('ticker', symbols)
      .eq('transaction_code', 'P')
      .eq('classification', 'OPPORTUNISTIC')
      .gte('filed_date', cutoff)
      .not('conviction_score', 'is', null),
    // Most recent purchase of any kind, unbounded — shown when there's no recent
    // Opportunistic signal so the line reads "Last insider buy: ..." instead of
    // a flat "no signal." Only 5 tickers, so a 1000-row cap comfortably covers it.
    sb.from('insider_transactions')
      .select('ticker, transaction_date')
      .in('ticker', symbols)
      .eq('transaction_code', 'P')
      .order('transaction_date', { ascending: false })
      .limit(1000),
  ])
  const best = new Map<string, number>()
  for (const r of (sigRes.data ?? []) as { ticker: string; conviction_score: number }[]) {
    best.set(r.ticker, Math.max(best.get(r.ticker) ?? 0, r.conviction_score))
  }
  const lastBuy = new Map<string, string>()
  for (const r of (lastBuyRes.data ?? []) as { ticker: string; transaction_date: string }[]) {
    if (!lastBuy.has(r.ticker)) lastBuy.set(r.ticker, r.transaction_date)
  }
  const similar = peers
    .map((p) => ({
      symbol: p.symbol,
      name: p.name,
      marketCap: p.market_cap,
      signalScore: best.get(p.symbol) ?? null,
      lastBuyDate: lastBuy.get(p.symbol) ?? null,
    }))
    .sort((a, b) => (b.signalScore != null ? 1 : 0) - (a.signalScore != null ? 1 : 0))
  if (sigRes.error || lastBuyRes.error) throw new Uncacheable(similar)
  return similar
}

// ─── Cached loaders (1 hour, shared across requests) ─────────────────────────

const cachedMeta = unstable_cache(
  (symbol: string) => getMeta(supabase(), symbol),
  ['ticker-meta-v1'],
  { revalidate: INSIDER_TTL, tags: ['insider'] },
)
const loadMeta = (symbol: string) => orFallback(cachedMeta(symbol))

// Loaders that depend on the ticker row: if that query failed, their result was
// built without it, so it must not be cached either.
async function withMeta<T>(symbol: string, build: (metaP: Promise<Meta>) => Promise<T>): Promise<T> {
  let metaFailed = false
  const metaP = cachedMeta(symbol).catch((e) => {
    if (e instanceof Uncacheable) { metaFailed = true; return e.value as Meta }
    throw e
  })
  const result = await build(metaP)
  if (metaFailed) throw new Uncacheable(result)
  return result
}

const cachedInsiderData = unstable_cache(
  (symbol: string) => withMeta(symbol, (metaP) => getInsiderData(supabase(), symbol, metaP)),
  ['ticker-insider-v1'],
  { revalidate: INSIDER_TTL, tags: ['insider'] },
)
const loadInsiderData = (symbol: string) => orFallback(cachedInsiderData(symbol))

const cachedSimilar = unstable_cache(
  (symbol: string) => withMeta(symbol, async (metaP) => getSimilar(supabase(), symbol, await metaP)),
  ['ticker-similar-v1'],
  { revalidate: INSIDER_TTL, tags: ['insider'] },
)
const loadSimilar = (symbol: string) => orFallback(cachedSimilar(symbol))

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params
  const symbol = ticker.toUpperCase()
  return {
    title: `${symbol} insider trades | Sentra Signals`,
    description: `Insider buying and selling in ${symbol} from SEC Form 4 filings, scored by Sentra Signals.`,
  }
}

// ─── Streamed sections ───────────────────────────────────────────────────────

async function InsiderSection({ symbol, dataP, news, similar }: {
  symbol: string
  dataP: ReturnType<typeof loadInsiderData>
  news: React.ReactNode
  similar: React.ReactNode
}) {
  const data = await dataP
  return <TickerView symbol={symbol} {...data} news={news} similar={similar} />
}

async function NewsSection({ newsP }: { newsP: Promise<TickerNewsData | null> }) {
  const news = await newsP
  return <TickerNews items={news?.items ?? []} fetchedAt={news?.fetchedAt ?? null} />
}

async function SimilarSection({ similarP, metaP }: { similarP: Promise<SimilarCompany[]>; metaP: Promise<Meta> }) {
  const [similar, meta] = await Promise.all([similarP, metaP])
  return <SimilarCompanies similar={similar} sectorLabel={meta?.sector ?? null} />
}

export default async function TickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase().trim()

  // Start everything now; each section awaits only what it needs.
  const metaP = loadMeta(symbol)
  const dataP = loadInsiderData(symbol)
  const newsP: Promise<TickerNewsData | null> = metaP
    .then((m) => getTickerNewsWithTime(symbol, m?.name ?? null))
    .catch((e) => {
      console.error('[ticker] news failed:', e instanceof Error ? e.message : e)
      return null // renders the "no headlines" state, same as the old client fallback
    })
  const similarP = loadSimilar(symbol).catch(() => [] as SimilarCompany[])

  return (
    <Suspense fallback={<TickerSkeleton symbol={symbol} />}>
      <InsiderSection
        symbol={symbol}
        dataP={dataP}
        news={
          <Suspense fallback={<TickerNews items={null} fetchedAt={null} />}>
            <NewsSection newsP={newsP} />
          </Suspense>
        }
        similar={
          <Suspense fallback={null}>
            <SimilarSection similarP={similarP} metaP={metaP} />
          </Suspense>
        }
      />
    </Suspense>
  )
}
