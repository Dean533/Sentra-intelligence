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
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabase } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

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
  classification: string | null; sentra_score: number | null
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
  const pre = n < 0 ? '-' : sign ? '+' : ''
  if (abs >= 1e6) return `${pre}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${pre}$${(abs / 1e3).toFixed(1)}K`
  return `${pre}$${abs.toFixed(2)}`
}

function fmtPct(n: number | null, sign = false) {
  if (n == null) return '—'
  return `${n < 0 ? '' : sign ? '+' : ''}${n.toFixed(2)}%`
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

function clr(n: number | null, neutral = '#7b8498') {
  if (n == null) return neutral
  return n >= 0 ? '#3fb950' : '#f85149'
}

function scoreColor(s: number | null) {
  if (s == null) return '#4a5568'
  if (s >= 70) return '#3fb950'
  if (s >= 50) return '#d29922'
  return '#7b8498'
}

function txColor(code: string | null) {
  if (!code) return '#7b8498'
  if (code.toUpperCase() === 'P') return '#3fb950'
  if (code.toUpperCase() === 'S') return '#f85149'
  return '#d29922'
}
function txLabel(code: string | null) {
  if (!code) return '—'
  if (code.toUpperCase() === 'P') return 'Purchase'
  if (code.toUpperCase() === 'S') return 'Sale'
  return code
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

const CLS_BADGE: Record<string, { color: string; bg: string; border: string }> = {
  OPPORTUNISTIC:  { color: '#3fb950', bg: 'rgba(63,185,80,0.08)',   border: 'rgba(63,185,80,0.2)'  },
  ROUTINE:        { color: '#d29922', bg: 'rgba(210,153,34,0.08)',  border: 'rgba(210,153,34,0.2)' },
  UNCLASSIFIABLE: { color: '#7b8498', bg: 'rgba(123,132,152,0.08)', border: 'rgba(123,132,152,0.2)' },
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '9px 10px', textAlign: 'left', whiteSpace: 'nowrap',
  fontSize: '10px', fontWeight: 600, letterSpacing: '0.7px', color: '#4a5568',
  textTransform: 'uppercase', borderBottom: '1px solid #131820', background: '#060910',
  position: 'sticky', top: 0,
}
const TH_R: React.CSSProperties = { ...TH, textAlign: 'right' }
const TD: React.CSSProperties  = { padding: '10px 10px', borderBottom: '1px solid #0c1016', verticalAlign: 'middle', whiteSpace: 'nowrap' }
const TD_R: React.CSSProperties = { ...TD, textAlign: 'right' }

const inputCss: React.CSSProperties = {
  background: '#0a0d12', border: '1px solid #1e2530', borderRadius: '7px',
  padding: '8px 11px', color: '#e6edf3', fontSize: '13px', outline: 'none',
  fontFamily: 'inherit', boxSizing: 'border-box',
}
const btnPri: React.CSSProperties = {
  background: '#1a2d4a', border: '1px solid #2a4a70', borderRadius: '7px',
  padding: '8px 20px', color: '#58a6ff', fontSize: '13px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
}
const btnSec: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1e2530', borderRadius: '7px',
  padding: '7px 14px', color: '#7b8498', fontSize: '13px',
  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
}

// ─── Creation screen ──────────────────────────────────────────────────────────

function CreateScreen({ onCreate }: { onCreate: (p: Portfolio) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  function go() { if (name.trim()) onCreate({ name: name.trim(), description: desc.trim(), tickers: [] }) }
  return (
    <div style={{ minHeight: '100vh', background: '#0a0d12', color: '#e6edf3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: '400px', padding: '0 24px' }}>
        <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px', letterSpacing: '-0.4px' }}>Create Your Portfolio</h1>
        <p style={{ fontSize: '13px', color: '#4a5568', marginBottom: '28px' }}>Track insider signals for the stocks you own.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} placeholder="Portfolio name" autoFocus style={{ ...inputCss, width: '100%' }} />
          <input value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') go() }} placeholder="Description (optional)" style={{ ...inputCss, width: '100%' }} />
        </div>
        <button onClick={go} disabled={!name.trim()} style={{ ...btnPri, width: '100%', opacity: name.trim() ? 1 : 0.4 }}>
          Create Portfolio
        </button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter()
  const [user,      setUser]      = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
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
  useEffect(() => {
    getSupabase().auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return }
      setUser(user); setAuthReady(true)
    })
  }, [router])

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
      if (!d.tickers?.[0]?.name) { setValidateError(`${t} not found in S&P 500`); return }
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
  if (!authReady || dbLoading) return <div style={{ minHeight: '100vh', background: '#0a0d12', paddingTop: '60px' }} />
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

  // ── Row styling ───────────────────────────────────────────────────────────────
  function rowBg(i: number, hover?: boolean) {
    return hover ? 'rgba(88,166,255,0.035)' : i % 2 === 0 ? '#080b10' : '#06090d'
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0a0d12', color: '#e6edf3', fontFamily: 'inherit' }}>
      <div className="rsp-pad" style={{ maxWidth: '1400px', margin: '0 auto', padding: '80px 28px 100px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {editing ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }} autoFocus style={{ ...inputCss, width: '220px', fontWeight: 700 }} />
              <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }} placeholder="Description" style={{ ...inputCss, width: '220px' }} />
              <button onClick={saveEdit} style={btnPri}>Save</button>
              <button onClick={() => setEditing(false)} style={btnSec}>Cancel</button>
            </div>
          ) : (
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0, letterSpacing: '-0.3px' }}>{portfolio.name}</h1>
              {portfolio.description && <p style={{ fontSize: '12px', color: '#4a5568', margin: '2px 0 0' }}>{portfolio.description}</p>}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {/* View toggle */}
            <div className="portfolio-view-toggle" style={{ display: 'flex', background: '#060910', border: '1px solid #1a1f2a', borderRadius: '8px', padding: '3px', gap: '2px' }}>
              {(['tickers', 'trades'] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} style={{
                  padding: '5px 16px', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
                  fontWeight: view === v ? 600 : 400,
                  color: view === v ? '#58a6ff' : '#4a5568',
                  background: view === v ? '#1a2d4a' : 'transparent',
                  border: `1px solid ${view === v ? '#2a4a70' : 'transparent'}`,
                  transition: 'all 0.12s',
                }}>
                  {v === 'tickers' ? 'Tickers' : 'Trades'}
                </button>
              ))}
            </div>
            {!editing && <button onClick={startEdit} style={btnSec}>Edit</button>}
          </div>
        </div>

        {/* ── Add ticker ── */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref={tickerRef} value={tickerInput}
              onChange={(e) => { setTickerInput(e.target.value); setValidateError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') addTicker() }}
              placeholder="Add ticker… AAPL, TSLA, NVDA"
              style={{ ...inputCss, width: '240px' }} disabled={validating} />
            <button onClick={addTicker} disabled={validating || !tickerInput.trim()}
              style={{ ...btnSec, opacity: validating || !tickerInput.trim() ? 0.4 : 1 }}>
              {validating ? 'Checking…' : 'Add'}
            </button>
          </div>
          {validateError && <p style={{ fontSize: '12px', color: '#f85149', margin: '4px 0 0' }}>{validateError}</p>}
        </div>

        {/* Chips */}
        {portfolio.tickers.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '24px' }}>
            {portfolio.tickers.map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#0a0d12', border: '1px solid #1a2333', borderRadius: '5px', padding: '3px 8px', fontSize: '11px', fontWeight: 700, color: '#c9d1d9' }}>
                {t}
                <button onClick={() => save({ ...portfolio!, tickers: portfolio!.tickers.filter((x) => x !== t) })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a4a60', fontSize: '13px', lineHeight: 1, padding: 0 }}>×</button>
              </div>
            ))}
          </div>
        )}

        {portfolio.tickers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 0', color: '#3a4a60', fontSize: '13px' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>☆</div>Add tickers above to start tracking
          </div>
        )}

        {loading && <div style={{ color: '#3a4a60', fontSize: '12px', marginBottom: '16px' }}>Loading…</div>}

        {/* ══════════════════════════════════════════════════════════════════════
            TICKERS VIEW
        ══════════════════════════════════════════════════════════════════════ */}
        {!loading && data.length > 0 && view === 'tickers' && (
          <div style={{ overflowX: 'auto', border: '1px solid #131820', borderRadius: '10px', marginBottom: '32px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr>
                  <th style={{ ...TH, width: '32px', textAlign: 'center' }}>No.</th>
                  <th style={TH}>Ticker</th>
                  <th style={TH}>Company</th>
                  <th style={TH_R}>Shares</th>
                  <th style={TH_R}>Avg Cost</th>
                  <th style={TH_R}>Total Cost</th>
                  <th style={TH_R}>Price</th>
                  <th style={TH_R}>Change %</th>
                  <th style={TH_R}>Volume</th>
                  <th style={TH_R}>Mkt Value</th>
                  <th style={TH_R}>Gain $</th>
                  <th style={TH_R}>Gain %</th>
                  <th style={TH_R}>Day Chg $</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => {
                  const pos = positions.get(row.ticker)
                  return (
                    <tr key={row.ticker}
                      style={{ background: rowBg(i) }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = rowBg(i, true))}
                      onMouseLeave={(e) => (e.currentTarget.style.background = rowBg(i))}
                    >
                      <td style={{ ...TD, textAlign: 'center', color: '#3a4a60', fontSize: '11px' }}>{i + 1}</td>
                      <td style={TD}>
                        <Link href={`/t/${row.ticker}`} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'none', fontFamily: 'monospace', letterSpacing: '0.3px' }}>{row.ticker}</Link>
                      </td>
                      <td style={{ ...TD, color: '#8b949e', maxWidth: '180px' }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name ?? '—'}</span>
                      </td>
                      {/* Shares — show + Trade if no position */}
                      <td style={TD_R}>
                        {pos ? (
                          <span style={{ color: '#c9d1d9', fontVariantNumeric: 'tabular-nums' }}>{pos.netShares.toLocaleString()}</span>
                        ) : (
                          <button onClick={() => openAdd(row.ticker)}
                            style={{ background: 'rgba(88,166,255,0.06)', border: '1px solid #1e3550', borderRadius: '5px', padding: '2px 9px', color: '#4a7ab5', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                            + Trade
                          </button>
                        )}
                      </td>
                      <td style={{ ...TD_R, color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                        {pos ? `$${pos.avgCost.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ ...TD_R, color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                        {pos ? fmtDollar(pos.costBasis) : '—'}
                      </td>
                      <td style={{ ...TD_R, color: '#e6edf3', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                      </td>
                      <td style={{ ...TD_R, color: clr(row.changePercent), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {row.changePercent != null ? fmtPct(row.changePercent, true) : '—'}
                      </td>
                      <td style={{ ...TD_R, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{fmtVolume(row.volume)}</td>
                      <td style={{ ...TD_R, color: '#c9d1d9', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {pos?.marketValue != null ? fmtDollar(pos.marketValue) : '—'}
                      </td>
                      <td style={{ ...TD_R, color: clr(pos?.gainDollar ?? null), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {pos?.gainDollar != null ? fmtDollar(pos.gainDollar, true) : '—'}
                      </td>
                      <td style={{ ...TD_R, color: clr(pos?.gainPct ?? null), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {pos?.gainPct != null ? fmtPct(pos.gainPct, true) : '—'}
                      </td>
                      <td style={{ ...TD_R, color: clr(pos?.dayChangeDollar ?? null), fontVariantNumeric: 'tabular-nums' }}>
                        {pos?.dayChangeDollar != null ? fmtDollar(pos.dayChangeDollar, true) : '—'}
                      </td>
                    </tr>
                  )
                })}

                {/* Summary row */}
                {posArr.length > 0 && (
                  <tr style={{ background: '#0a0e15', borderTop: '1px solid #1a2333' }}>
                    <td style={{ ...TD, textAlign: 'center', color: '#3a4a60' }}></td>
                    <td colSpan={5} style={{ ...TD, color: '#4a5568', fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                      Total ({posArr.length} position{posArr.length !== 1 ? 's' : ''})
                    </td>
                    <td style={{ ...TD_R, color: '#3a4a60' }}>—</td>
                    <td style={{ ...TD_R, color: '#3a4a60' }}>—</td>
                    <td style={{ ...TD_R, color: '#3a4a60' }}>—</td>
                    <td style={{ ...TD_R, color: '#e6edf3', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(sumMkt)}</td>
                    <td style={{ ...TD_R, color: clr(sumGain), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(sumGain, true)}</td>
                    <td style={{ ...TD_R, color: clr(sumGain), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(sumGainPc, true)}</td>
                    <td style={{ ...TD_R, color: clr(sumDayChg), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(sumDayChg, true)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════════
            TRADES VIEW
        ══════════════════════════════════════════════════════════════════════ */}
        {view === 'trades' && (
          <div style={{ marginBottom: '32px' }}>
            {trades.length === 0 && !addForm && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#3a4a60', fontSize: '13px' }}>
                <div style={{ fontSize: '22px', marginBottom: '8px' }}>📊</div>No trades yet
              </div>
            )}

            {(trades.length > 0 || addForm) && (
              <div style={{ overflowX: 'auto', border: '1px solid #131820', borderRadius: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr>
                      <th style={{ ...TH, width: '32px', textAlign: 'center' }}>No.</th>
                      <th style={TH}>Ticker</th>
                      <th style={TH}>Company</th>
                      <th style={TH_R}>Price</th>
                      <th style={TH_R}>Change %</th>
                      <th style={TH_R}>Volume</th>
                      <th style={TH}>Type</th>
                      <th style={TH}>Date</th>
                      <th style={TH_R}>Shares</th>
                      <th style={TH_R}>Cost/Share</th>
                      <th style={TH_R}>Total Cost</th>
                      <th style={TH_R}>Mkt Value</th>
                      <th style={TH_R}>Gain $</th>
                      <th style={TH_R}>Gain %</th>
                      <th style={TH_R}>Day Chg $</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((tr, i) => {
                      const row  = tickerMap.get(tr.ticker)
                      const c    = calcTrade(tr, row)
                      const isBuy = tr.direction === 'buy'
                      return (
                        <tr key={tr.id}
                          style={{ background: rowBg(i) }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = rowBg(i, true))}
                          onMouseLeave={(e) => (e.currentTarget.style.background = rowBg(i))}
                        >
                          <td style={{ ...TD, textAlign: 'center', color: '#3a4a60', fontSize: '11px' }}>{i + 1}</td>
                          <td style={TD}>
                            <Link href={`/t/${tr.ticker}`} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'none', fontFamily: 'monospace', letterSpacing: '0.3px' }}>{tr.ticker}</Link>
                          </td>
                          <td style={{ ...TD, color: '#8b949e', maxWidth: '160px' }}>
                            <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row?.name ?? '—'}</span>
                          </td>
                          <td style={{ ...TD_R, color: '#e6edf3', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {row?.price != null ? `$${row.price.toFixed(2)}` : '—'}
                          </td>
                          <td style={{ ...TD_R, color: clr(row?.changePercent ?? null), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {row?.changePercent != null ? fmtPct(row.changePercent, true) : '—'}
                          </td>
                          <td style={{ ...TD_R, color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{fmtVolume(row?.volume ?? null)}</td>
                          <td style={TD}>
                            <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 7px', borderRadius: '4px', color: isBuy ? '#3fb950' : '#f85149', background: isBuy ? 'rgba(63,185,80,0.1)' : 'rgba(248,81,73,0.1)', border: `1px solid ${isBuy ? 'rgba(63,185,80,0.25)' : 'rgba(248,81,73,0.25)'}` }}>
                              {isBuy ? 'Buy' : 'Sell'}
                            </span>
                          </td>
                          <td style={{ ...TD, color: '#6b7280' }}>{fmtDate(tr.trade_date)}</td>
                          <td style={{ ...TD_R, color: '#c9d1d9', fontVariantNumeric: 'tabular-nums' }}>{tr.shares.toLocaleString()}</td>
                          <td style={{ ...TD_R, color: '#c9d1d9', fontVariantNumeric: 'tabular-nums' }}>${tr.cost_per_share.toFixed(2)}</td>
                          <td style={{ ...TD_R, color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(c.cost)}</td>
                          <td style={{ ...TD_R, color: isBuy ? '#c9d1d9' : '#3a4a60', fontWeight: isBuy ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
                            {isBuy && c.mkt != null ? fmtDollar(c.mkt) : '—'}
                          </td>
                          <td style={{ ...TD_R, color: isBuy ? clr(c.gain) : '#3a4a60', fontWeight: isBuy ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
                            {isBuy && c.gain != null ? fmtDollar(c.gain, true) : '—'}
                          </td>
                          <td style={{ ...TD_R, color: isBuy ? clr(c.gainP) : '#3a4a60', fontWeight: isBuy ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}>
                            {isBuy && c.gainP != null ? fmtPct(c.gainP, true) : '—'}
                          </td>
                          <td style={{ ...TD_R, color: isBuy ? clr(c.dayChg) : '#3a4a60', fontVariantNumeric: 'tabular-nums' }}>
                            {isBuy && c.dayChg != null ? fmtDollar(c.dayChg, true) : '—'}
                          </td>
                        </tr>
                      )
                    })}

                    {/* Summary row */}
                    {buyTrades.length > 0 && (
                      <tr style={{ background: '#0a0e15', borderTop: '1px solid #1a2333' }}>
                        <td style={{ ...TD, textAlign: 'center' }}></td>
                        <td colSpan={8} style={{ ...TD, color: '#4a5568', fontSize: '11px', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                          Total ({buyTrades.length} buy{buyTrades.length !== 1 ? 's' : ''})
                        </td>
                        <td style={{ ...TD_R, color: '#3a4a60' }}>—</td>
                        <td style={{ ...TD_R, color: '#8b949e', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(tSumCost)}</td>
                        <td style={{ ...TD_R, color: '#e6edf3', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(tSumMkt)}</td>
                        <td style={{ ...TD_R, color: clr(tSumGain), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(tSumGain, true)}</td>
                        <td style={{ ...TD_R, color: clr(tSumGain), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmtPct(tSumGainPc, true)}</td>
                        <td style={{ ...TD_R, color: clr(tSumDayChg), fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtDollar(tSumDayChg, true)}</td>
                      </tr>
                    )}

                    {/* + Trade row / inline form */}
                    {!addForm ? (
                      <tr
                        onClick={() => openAdd()}
                        style={{ background: '#060910', cursor: 'pointer' }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(88,166,255,0.03)')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#060910')}
                      >
                        <td colSpan={15} style={{ ...TD, borderTop: '1px solid #1a2333', color: '#3a4a60', fontSize: '12px', fontWeight: 600 }}>
                          <span style={{ marginLeft: '4px' }}>+ Add Trade</span>
                        </td>
                      </tr>
                    ) : (
                      <tr style={{ background: '#060910' }}>
                        <td colSpan={15} style={{ padding: 0, borderTop: '1px solid #1a2d4a' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end', padding: '14px 16px', borderBottom: '1px solid #0c1016' }}>

                            {/* Ticker */}
                            <div>
                              <div style={{ fontSize: '10px', color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Ticker</div>
                              <input value={addForm.ticker} onChange={(e) => setAddForm((f) => f ? { ...f, ticker: e.target.value.toUpperCase() } : f)} placeholder="AAPL" style={{ ...inputCss, width: '80px' }} autoFocus />
                            </div>

                            {/* Date */}
                            <div>
                              <div style={{ fontSize: '10px', color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Date</div>
                              <input type="date" value={addForm.date} onChange={(e) => setAddForm((f) => f ? { ...f, date: e.target.value } : f)} style={{ ...inputCss, width: '140px', colorScheme: 'dark' }} />
                            </div>

                            {/* Type */}
                            <div>
                              <div style={{ fontSize: '10px', color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Type</div>
                              <select value={addForm.direction} onChange={(e) => setAddForm((f) => f ? { ...f, direction: e.target.value as 'buy' | 'sell' } : f)} style={{ ...inputCss, width: '80px', cursor: 'pointer' }}>
                                <option value="buy">Buy</option>
                                <option value="sell">Sell</option>
                              </select>
                            </div>

                            {/* Shares */}
                            <div>
                              <div style={{ fontSize: '10px', color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shares</div>
                              <input type="number" min="0" step="any" value={addForm.shares} onChange={(e) => setAddForm((f) => f ? { ...f, shares: e.target.value } : f)} placeholder="100" style={{ ...inputCss, width: '90px' }} />
                            </div>

                            {/* Cost + Today button */}
                            <div>
                              <div style={{ fontSize: '10px', color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cost / Share</div>
                              <div style={{ display: 'flex', gap: '5px' }}>
                                <input type="number" min="0" step="any" value={addForm.cost} onChange={(e) => setAddForm((f) => f ? { ...f, cost: e.target.value } : f)} placeholder="0.00" style={{ ...inputCss, width: '100px' }} />
                                <button onClick={fetchTodayPrice} disabled={fetchingPrice || !addForm.ticker.trim()} title="Use today's price" style={{ ...btnSec, padding: '7px 10px', fontSize: '11px', opacity: !addForm.ticker.trim() ? 0.4 : 1 }}>
                                  {fetchingPrice ? '…' : "Today's"}
                                </button>
                              </div>
                            </div>

                            {/* Total preview */}
                            {addForm.shares && addForm.cost && (
                              <div style={{ paddingBottom: '1px' }}>
                                <div style={{ fontSize: '10px', color: '#3a4a60', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total</div>
                                <span style={{ fontSize: '13px', color: '#8b949e', fontVariantNumeric: 'tabular-nums' }}>
                                  {fmtDollar(parseFloat(addForm.shares) * parseFloat(addForm.cost))}
                                </span>
                              </div>
                            )}

                            {/* Actions */}
                            <div style={{ display: 'flex', gap: '6px', paddingBottom: '1px' }}>
                              <button onClick={saveTrade} disabled={savingTrade || !addForm.ticker.trim() || !addForm.shares || !addForm.cost}
                                style={{ ...btnPri, opacity: savingTrade || !addForm.ticker.trim() || !addForm.shares || !addForm.cost ? 0.4 : 1, cursor: !addForm.ticker.trim() || !addForm.shares || !addForm.cost ? 'not-allowed' : 'pointer' }}>
                                {savingTrade ? 'Saving…' : 'Save'}
                              </button>
                              <button onClick={() => setAddForm(null)} style={btnSec}>Cancel</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Empty + open form immediately */}
            {trades.length === 0 && !addForm && (
              <div style={{ marginTop: '12px' }}>
                <button onClick={() => openAdd()} style={{ ...btnSec, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '15px' }}>+</span> Add Trade
                </button>
              </div>
            )}
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            FEED (news + insider — always visible)
        ════════════════════════════════════════════════════════════════════ */}
        {!loading && portfolio.tickers.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #131820', marginBottom: '16px' }}>
              {(['news', 'insider'] as const).map((sec) => {
                const active = activeSection === sec
                return (
                  <button key={sec}
                    onClick={() => { setActiveSection(sec); if (sec === 'insider') setDirFilter('all') }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '9px 4px', marginRight: '24px', fontSize: '13px', fontWeight: active ? 600 : 400, color: active ? '#e6edf3' : '#4a5568', borderBottom: `2px solid ${active ? '#58a6ff' : 'transparent'}`, transition: 'color 0.15s', fontFamily: 'inherit' }}>
                    {sec === 'news' ? 'Recent News' : 'Recent Insider Trades'}
                  </button>
                )
              })}
            </div>

            {activeSection === 'news' && (
              news.length === 0
                ? <p style={{ fontSize: '12px', color: '#3a4a60' }}>No recent news.</p>
                : <div>{news.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '10px', padding: '9px 0', borderBottom: '1px solid #0c1016' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#58a6ff', background: '#0d1f30', border: '1px solid #1a3a50', borderRadius: '3px', padding: '2px 5px', flexShrink: 0 }}>{item.ticker}</span>
                      {item.url
                        ? <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: '#c9d1d9', textDecoration: 'none', fontSize: '12px', flex: 1, lineHeight: 1.4 }}>{item.title}</a>
                        : <span style={{ color: '#c9d1d9', fontSize: '12px', flex: 1 }}>{item.title}</span>}
                      <span style={{ fontSize: '11px', color: '#3a4a60', whiteSpace: 'nowrap', flexShrink: 0 }}>{[item.source, timeAgo(item.publishedAt)].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}</div>
            )}

            {activeSection === 'insider' && (
              <div>
                <div style={{ display: 'flex', gap: '5px', marginBottom: '12px' }}>
                  {(['all', 'buys', 'sells'] as const).map((f) => {
                    const active = dirFilter === f
                    return (
                      <button key={f} onClick={() => setDirFilter(f)} style={{ padding: '4px 12px', borderRadius: '5px', border: `1px solid ${active ? '#2a4a70' : '#1a1f2a'}`, background: active ? '#1a2d4a' : 'transparent', color: active ? '#58a6ff' : '#4a5568', fontSize: '11px', fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {f === 'all' ? 'All' : f === 'buys' ? 'Buys' : 'Sells'}
                      </button>
                    )
                  })}
                </div>
                {loadingFeed && <div style={{ color: '#3a4a60', fontSize: '12px' }}>Loading…</div>}
                {!loadingFeed && insiderTrades.length === 0 && <p style={{ fontSize: '12px', color: '#3a4a60' }}>No insider trades found.</p>}
                {!loadingFeed && insiderTrades.length > 0 && (
                  <div style={{ overflowX: 'auto', border: '1px solid #131820', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr>{['Ticker', 'Insider', 'Role', 'Date', 'Type', 'Price', 'Shares', 'Value', 'Score'].map((h) => <th key={h} style={TH}>{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {insiderTrades.map((row, i) => {
                          const isBuy = row.transaction_code?.toUpperCase() === 'P'
                          const cls   = row.classification ?? 'UNCLASSIFIABLE'
                          const badge = CLS_BADGE[cls] ?? CLS_BADGE.UNCLASSIFIABLE
                          const color = txColor(row.transaction_code)
                          return (
                            <tr key={row.id ?? i} style={{ background: rowBg(i) }}>
                              <td style={TD}><Link href={`/t/${row.ticker}`} style={{ display: 'inline-block', padding: '2px 6px', borderRadius: '4px', background: '#0d1f30', border: '1px solid #1a3a50', color: '#9ecbff', fontSize: '11px', fontWeight: 700, textDecoration: 'none', fontFamily: 'monospace' }}>{row.ticker}</Link></td>
                              <td style={{ ...TD, maxWidth: '160px' }}>
                                <div style={{ color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.insider_name ?? '—'}</div>
                                <span style={{ display: 'inline-block', marginTop: '2px', fontSize: '10px', fontWeight: 600, padding: '1px 5px', borderRadius: '3px', color: badge.color, background: badge.bg, border: `1px solid ${badge.border}` }}>{cls}</span>
                              </td>
                              <td style={{ ...TD, color: '#6b7280', maxWidth: '130px' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.officer_title ?? row.role ?? '—'}</div></td>
                              <td style={{ ...TD, color: '#6b7280' }}>{fmtDate(row.transaction_date)}</td>
                              <td style={TD}><span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', color, background: `${color}18`, border: `1px solid ${color}35` }}>{txLabel(row.transaction_code)}</span></td>
                              <td style={{ ...TD, color: '#c9d1d9', fontVariantNumeric: 'tabular-nums' }}>{row.price_per_share != null ? `$${Number(row.price_per_share).toFixed(2)}` : '—'}</td>
                              <td style={{ ...TD, color: '#c9d1d9', fontVariantNumeric: 'tabular-nums' }}>{row.shares != null ? Number(row.shares).toLocaleString() : '—'}</td>
                              <td style={{ ...TD, color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(row.total_value)}</td>
                              <td style={{ ...TD, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: !isBuy ? '#3a4a60' : scoreColor(row.sentra_score) }}>{!isBuy ? <span style={{ color: '#3a4a60' }}>N/A</span> : row.sentra_score ?? <span style={{ color: '#3a4a60' }}>—</span>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
