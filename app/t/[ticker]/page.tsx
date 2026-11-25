import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { computeConvictionScore } from '@/lib/scoring/convictionScore'
import { holdingsDeltaPct, convictionLabel } from '@/lib/insider/holdingsDelta'
import { displayRole, formatInsiderName, toBreakdown } from '@/lib/insider/format'
import TickerView, { type InsiderTrade, type TickerSignal, type SimilarCompany } from './TickerView'

// Insider data is re-queried at most once an hour per ticker; quote, chart and
// news are fetched client-side from the existing API routes.
export const revalidate = 3600

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

async function getInsiderData(symbol: string) {
  const sb = supabase()

  async function fetchCode(code: 'P' | 'S', max: number): Promise<{ rows: Row[]; full: boolean }> {
    const out: Row[] = []
    for (let from = 0; from < max; from += PAGE) {
      const { data, error } = await sb
        .from('insider_transactions')
        .select(SELECT_COLS)
        .eq('ticker', symbol)
        .eq('transaction_code', code)
        .order('filed_date', { ascending: false })
        .order('transaction_date', { ascending: false })
        .range(from, Math.min(from + PAGE, max) - 1)
      if (error) { console.error(`[ticker] ${code} query failed:`, error.message); break }
      out.push(...((data ?? []) as unknown as Row[]))
      if (!data || data.length < PAGE) return { rows: out, full: false }
    }
    return { rows: out, full: out.length >= max }
  }

  const [buysRes, salesRes, metaRes] = await Promise.all([
    fetchCode('P', BUY_LIMIT),
    fetchCode('S', SALE_LIMIT),
    sb.from('tickers').select('symbol, name, sector, market_cap').eq('symbol', symbol).maybeSingle(),
  ])
  if (metaRes.error) console.error('[ticker] tickers query failed:', metaRes.error.message)

  const byFiled = (a: Row, b: Row) =>
    (b.filed_date ?? b.transaction_date).localeCompare(a.filed_date ?? a.transaction_date) ||
    b.transaction_date.localeCompare(a.transaction_date)
  const rows = [...buysRes.rows, ...salesRes.rows].sort(byFiled)
  const meta = metaRes.data as { name: string | null; sector: string | null; market_cap: number | null } | null

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

  return {
    trades,
    truncated: buysRes.full || salesRes.full,
    signal,
    similar: await getSimilar(sb, symbol, meta),
    company: meta?.name ?? null,
    sector: meta?.sector ?? null,
  }
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
  if (error || !data?.length) return []
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
  return peers
    .map((p) => ({
      symbol: p.symbol,
      name: p.name,
      marketCap: p.market_cap,
      signalScore: best.get(p.symbol) ?? null,
      lastBuyDate: lastBuy.get(p.symbol) ?? null,
    }))
    .sort((a, b) => (b.signalScore != null ? 1 : 0) - (a.signalScore != null ? 1 : 0))
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params
  const symbol = ticker.toUpperCase()
  return {
    title: `${symbol} insider trades | Sentra Signals`,
    description: `Insider buying and selling in ${symbol} from SEC Form 4 filings, scored by Sentra Signals.`,
  }
}

export default async function TickerPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params
  const symbol = decodeURIComponent(ticker).toUpperCase().trim()
  const data = await getInsiderData(symbol)
  return <TickerView symbol={symbol} {...data} />
}
