'use client'

// Supabase watchlists table (run once in Supabase SQL editor):
//
//   CREATE TABLE watchlists (
//     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
//     name        TEXT NOT NULL,
//     description TEXT DEFAULT '',
//     tickers     TEXT[] DEFAULT '{}',
//     created_at  TIMESTAMPTZ DEFAULT NOW(),
//     updated_at  TIMESTAMPTZ DEFAULT NOW()
//   );
//   ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "own watchlist" ON watchlists FOR ALL
//     USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase-browser'
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVolume(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return n.toLocaleString()
}

function fmtMarketCap(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toLocaleString()}`
}

function fmtCurrency(val: number | null): string {
  if (val == null) return '—'
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`
  if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(0)}K`
  return `$${val.toLocaleString()}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return `${Math.floor(diff / 60_000)}m ago`
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function scoreColor(s: number | null): string {
  if (s == null) return '#4a5568'
  if (s >= 70) return '#3fb950'
  if (s >= 50) return '#d29922'
  return '#7b8498'
}

function txColor(code: string | null): string {
  if (!code) return '#7b8498'
  if (code.toUpperCase() === 'P') return '#3fb950'
  if (code.toUpperCase() === 'S') return '#f85149'
  return '#d29922'
}

function txLabel(code: string | null): string {
  if (!code) return '—'
  if (code.toUpperCase() === 'P') return 'Purchase'
  if (code.toUpperCase() === 'S') return 'Sale'
  return code
}

function changeColor(pct: number | null): string {
  return pct == null ? '#7b8498' : pct >= 0 ? '#3fb950' : '#f85149'
}

const CLS_BADGE: Record<string, { color: string; bg: string; border: string }> = {
  OPPORTUNISTIC:  { color: '#3fb950', bg: 'rgba(63,185,80,0.1)',    border: 'rgba(63,185,80,0.25)'   },
  ROUTINE:        { color: '#d29922', bg: 'rgba(210,153,34,0.1)',   border: 'rgba(210,153,34,0.25)'  },
  UNCLASSIFIABLE: { color: '#7b8498', bg: 'rgba(123,132,152,0.1)', border: 'rgba(123,132,152,0.2)'  },
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#0d1117', border: '1px solid #1e2530', borderRadius: '8px',
  padding: '9px 14px', color: '#e6edf3', fontSize: '14px', outline: 'none',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}
const btnPrimary: React.CSSProperties = {
  background: '#1a2d4a', border: '1px solid #2a4a70', borderRadius: '8px',
  padding: '10px 24px', color: '#58a6ff', fontSize: '14px', fontWeight: 600,
  cursor: 'pointer', fontFamily: 'inherit',
}
const btnSecondary: React.CSSProperties = {
  background: 'transparent', border: '1px solid #1e2530', borderRadius: '8px',
  padding: '7px 16px', color: '#7b8498', fontSize: '13px',
  cursor: 'pointer', fontFamily: 'inherit',
}
const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 14px',
  fontSize: '11px', letterSpacing: '1px', color: '#7b8498',
  fontWeight: 500, whiteSpace: 'nowrap', textTransform: 'uppercase',
  borderBottom: '1px solid #1a1f2a',
}
const tdStyle: React.CSSProperties = {
  padding: '12px 14px', borderBottom: '1px solid #111620', verticalAlign: 'middle',
}

// ─── Creation screen ──────────────────────────────────────────────────────────

