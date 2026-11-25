'use client'

// Supabase tables (run once in SQL editor):
//
// CREATE TABLE watchlists (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
//   name TEXT NOT NULL, description TEXT DEFAULT '',
//   tickers TEXT[] DEFAULT '{}',
//   created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
// );
// ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "own watchlist" ON watchlists FOR ALL
//   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
//
// CREATE TABLE portfolio_trades (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
//   ticker TEXT NOT NULL, shares NUMERIC NOT NULL,
//   cost_per_share NUMERIC NOT NULL, trade_date DATE NOT NULL,
//   direction TEXT DEFAULT 'buy', created_at TIMESTAMPTZ DEFAULT NOW()
// );
// ALTER TABLE portfolio_trades ENABLE ROW LEVEL SECURITY;
// CREATE POLICY "own trades" ON portfolio_trades FOR ALL
//   USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'
import { displayRole, formatInsiderName } from '@/lib/insider/format'

// ─── Types ────────────────────────────────────────────────────────────────────

type Portfolio = { name: string; description: string; tickers: string[] }

type TickerRow = {
  ticker: string; name: string | null
  price: number | null; changePercent: number | null
  volume: number | null; marketCap: number | null
  pe: number | null; week52High: number | null; week52Low: number | null
  score: number | null
}

type NewsItem = {
  ticker: string; title: string; source: string | null
  publishedAt: string; url: string | null
}

type InsiderRow = {
  id: string; ticker: string
  insider_name: string | null; role: string | null; officer_title: string | null
  transaction_date: string; transaction_code: string | null
  shares: number | null; price_per_share: number | null; total_value: number | null
  classification: string | null
  // /api/insider/fetch returns conviction_score; sentra_score kept as a fallback.
  conviction_score?: number | null; sentra_score?: number | null
}

type PortfolioTrade = {
  id: string; ticker: string
  shares: number; cost_per_share: number
  trade_date: string; direction: 'buy' | 'sell'
}

type AddTradeForm = {
  ticker: string; date: string
  direction: 'buy' | 'sell'
  shares: string; cost: string
}

type Position = {
  netShares: number; avgCost: number; costBasis: number
  marketValue: number | null
  gainDollar: number | null; gainPct: number | null
  dayChangeDollar: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO() { return new Date().toISOString().slice(0, 10) }

function fmtVolume(n: number | null) {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}

function fmtCurrency(val: number | null) {
  if (val == null) return '—'
  const abs = Math.abs(val)
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`
  return `$${val.toFixed(2)}`
}

function fmtDollar(n: number | null, sign = false) {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const pre = n < 0 ? '−' : sign ? '+' : ''
  if (abs >= 1e6) return `${pre}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${pre}$${(abs / 1e3).toFixed(1)}K`
  return `${pre}$${abs.toFixed(2)}`
}

function fmtPct(n: number | null, sign = false) {
  if (n == null) return '—'
  return `${n < 0 ? '−' : sign ? '+' : ''}${Math.abs(n).toFixed(2)}%`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
}

function timeAgo(iso: string) {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (h < 1) return `${Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)}m ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Some feed titles arrive HTML-escaped ("S&amp;P 500").
function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// Up / down text color (same convention as the ticker page).
function tone(n: number | null | undefined) {
  if (n == null) return 'text-muted'
  return n >= 0 ? 'text-opportunistic' : 'text-routine'
}

function computePosition(ticker: string, trades: PortfolioTrade[], row: TickerRow): Position | null {
  const t = trades.filter((tr) => tr.ticker === ticker)
  if (!t.length) return null
  let net = 0, basis = 0
  for (const tr of t) {
    if (tr.direction === 'buy') { net += tr.shares; basis += tr.shares * tr.cost_per_share }
    else                        { net -= tr.shares; basis -= tr.shares * tr.cost_per_share }
  }
  if (net <= 0) return null
  const avg = basis / net
  const mkt = row.price != null ? net * row.price : null
  const gain = mkt != null ? mkt - basis : null
  const gainP = basis > 0 && gain != null ? (gain / basis) * 100 : null
  const dayChg = row.price != null && row.changePercent != null ? net * row.price * (row.changePercent / 100) : null
  return { netShares: net, avgCost: avg, costBasis: basis, marketValue: mkt, gainDollar: gain, gainPct: gainP, dayChangeDollar: dayChg }
}

function calcTrade(tr: PortfolioTrade, row: TickerRow | undefined) {
  const cost = tr.shares * tr.cost_per_share
  const mkt  = row?.price != null && tr.direction === 'buy' ? tr.shares * row.price : null
  const gain = mkt != null ? mkt - cost : null
  const gainP = cost > 0 && gain != null ? (gain / cost) * 100 : null
  const dayChg = row?.price != null && row?.changePercent != null && tr.direction === 'buy'
    ? tr.shares * row.price * (row.changePercent / 100) : null
  return { cost, mkt, gain, gainP, dayChg }
}

const CLS: Record<string, { label: string; color: string }> = {
  OPPORTUNISTIC:  { label: 'Opportunistic',  color: 'var(--color-opportunistic)' },
  UNCLASSIFIABLE: { label: 'Unclassifiable', color: 'var(--color-unclassifiable)' },
  ROUTINE:        { label: 'Routine',        color: 'var(--color-routine)' },
}

// Same buy/sale marker colors as the ticker page chart.
const BUY_COLOR  = '#58A6FF'
const SALE_COLOR = '#F0883E'

// ─── Styles (match the homepage top-10 table) ─────────────────────────────────

const thBase = 'whitespace-nowrap px-4 py-3 font-mono text-[11px] font-medium tracking-[0.08em] text-muted'
const th    = `${thBase} text-left`
const thR   = `${thBase} text-right`
const td    = 'whitespace-nowrap px-4 py-[13px]'
const tdR   = `${td} text-right font-mono`
const trCls = 'border-b border-row-border last:border-b-0 hover:bg-surface-hover'
const tableWrap = 'overflow-x-auto rounded-md border border-border'
const theadRow  = 'border-b border-border bg-surface'

const inputCls =
  'h-10 rounded-sm border border-border-strong bg-surface px-3 font-sans text-sm text-text outline-none placeholder:text-muted focus:border-muted disabled:opacity-50'
const btnPrimary =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-sm border-0 bg-text px-4 font-sans text-sm font-semibold text-background transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40'
const btnSecondary =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-transparent px-4 font-sans text-sm text-text-secondary transition-colors hover:border-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-40'
const h2Cls = 'm-0 font-serif text-[24px] font-normal leading-tight text-heading md:text-[28px]'

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="flex w-fit overflow-hidden rounded-sm border border-border-strong" role="group" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-[34px] cursor-pointer border-0 px-3.5 font-sans text-[13px] ${i ? 'border-l border-solid border-border-strong' : ''} ${
            value === o.value ? 'bg-track text-heading' : 'bg-transparent text-muted hover:text-text-secondary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-border px-6 py-10 text-center text-sm text-muted">{children}</div>
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background pt-16 text-text">
      <main className="mx-auto max-w-[1400px] px-4 pb-24 md:px-8">{children}</main>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

// ─── Signed-out prompt ────────────────────────────────────────────────────────

function SignInPrompt() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Same OAuth call as /login; /auth/callback returns the user to /watchlist.
  async function handleGoogle() {
    setLoading(true); setError(null)
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth/callback' },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  return (
    <PageShell>
      <section className="flex flex-col gap-3 pb-8 pt-10 md:pt-14">
        <div className="label-mono">WATCHLIST</div>
        <h1 className="m-0 font-serif text-[36px] font-normal leading-[1.08] tracking-[-0.01em] text-heading md:text-[46px]">Your watchlist</h1>
      </section>
      <div className="flex max-w-[560px] flex-col gap-5 rounded-md border border-border bg-surface p-6 md:p-8">
        <p className="m-0 text-base leading-relaxed text-text-secondary">
          Sign in with Google to track tickers and see their insider activity.
        </p>
        {error && <div className="rounded-sm border border-routine/30 bg-routine/10 px-3.5 py-2.5 text-[13px] text-routine">{error}</div>}
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={handleGoogle} disabled={loading} className={`${btnPrimary} h-11 gap-2.5 px-5`}>
            <GoogleIcon />
            {loading ? 'Redirecting…' : 'Sign in with Google'}
          </button>
          <Link href="/login" className="text-sm text-text-secondary underline underline-offset-2 hover:text-white">
            Use email instead
          </Link>
        </div>
      </div>
    </PageShell>
  )
}

// ─── Creation screen ──────────────────────────────────────────────────────────

function CreateScreen({ onCreate }: { onCreate: (p: Portfolio) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  function go() { if (name.trim()) onCreate({ name: name.trim(), description: desc.trim(), tickers: [] }) }
  return (
    <PageShell>
      <section className="flex flex-col gap-3 pb-8 pt-10 md:pt-14">
        <div className="label-mono">WATCHLIST</div>
        <h1 className="m-0 font-serif text-[36px] font-normal leading-[1.08] tracking-[-0.01em] text-heading md:text-[46px]">Create your watchlist</h1>
        <p className="m-0 max-w-[560px] text-base leading-relaxed text-text-secondary">Track insider signals for the stocks you own or follow.</p>
      </section>
      <div className="flex max-w-[440px] flex-col gap-3">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} placeholder="Watchlist name" aria-label="Watchlist name" autoFocus className={`${inputCls} w-full`} />
        <input value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} placeholder="Description (optional)" aria-label="Description" className={`${inputCls} w-full`} />
        <button onClick={go} disabled={!name.trim()} className={`${btnPrimary} mt-2 w-full`}>
          Create watchlist
        </button>
      </div>
    </PageShell>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const [user,      setUser]      = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [signedOut, setSignedOut] = useState(false)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [dbLoading, setDbLoading] = useState(true)

  const [editing,  setEditing]  = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const [tickerInput,   setTickerInput]   = useState('')
  const [validating,    setValidating]    = useState(false)
  const [validateError, setValidateError] = useState<string | null>(null)
  const tickerRef = useRef<HTMLInputElement>(null)

  const [data,    setData]    = useState<TickerRow[]>([])
  const [news,    setNews]    = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(false)

  const [activeSection, setActiveSection] = useState<'news' | 'insider'>('news')
  const [dirFilter,     setDirFilter]     = useState<'all' | 'buys' | 'sells'>('buys')
  const [insiderTrades, setInsiderTrades] = useState<InsiderRow[]>([])
  const [loadingFeed,   setLoadingFeed]   = useState(false)

  const [view,          setView]          = useState<'tickers' | 'trades'>('tickers')
  const [trades,        setTrades]        = useState<PortfolioTrade[]>([])
  const [addForm,       setAddForm]       = useState<AddTradeForm | null>(null)
  const [savingTrade,   setSavingTrade]   = useState(false)
  const [fetchingPrice, setFetchingPrice] = useState(false)

  // ── Auth ──────────────────────────────────────────────────────────────────────
  // Signed out: show the sign-in prompt in place (previously redirected to /login).
  useEffect(() => {
    getSupabase().auth.getUser().then(({ data: { user } }) => {
      if (!user) { setSignedOut(true); return }
      setUser(user); setAuthReady(true)
    })
  }, [])

  // ── Load portfolio ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !user) return
    setDbLoading(true)
    getSupabase().from('watchlists').select('name, description, tickers')
      .eq('user_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (data) setPortfolio({ name: data.name, description: data.description ?? '', tickers: data.tickers ?? [] })
        setDbLoading(false)
      })
  }, [authReady, user])

  // ── Load trades ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !user) return
    getSupabase().from('portfolio_trades')
      .select('id, ticker, shares, cost_per_share, trade_date, direction')
      .eq('user_id', user.id).order('trade_date', { ascending: false })
      .then(({ data }) => setTrades((data ?? []) as PortfolioTrade[]))
  }, [authReady, user])

  // ── Persist portfolio ─────────────────────────────────────────────────────────
  async function save(p: Portfolio) {
    setPortfolio(p)
    if (!user) return
    await getSupabase().from('watchlists').upsert(
      { user_id: user.id, name: p.name, description: p.description, tickers: p.tickers, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  }

  // ── Market data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!portfolio || !portfolio.tickers.length) { setData([]); setNews([]); return }
    setLoading(true)
    fetch(`/api/watchlist/data?tickers=${portfolio.tickers.join(',')}`)
      .then((r) => r.json())
      .then((d) => { setData(d.tickers ?? []); setNews(d.news ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portfolio?.tickers.join(',')])

  // ── Insider feed ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!portfolio || !portfolio.tickers.length) { setInsiderTrades([]); return }
    setLoadingFeed(true)
    fetch(`/api/insider/fetch?tickers=${portfolio.tickers.join(',')}&direction=${dirFilter}&limit=50`)
      .then((r) => r.json())
      .then((d) => setInsiderTrades(d.rows ?? []))
      .catch(() => {})
      .finally(() => setLoadingFeed(false))
  }, [portfolio?.tickers.join(','), dirFilter])

  // ── Ticker management ─────────────────────────────────────────────────────────
  function startEdit() { setEditName(portfolio!.name); setEditDesc(portfolio!.description); setEditing(true) }
  function saveEdit() { if (editName.trim()) { save({ ...portfolio!, name: editName.trim(), description: editDesc.trim() }); setEditing(false) } }

  async function addTicker() {
    const t = tickerInput.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (!t || portfolio!.tickers.includes(t)) { setTickerInput(''); return }
    setValidating(true); setValidateError(null)
    try {
      const d = await fetch(`/api/watchlist/data?tickers=${t}`).then((r) => r.json())
      if (!d.tickers?.[0]?.name) { setValidateError(`${t} not found in coverage universe`); return }
      await save({ ...portfolio!, tickers: [...portfolio!.tickers, t] })
      setTickerInput(''); tickerRef.current?.focus()
    } catch { setValidateError('Validation failed') }
    finally { setValidating(false) }
  }

  // ── Trade actions ─────────────────────────────────────────────────────────────
  function openAdd(ticker = '') {
    setAddForm({ ticker: ticker.toUpperCase(), date: todayISO(), direction: 'buy', shares: '', cost: '' })
    if (ticker) setView('trades')
  }

  async function fetchTodayPrice() {
    if (!addForm?.ticker.trim()) return
    setFetchingPrice(true)
    try {
      const d = await fetch(`/api/watchlist/data?tickers=${addForm.ticker.trim()}`).then((r) => r.json())
      const p = d.tickers?.[0]?.price
      if (p != null) setAddForm((f) => f ? { ...f, cost: String(p) } : f)
    } catch { /* ignore */ }
    finally { setFetchingPrice(false) }
  }

  async function saveTrade() {
    if (!addForm || !user) return
    const ticker = addForm.ticker.trim().toUpperCase()
    const shares = parseFloat(addForm.shares)
    const cost   = parseFloat(addForm.cost)
    if (!ticker || !shares || !cost || !addForm.date) return
    setSavingTrade(true)
    const { data: t, error } = await getSupabase().from('portfolio_trades')
      .insert({ user_id: user.id, ticker, shares, cost_per_share: cost, trade_date: addForm.date, direction: addForm.direction })
      .select('id, ticker, shares, cost_per_share, trade_date, direction').single()
    if (!error && t) setTrades((prev) => [t as PortfolioTrade, ...prev])
    setSavingTrade(false)
    setAddForm(null)
  }

  // ── Guards ────────────────────────────────────────────────────────────────────
  if (signedOut)               return <SignInPrompt />
  if (!authReady || dbLoading) return <div className="min-h-screen bg-background pt-16" />
  if (!portfolio)              return <CreateScreen onCreate={save} />

  // ── Derived ───────────────────────────────────────────────────────────────────
  const tickerMap = new Map(data.map((r) => [r.ticker, r]))
  const positions = new Map(data.map((r) => [r.ticker, computePosition(r.ticker, trades, r)]))

  // Summary totals (positions only — buy aggregates)
  const posArr    = [...positions.values()].filter(Boolean) as Position[]
  const sumCost   = posArr.reduce((s, p) => s + p.costBasis, 0)
  const sumMkt    = posArr.reduce((s, p) => s + (p.marketValue ?? 0), 0)
  const sumGain   = sumMkt - sumCost
  const sumGainPc = sumCost > 0 ? (sumGain / sumCost) * 100 : 0
  const sumDayChg = posArr.reduce((s, p) => s + (p.dayChangeDollar ?? 0), 0)

  // Trades view totals (buy trades only)
  const buyTrades  = trades.filter((t) => t.direction === 'buy')
  const tSumCost   = buyTrades.reduce((s, t) => s + calcTrade(t, tickerMap.get(t.ticker)).cost, 0)
  const tSumMkt    = buyTrades.reduce((s, t) => s + (calcTrade(t, tickerMap.get(t.ticker)).mkt ?? 0), 0)
  const tSumGain   = tSumMkt - tSumCost
  const tSumGainPc = tSumCost > 0 ? (tSumGain / tSumCost) * 100 : 0
  const tSumDayChg = buyTrades.reduce((s, t) => s + (calcTrade(t, tickerMap.get(t.ticker)).dayChg ?? 0), 0)

  const formLabel = 'label-mono mb-1.5 block'
  const canSaveTrade = !!addForm && !!addForm.ticker.trim() && !!addForm.shares && !!addForm.cost

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <PageShell>
      {/* ── Header ── */}
      <section className="flex flex-wrap items-end justify-between gap-6 pb-6 pt-10 md:pt-14">
        {editing ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }} autoFocus aria-label="Watchlist name" className={`${inputCls} w-full font-medium sm:w-[240px]`} />
            <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }} placeholder="Description" aria-label="Description" className={`${inputCls} w-full sm:w-[280px]`} />
            <button onClick={saveEdit} className={btnPrimary}>Save</button>
            <button onClick={() => setEditing(false)} className={btnSecondary}>Cancel</button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="label-mono">WATCHLIST</div>
            <h1 className="m-0 break-words font-serif text-[36px] font-normal leading-[1.08] tracking-[-0.01em] text-heading md:text-[46px]">{portfolio.name}</h1>
            {portfolio.description && <p className="m-0 max-w-[640px] text-base leading-relaxed text-text-secondary">{portfolio.description}</p>}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[{ value: 'tickers', label: 'Tickers' }, { value: 'trades', label: 'Trades' }]}
          />
          {!editing && <button onClick={startEdit} className={`${btnSecondary} h-[34px] px-3.5 text-[13px]`}>Edit</button>}
        </div>
      </section>

      {/* ── Add ticker + chips ── */}
      <section className="flex flex-col gap-3 border-t border-border pb-6 pt-6">
        <div className="flex items-center gap-2">
          <input ref={tickerRef} value={tickerInput}
            onChange={(e) => { setTickerInput(e.target.value); setValidateError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') addTicker() }}
            placeholder="Add ticker… AAPL, TSLA, NVDA"
            aria-label="Add ticker"
            className={`${inputCls} min-w-0 flex-1 font-mono text-[13px] sm:w-[260px] sm:flex-none`} disabled={validating} />
          <button onClick={addTicker} disabled={validating || !tickerInput.trim()} className={btnSecondary}>
            {validating ? 'Checking…' : 'Add'}
          </button>
        </div>
        {validateError && <p className="m-0 text-[13px] text-routine">{validateError}</p>}

        {portfolio.tickers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {portfolio.tickers.map((t) => (
              <span key={t} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border-strong bg-surface pl-2.5 pr-1.5 font-mono text-xs font-semibold text-text">
                <Link href={`/t/${t}`} className="text-text no-underline hover:text-white">{t}</Link>
                <button
                  onClick={() => save({ ...portfolio!, tickers: portfolio!.tickers.filter((x) => x !== t) })}
                  aria-label={`Remove ${t}`}
                  className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent p-0 text-sm leading-none text-muted hover:bg-track hover:text-white"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {portfolio.tickers.length === 0 && (
        <Empty>Add a ticker above to start tracking its price, insider trades and news.</Empty>
      )}

      {loading && <div className="pb-4 font-mono text-xs text-muted">Loading…</div>}

      {/* ══════════════════ TICKERS VIEW ══════════════════ */}
      {!loading && data.length > 0 && view === 'tickers' && (
        <div className={`${tableWrap} mb-10`}>
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className={theadRow}>
                <th className={`${th} w-10`}>#</th>
                <th className={th}>TICKER</th>
                <th className={thR}>SHARES</th>
                <th className={thR}>AVG COST</th>
                <th className={thR}>TOTAL COST</th>
                <th className={thR}>PRICE</th>
                <th className={thR}>CHANGE</th>
                <th className={thR}>VOLUME</th>
                <th className={thR}>MKT VALUE</th>
                <th className={thR}>GAIN $</th>
                <th className={thR}>GAIN %</th>
                <th className={thR}>DAY CHG $</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => {
                const pos = positions.get(row.ticker)
                return (
                  <tr key={row.ticker} className={trCls}>
                    <td className={`${td} font-mono text-muted`}>{i + 1}</td>
                    <td className={`${td} max-w-[300px] truncate`}>
                      <Link href={`/t/${row.ticker}`} className="font-mono font-semibold text-heading no-underline hover:text-white hover:underline">{row.ticker}</Link>
                      {row.name && <span className="pl-2.5 text-muted">{row.name}</span>}
                    </td>
                    <td className={tdR}>
                      {pos ? (
                        <span className="text-text">{pos.netShares.toLocaleString()}</span>
                      ) : (
                        <button onClick={() => openAdd(row.ticker)}
                          className="h-7 cursor-pointer rounded-sm border border-border-strong bg-transparent px-2.5 font-sans text-xs text-text-secondary hover:border-muted hover:text-white">
                          + Trade
                        </button>
                      )}
                    </td>
                    <td className={`${tdR} text-text-secondary`}>{pos ? `$${pos.avgCost.toFixed(2)}` : '—'}</td>
                    <td className={`${tdR} text-text-secondary`}>{pos ? fmtDollar(pos.costBasis) : '—'}</td>
                    <td className={`${tdR} text-heading`}>{row.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                    <td className={`${tdR} ${tone(row.changePercent)}`}>{row.changePercent != null ? fmtPct(row.changePercent, true) : '—'}</td>
                    <td className={`${tdR} text-muted`}>{fmtVolume(row.volume)}</td>
                    <td className={`${tdR} text-text`}>{pos?.marketValue != null ? fmtDollar(pos.marketValue) : '—'}</td>
                    <td className={`${tdR} ${tone(pos?.gainDollar)}`}>{pos?.gainDollar != null ? fmtDollar(pos.gainDollar, true) : '—'}</td>
                    <td className={`${tdR} ${tone(pos?.gainPct)}`}>{pos?.gainPct != null ? fmtPct(pos.gainPct, true) : '—'}</td>
                    <td className={`${tdR} ${tone(pos?.dayChangeDollar)}`}>{pos?.dayChangeDollar != null ? fmtDollar(pos.dayChangeDollar, true) : '—'}</td>
                  </tr>
                )
              })}

              {posArr.length > 0 && (
                <tr className="border-t border-border-strong bg-surface">
                  <td className={td} />
                  <td colSpan={4} className={`${td} font-mono text-[11px] tracking-[0.08em] text-muted`}>
                    TOTAL ({posArr.length} POSITION{posArr.length !== 1 ? 'S' : ''})
                  </td>
                  <td className={`${tdR} text-muted`}>—</td>
                  <td className={`${tdR} text-muted`}>—</td>
                  <td className={`${tdR} text-muted`}>—</td>
                  <td className={`${tdR} font-semibold text-heading`}>{fmtDollar(sumMkt)}</td>
                  <td className={`${tdR} font-semibold ${tone(sumGain)}`}>{fmtDollar(sumGain, true)}</td>
                  <td className={`${tdR} font-semibold ${tone(sumGain)}`}>{fmtPct(sumGainPc, true)}</td>
                  <td className={`${tdR} ${tone(sumDayChg)}`}>{fmtDollar(sumDayChg, true)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ══════════════════ TRADES VIEW ══════════════════ */}
      {view === 'trades' && (
        <div className="mb-10">
          {trades.length === 0 && !addForm && <Empty>No trades yet. Log a buy or sale to track your cost basis and gains.</Empty>}

          {(trades.length > 0 || addForm) && (
            <div className={tableWrap}>
              <table className="w-full min-w-[1200px] border-collapse text-sm">
                <thead>
                  <tr className={theadRow}>
                    <th className={`${th} w-10`}>#</th>
                    <th className={th}>TICKER</th>
                    <th className={thR}>PRICE</th>
                    <th className={thR}>CHANGE</th>
                    <th className={thR}>VOLUME</th>
                    <th className={th}>TYPE</th>
                    <th className={th}>DATE</th>
                    <th className={thR}>SHARES</th>
                    <th className={thR}>COST/SH</th>
                    <th className={thR}>TOTAL COST</th>
                    <th className={thR}>MKT VALUE</th>
                    <th className={thR}>GAIN $</th>
                    <th className={thR}>GAIN %</th>
                    <th className={thR}>DAY CHG $</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((tr, i) => {
                    const row   = tickerMap.get(tr.ticker)
                    const c     = calcTrade(tr, row)
                    const isBuy = tr.direction === 'buy'
                    return (
                      <tr key={tr.id} className={trCls}>
                        <td className={`${td} font-mono text-muted`}>{i + 1}</td>
                        <td className={`${td} max-w-[260px] truncate`}>
                          <Link href={`/t/${tr.ticker}`} className="font-mono font-semibold text-heading no-underline hover:text-white hover:underline">{tr.ticker}</Link>
                          {row?.name && <span className="pl-2.5 text-muted">{row.name}</span>}
                        </td>
                        <td className={`${tdR} text-heading`}>{row?.price != null ? `$${row.price.toFixed(2)}` : '—'}</td>
                        <td className={`${tdR} ${tone(row?.changePercent)}`}>{row?.changePercent != null ? fmtPct(row.changePercent, true) : '—'}</td>
                        <td className={`${tdR} text-muted`}>{fmtVolume(row?.volume ?? null)}</td>
                        <td className={td}>
                          <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: isBuy ? BUY_COLOR : SALE_COLOR }}>
                            <Dot color={isBuy ? BUY_COLOR : SALE_COLOR} />{isBuy ? 'Buy' : 'Sell'}
                          </span>
                        </td>
                        <td className={`${td} font-mono text-muted`}>{fmtDate(tr.trade_date)}</td>
                        <td className={`${tdR} text-text`}>{tr.shares.toLocaleString()}</td>
                        <td className={`${tdR} text-text`}>${tr.cost_per_share.toFixed(2)}</td>
                        <td className={`${tdR} text-text-secondary`}>{fmtDollar(c.cost)}</td>
                        <td className={`${tdR} ${isBuy ? 'text-text' : 'text-muted'}`}>{isBuy && c.mkt != null ? fmtDollar(c.mkt) : '—'}</td>
                        <td className={`${tdR} ${isBuy ? tone(c.gain) : 'text-muted'}`}>{isBuy && c.gain != null ? fmtDollar(c.gain, true) : '—'}</td>
                        <td className={`${tdR} ${isBuy ? tone(c.gainP) : 'text-muted'}`}>{isBuy && c.gainP != null ? fmtPct(c.gainP, true) : '—'}</td>
                        <td className={`${tdR} ${isBuy ? tone(c.dayChg) : 'text-muted'}`}>{isBuy && c.dayChg != null ? fmtDollar(c.dayChg, true) : '—'}</td>
                      </tr>
                    )
                  })}

                  {buyTrades.length > 0 && (
                    <tr className="border-t border-border-strong bg-surface">
                      <td className={td} />
                      <td colSpan={7} className={`${td} font-mono text-[11px] tracking-[0.08em] text-muted`}>
                        TOTAL ({buyTrades.length} BUY{buyTrades.length !== 1 ? 'S' : ''})
                      </td>
                      <td className={`${tdR} text-muted`}>—</td>
                      <td className={`${tdR} text-text-secondary`}>{fmtDollar(tSumCost)}</td>
                      <td className={`${tdR} font-semibold text-heading`}>{fmtDollar(tSumMkt)}</td>
                      <td className={`${tdR} font-semibold ${tone(tSumGain)}`}>{fmtDollar(tSumGain, true)}</td>
                      <td className={`${tdR} font-semibold ${tone(tSumGain)}`}>{fmtPct(tSumGainPc, true)}</td>
                      <td className={`${tdR} ${tone(tSumDayChg)}`}>{fmtDollar(tSumDayChg, true)}</td>
                    </tr>
                  )}

                  {!addForm ? (
                    <tr onClick={() => openAdd()} className="cursor-pointer border-t border-border hover:bg-surface-hover">
                      <td colSpan={14} className={`${td} text-[13px] text-text-secondary`}>+ Add trade</td>
                    </tr>
                  ) : (
                    <tr className="border-t border-border bg-surface">
                      <td colSpan={14} className="p-0">
                        <div className="flex flex-wrap items-end gap-3 px-4 py-4">
                          <label>
                            <span className={formLabel}>TICKER</span>
                            <input value={addForm.ticker} onChange={(e) => setAddForm((f) => f ? { ...f, ticker: e.target.value.toUpperCase() } : f)} placeholder="AAPL" className={`${inputCls} w-[90px] bg-background font-mono text-[13px]`} autoFocus />
                          </label>
                          <label>
                            <span className={formLabel}>DATE</span>
                            <input type="date" value={addForm.date} onChange={(e) => setAddForm((f) => f ? { ...f, date: e.target.value } : f)} className={`${inputCls} w-[150px] bg-background font-mono text-[13px] [color-scheme:dark]`} />
                          </label>
                          <label>
                            <span className={formLabel}>TYPE</span>
                            <select value={addForm.direction} onChange={(e) => setAddForm((f) => f ? { ...f, direction: e.target.value as 'buy' | 'sell' } : f)} className={`${inputCls} w-[90px] cursor-pointer bg-background`}>
                              <option value="buy">Buy</option>
                              <option value="sell">Sell</option>
                            </select>
                          </label>
                          <label>
                            <span className={formLabel}>SHARES</span>
                            <input type="number" min="0" step="any" value={addForm.shares} onChange={(e) => setAddForm((f) => f ? { ...f, shares: e.target.value } : f)} placeholder="100" className={`${inputCls} w-[100px] bg-background font-mono text-[13px]`} />
                          </label>
                          <div>
                            <span className={formLabel}>COST / SHARE</span>
                            <div className="flex gap-1.5">
                              <input type="number" min="0" step="any" value={addForm.cost} onChange={(e) => setAddForm((f) => f ? { ...f, cost: e.target.value } : f)} placeholder="0.00" aria-label="Cost per share" className={`${inputCls} w-[110px] bg-background font-mono text-[13px]`} />
                              <button onClick={fetchTodayPrice} disabled={fetchingPrice || !addForm.ticker.trim()} title="Use today's price" className={`${btnSecondary} px-3 text-xs`}>
                                {fetchingPrice ? '…' : "Today's"}
                              </button>
                            </div>
                          </div>
                          {addForm.shares && addForm.cost && (
                            <div className="pb-2.5">
                              <span className={formLabel}>TOTAL</span>
                              <span className="font-mono text-sm text-text-secondary">{fmtDollar(parseFloat(addForm.shares) * parseFloat(addForm.cost))}</span>
                            </div>
                          )}
                          <div className="flex gap-2">
                            <button onClick={saveTrade} disabled={savingTrade || !canSaveTrade} className={btnPrimary}>
                              {savingTrade ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={() => setAddForm(null)} className={btnSecondary}>Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {trades.length === 0 && !addForm && (
            <div className="mt-3">
              <button onClick={() => openAdd()} className={btnSecondary}>+ Add trade</button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════ FEED (news + insider) ══════════════════ */}
      {!loading && portfolio.tickers.length > 0 && (
        <section className="flex flex-col gap-5 pt-2">
          <div className="flex flex-col gap-2">
            <div className="label-mono">ACTIVITY</div>
            <h2 className={h2Cls}>What&apos;s happening in your tickers</h2>
          </div>

          <div role="tablist" className="flex gap-1 border-b border-border">
            {(['news', 'insider'] as const).map((sec) => {
              const active = activeSection === sec
              return (
                <button key={sec}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setActiveSection(sec); if (sec === 'insider') setDirFilter('all') }}
                  className={`-mb-px h-11 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-4 font-sans text-sm font-medium ${
                    active ? 'border-heading text-heading' : 'border-transparent text-muted hover:text-text-secondary'
                  }`}
                >
                  {sec === 'news' ? 'News' : 'Insider trades'}
                </button>
              )
            })}
          </div>

          {activeSection === 'news' && (
            news.length === 0
              ? <Empty>No recent news for these tickers.</Empty>
              : (
                <ul className="m-0 list-none p-0">
                  {news.map((item, i) => (
                    <li key={i} className="flex flex-col gap-1 border-b border-row-border py-3.5 sm:flex-row sm:items-baseline sm:gap-4">
                      <Link href={`/t/${item.ticker}`} className="w-14 shrink-0 font-mono text-[13px] font-semibold text-heading no-underline hover:text-white">{item.ticker}</Link>
                      {item.url
                        ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-[15px] leading-snug text-text no-underline hover:text-white hover:underline">{decodeEntities(item.title)}</a>
                        : <span className="min-w-0 flex-1 text-[15px] leading-snug text-text">{decodeEntities(item.title)}</span>}
                      <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted">{[item.source, timeAgo(item.publishedAt)].filter(Boolean).join(' · ')}</span>
                    </li>
                  ))}
                </ul>
              )
          )}

          {activeSection === 'insider' && (
            <div className="flex flex-col gap-4">
              <Segmented
                label="Trade direction"
                value={dirFilter}
                onChange={setDirFilter}
                options={[{ value: 'all', label: 'All' }, { value: 'buys', label: 'Buys' }, { value: 'sells', label: 'Sales' }]}
              />
              {loadingFeed && <div className="font-mono text-xs text-muted">Loading…</div>}
              {!loadingFeed && insiderTrades.length === 0 && <Empty>No insider trades found for these tickers.</Empty>}
              {!loadingFeed && insiderTrades.length > 0 && (
                <div className={tableWrap}>
                  <table className="w-full min-w-[960px] border-collapse text-sm">
                    <thead>
                      <tr className={theadRow}>
                        <th className={th}>TICKER</th>
                        <th className={th}>INSIDER</th>
                        <th className={th}>TYPE</th>
                        <th className={th}>CLASS</th>
                        <th className={thR}>PRICE</th>
                        <th className={thR}>SHARES</th>
                        <th className={thR}>VALUE</th>
                        <th className={th}>SCORE</th>
                        <th className={thR}>DATE</th>
                      </tr>
                    </thead>
                    <tbody>
                      {insiderTrades.map((row, i) => {
                        const code  = row.transaction_code?.toUpperCase()
                        const isBuy = code === 'P'
                        const isSale = code === 'S'
                        const cls   = row.classification ? CLS[row.classification] : null
                        const score = row.conviction_score ?? row.sentra_score ?? null
                        const typeColor = isBuy ? BUY_COLOR : isSale ? SALE_COLOR : 'var(--color-muted)'
                        return (
                          <tr key={row.id ?? i} className={trCls}>
                            <td className={td}>
                              <Link href={`/t/${row.ticker}`} className="font-mono font-semibold text-heading no-underline hover:text-white hover:underline">{row.ticker}</Link>
                            </td>
                            <td className={`${td} max-w-[320px] truncate text-text-secondary`}>
                              {formatInsiderName(row.insider_name)}
                              <span className="text-muted"> · {displayRole(row)}</span>
                            </td>
                            <td className={td}>
                              <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: typeColor }}>
                                <Dot color={typeColor} />{isBuy ? 'Buy' : isSale ? 'Sale' : (row.transaction_code ?? '—')}
                              </span>
                            </td>
                            <td className={td}>
                              {cls ? (
                                <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: cls.color }}>
                                  <Dot color={cls.color} />{cls.label}
                                </span>
                              ) : <span className="text-xs text-muted">—</span>}
                            </td>
                            <td className={`${tdR} text-text-secondary`}>{row.price_per_share != null ? `$${Number(row.price_per_share).toFixed(2)}` : '—'}</td>
                            <td className={`${tdR} text-text-secondary`}>{row.shares != null ? Number(row.shares).toLocaleString() : '—'}</td>
                            <td className={`${tdR} text-text`}>{fmtCurrency(row.total_value)}</td>
                            <td className={td}>
                              {!isBuy ? <span className="font-mono text-xs text-muted">n/a</span>
                                : score != null ? <span className="font-mono font-semibold text-heading">{score}</span>
                                : <span className="font-mono text-muted">—</span>}
                            </td>
                            <td className={`${tdR} text-muted`}>{fmtDate(row.transaction_date)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="m-0 text-[13px] text-muted">
                Score is a 0–100 percentile rank within each class; only open-market purchases are scored.{' '}
                <Link href="/about" className="text-text-secondary underline underline-offset-2 hover:text-white">How scoring works</Link>
              </p>
            </div>
          )}
        </section>
      )}
    </PageShell>
  )
}