function CreateScreen({ onCreate }: { onCreate: (p: Portfolio) => void }) {
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  function handleCreate() {
    const trimmed = name.trim()
    if (!trimmed) return
    onCreate({ name: trimmed, description: desc.trim(), tickers: [] })
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0d12', color: '#e6edf3',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: '420px', padding: '0 24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '8px', letterSpacing: '-0.5px' }}>
          Create Your Portfolio
        </h1>
        <p style={{ fontSize: '13px', color: '#4a5568', marginBottom: '32px' }}>
          Track insider signals for the tickers you care about.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#7b8498', marginBottom: '6px' }}>
              Portfolio name
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder="Dean's Portfolio" autoFocus style={inputStyle} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', color: '#7b8498', marginBottom: '6px' }}>
              Description <span style={{ color: '#3a4a60' }}>(optional)</span>
            </label>
            <input value={desc} onChange={(e) => setDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder="Tracking tech insider signals" style={inputStyle} />
          </div>
        </div>
        <button onClick={handleCreate} disabled={!name.trim()}
          style={{ ...btnPrimary, width: '100%', opacity: name.trim() ? 1 : 0.4, cursor: name.trim() ? 'pointer' : 'not-allowed' }}>
          Create Portfolio
        </button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router = useRouter()
  const [user,       setUser]       = useState<User | null>(null)
  const [authReady,  setAuthReady]  = useState(false)
  const [portfolio,  setPortfolio]  = useState<Portfolio | null>(null)
  const [dbLoading,  setDbLoading]  = useState(true)

  const [editing,   setEditing]   = useState(false)
  const [editName,  setEditName]  = useState('')
  const [editDesc,  setEditDesc]  = useState('')

  const [tickerInput,    setTickerInput]    = useState('')
  const [validating,     setValidating]     = useState(false)
  const [validateError,  setValidateError]  = useState<string | null>(null)
  const tickerInputRef = useRef<HTMLInputElement>(null)

  const [data,          setData]          = useState<TickerRow[]>([])
  const [news,          setNews]          = useState<NewsItem[]>([])
  const [loading,       setLoading]       = useState(false)
  const [activeSection, setActiveSection] = useState<'news' | 'insider'>('news')
  const [dirFilter,     setDirFilter]     = useState<'all' | 'buys' | 'sells'>('buys')
  const [insiderTrades, setInsiderTrades] = useState<InsiderRow[]>([])
  const [loadingTrades, setLoadingTrades] = useState(false)

  // ── Auth check ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return }
      setUser(user)
      setAuthReady(true)
    })
  }, [router])

  // ── Load portfolio from Supabase ────────────────────────────────────────────
  useEffect(() => {
    if (!authReady || !user) return
    setDbLoading(true)
    supabase
      .from('watchlists')
      .select('name, description, tickers')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPortfolio({ name: data.name, description: data.description ?? '', tickers: data.tickers ?? [] })
        setDbLoading(false)
      })
  }, [authReady, user])

  // ── Persist to Supabase ─────────────────────────────────────────────────────
  async function save(p: Portfolio) {
    setPortfolio(p)
    if (!user) return
    await supabase.from('watchlists').upsert(
      { user_id: user.id, name: p.name, description: p.description, tickers: p.tickers, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  }

  // ── Fetch market data ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!portfolio || portfolio.tickers.length === 0) { setData([]); setNews([]); return }
    setLoading(true)
    fetch(`/api/watchlist/data?tickers=${portfolio.tickers.join(',')}`)
      .then((r) => r.json())
      .then((d) => { setData(d.tickers ?? []); setNews(d.news ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [portfolio?.tickers.join(',')])

  // ── Fetch insider trades ────────────────────────────────────────────────────
  useEffect(() => {
    if (!portfolio || portfolio.tickers.length === 0) { setInsiderTrades([]); return }
    setLoadingTrades(true)
    const dir = dirFilter === 'buys' ? 'buys' : dirFilter === 'sells' ? 'sells' : 'all'
    fetch(`/api/insider/fetch?tickers=${portfolio.tickers.join(',')}&direction=${dir}&limit=50`)
      .then((r) => r.json())
      .then((d) => setInsiderTrades(d.rows ?? []))
      .catch(() => {})
      .finally(() => setLoadingTrades(false))
  }, [portfolio?.tickers.join(','), dirFilter])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function startEdit() { setEditName(portfolio!.name); setEditDesc(portfolio!.description); setEditing(true) }
  function saveEdit() {
    if (!editName.trim()) return
    save({ ...portfolio!, name: editName.trim(), description: editDesc.trim() })
    setEditing(false)
  }

  async function addTicker() {
    const t = tickerInput.trim().toUpperCase().replace(/[^A-Z.]/g, '')
    if (!t) return
    if (portfolio!.tickers.includes(t)) { setTickerInput(''); return }
    setValidating(true); setValidateError(null)
    try {
      const res = await fetch(`/api/watchlist/data?tickers=${t}`)
      const d = await res.json()
      if (!d.tickers?.[0]?.name) { setValidateError(`${t} is not in our S&P 500 database`); return }
      await save({ ...portfolio!, tickers: [...portfolio!.tickers, t] })
      setTickerInput('')
      tickerInputRef.current?.focus()
    } catch { setValidateError('Validation failed. Please try again.') }
    finally { setValidating(false) }
  }

  function removeTicker(t: string) {
    save({ ...portfolio!, tickers: portfolio!.tickers.filter((x) => x !== t) })
  }

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (!authReady || dbLoading) {
    return <div style={{ minHeight: '100vh', background: '#0a0d12' }} />
  }
  if (!portfolio) {
    return <CreateScreen onCreate={save} />
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0a0d12', color: '#e6edf3', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '80px 40px 100px' }}>

        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          {editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '440px' }}>
              <input value={editName} onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }}
                placeholder="Portfolio name" autoFocus
                style={{ ...inputStyle, fontSize: '18px', fontWeight: 700 }} />
              <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveEdit() }}
                placeholder="Description (optional)" style={inputStyle} />
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={saveEdit} style={btnPrimary}>Save</button>
                <button onClick={() => setEditing(false)} style={btnSecondary}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
              <div>
                <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 4px', letterSpacing: '-0.5px' }}>
                  {portfolio.name}
                </h1>
                {portfolio.description && (
                  <p style={{ fontSize: '13px', color: '#4a5568', margin: 0 }}>{portfolio.description}</p>
                )}
              </div>
              <button onClick={startEdit} style={{ ...btnSecondary, flexShrink: 0 }}>Edit</button>
            </div>
          )}
        </div>

        {/* Ticker input */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input ref={tickerInputRef} value={tickerInput}
              onChange={(e) => { setTickerInput(e.target.value); setValidateError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') addTicker() }}
              placeholder="Add ticker... AAPL, TSLA, NVDA"
              style={{ ...inputStyle, width: '280px' }} disabled={validating} />
            <button onClick={addTicker} disabled={validating || !tickerInput.trim()}
              style={{ ...btnSecondary, opacity: validating || !tickerInput.trim() ? 0.4 : 1, cursor: validating || !tickerInput.trim() ? 'not-allowed' : 'pointer' }}>
              {validating ? 'Checking...' : 'Add'}
            </button>
          </div>
          {validateError && <p style={{ fontSize: '12px', color: '#f85149', margin: '6px 0 0' }}>{validateError}</p>}
        </div>

        {/* Ticker chips */}
        {portfolio.tickers.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '32px' }}>
            {portfolio.tickers.map((t) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#0d1117', border: '1px solid #1e2530', borderRadius: '6px', padding: '4px 10px', fontSize: '13px', fontWeight: 600, color: '#c9d1d9' }}>
                {t}
                <button onClick={() => removeTicker(t)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a5568', fontSize: '15px', lineHeight: 1, padding: 0 }}
                  aria-label={`Remove ${t}`}>×</button>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {portfolio.tickers.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#4a5568', fontSize: '14px' }}>
            <div style={{ fontSize: '28px', marginBottom: '12px' }}>☆</div>
            Add tickers above to start tracking insider signals
          </div>
        )}

        {loading && <div style={{ color: '#4a5568', fontSize: '13px', marginBottom: '24px' }}>Loading...</div>}

        {/* Ticker table */}
        {!loading && data.length > 0 && (
          <div style={{ marginBottom: '48px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr>
                  {['Ticker', 'Company', 'Price', 'Change %', 'Volume', 'Mkt Cap', 'P/E', '52W High', '52W Low', 'Insider Score'].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.ticker} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={tdStyle}>
                      <Link href={`/t/${row.ticker}`} style={{ color: '#58a6ff', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>{row.ticker}</Link>
                    </td>
                    <td style={{ ...tdStyle, color: '#c9d1d9', maxWidth: '160px' }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name ?? '—'}</span>
                    </td>
                    <td style={{ ...tdStyle, color: '#e6edf3', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.price != null ? `$${row.price.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: changeColor(row.changePercent), fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {row.changePercent != null ? `${row.changePercent >= 0 ? '+' : ''}${row.changePercent.toFixed(2)}%` : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: '#7b8498', whiteSpace: 'nowrap' }}>{fmtVolume(row.volume)}</td>
                    <td style={{ ...tdStyle, color: '#7b8498', whiteSpace: 'nowrap' }}>{fmtMarketCap(row.marketCap)}</td>
                    <td style={{ ...tdStyle, color: '#7b8498', whiteSpace: 'nowrap' }}>{row.pe != null ? row.pe.toFixed(1) : '—'}</td>
                    <td style={{ ...tdStyle, color: '#7b8498', whiteSpace: 'nowrap' }}>{row.week52High != null ? `$${row.week52High.toFixed(2)}` : '—'}</td>
                    <td style={{ ...tdStyle, color: '#7b8498', whiteSpace: 'nowrap' }}>{row.week52Low != null ? `$${row.week52Low.toFixed(2)}` : '—'}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: scoreColor(row.score) }}>{row.score ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Feed section */}
        {!loading && portfolio.tickers.length > 0 && (
          <div>
            <div style={{ display: 'flex', borderBottom: '1px solid #1a1f2a', marginBottom: '20px' }}>
              {(['news', 'insider'] as const).map((sec) => {
                const active = activeSection === sec
                return (
                  <button key={sec} onClick={() => setActiveSection(sec)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '10px 4px', marginRight: '28px',
                      fontSize: '14px', fontWeight: active ? 600 : 400,
                      color: active ? '#e6edf3' : '#7b8498',
                      borderBottom: `2px solid ${active ? '#58a6ff' : 'transparent'}`,
                      transition: 'color 0.15s', fontFamily: 'inherit',
                    }}>
                    {sec === 'news' ? 'Recent News' : 'Recent Insider Trades'}
                  </button>
                )
              })}
            </div>

            {activeSection === 'news' && (
              news.length === 0
                ? <p style={{ fontSize: '13px', color: '#4a5568' }}>No recent news for your portfolio tickers.</p>
                : <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {news.map((item, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '12px', padding: '10px 0', borderBottom: '1px solid #111620' }}>
                        <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px', color: '#58a6ff', background: '#0d1f30', border: '1px solid #1a3a50', borderRadius: '3px', padding: '2px 6px', flexShrink: 0 }}>
                          {item.ticker}
                        </span>
                        {item.url
                          ? <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ color: '#c9d1d9', textDecoration: 'none', fontSize: '13px', flex: 1, lineHeight: '1.4' }}>{item.title}</a>
                          : <span style={{ color: '#c9d1d9', fontSize: '13px', flex: 1 }}>{item.title}</span>}
                        <span style={{ fontSize: '11px', color: '#4a5568', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {[item.source, timeAgo(item.publishedAt)].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
            )}

            {activeSection === 'insider' && (
              <div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
                  {(['all', 'buys', 'sells'] as const).map((f) => {
                    const active = dirFilter === f
                    return (
                      <button key={f} onClick={() => setDirFilter(f)}
                        style={{ padding: '5px 14px', borderRadius: '6px', border: `1px solid ${active ? '#2a4a70' : '#1e2530'}`, background: active ? '#1a2d4a' : 'transparent', color: active ? '#58a6ff' : '#7b8498', fontSize: '12px', fontWeight: active ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {f === 'all' ? 'All' : f === 'buys' ? 'Buys' : 'Sells'}
                      </button>
                    )
                  })}
                </div>
                {loadingTrades && <div style={{ color: '#4a5568', fontSize: '13px' }}>Loading...</div>}
                {!loadingTrades && insiderTrades.length === 0 && <p style={{ fontSize: '13px', color: '#4a5568' }}>No insider trades found.</p>}
                {!loadingTrades && insiderTrades.length > 0 && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr>
                          {['Ticker', 'Insider', 'Role', 'Date', 'Type', 'Price', 'Shares', 'Value', 'Score'].map((h) => (
                            <th key={h} style={thStyle}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {insiderTrades.map((row, i) => {
                          const isBuy = row.transaction_code?.toUpperCase() === 'P'
                          const cls   = row.classification ?? 'UNCLASSIFIABLE'
                          const badge = CLS_BADGE[cls] ?? CLS_BADGE.UNCLASSIFIABLE
                          const color = txColor(row.transaction_code)
                          return (
                            <tr key={row.id ?? i} style={{ borderBottom: '1px solid #111620', background: isBuy ? 'rgba(63,185,80,0.02)' : 'rgba(248,81,73,0.02)' }}>
                              <td style={tdStyle}>
                                <Link href={`/t/${row.ticker}`} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '6px', background: '#151c28', border: '1px solid #1e2a3a', color: '#9ecbff', fontSize: '12px', fontWeight: 700, textDecoration: 'none' }}>
                                  {row.ticker}
                                </Link>
                              </td>
                              <td style={{ ...tdStyle, maxWidth: '180px' }}>
                                <div style={{ color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.insider_name ?? '—'}</div>
                                <span style={{ display: 'inline-block', marginTop: '3px', fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', color: badge.color, background: badge.bg, border: `1px solid ${badge.border}`, letterSpacing: '0.4px' }}>{cls}</span>
                              </td>
                              <td style={{ ...tdStyle, color: '#7b8498', maxWidth: '140px' }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.officer_title ?? row.role ?? '—'}</div>
                              </td>
                              <td style={{ ...tdStyle, color: '#7b8498', whiteSpace: 'nowrap' }}>{fmtDate(row.transaction_date)}</td>
                              <td style={tdStyle}>
                                <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', color, background: `${color}1a`, border: `1px solid ${color}40` }}>{txLabel(row.transaction_code)}</span>
                              </td>
                              <td style={{ ...tdStyle, color: '#c9d1d9', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                {row.price_per_share != null ? `$${Number(row.price_per_share).toFixed(2)}` : '—'}
                              </td>
                              <td style={{ ...tdStyle, color: '#c9d1d9', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                {row.shares != null ? Number(row.shares).toLocaleString() : '—'}
                              </td>
                              <td style={{ ...tdStyle, color, fontWeight: 600, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtCurrency(row.total_value)}</td>
                              <td style={{ ...tdStyle, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: !isBuy ? '#3a4a60' : scoreColor(row.sentra_score) }}>
                                {!isBuy ? <span style={{ color: '#3a4a60' }}>N/A</span> : row.sentra_score ?? <span style={{ color: '#3a4a60' }}>—</span>}
                              </td>
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
