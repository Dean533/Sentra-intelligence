'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ─── types ────────────────────────────────────────────────────────────────────

type Ticker = {
  id: string
  symbol: string
  name: string
  sector: string
  market_cap: number
  price: number | null
  day_change: number | null
  day_change_percent: number | null
}

type SortKey = 'market_cap' | 'alpha' | 'sector'

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Market Cap', value: 'market_cap' },
  { label: 'A → Z',      value: 'alpha' },
  { label: 'Sector',     value: 'sector' },
]

const SECTOR_OPTIONS = [
  'All Sectors',
  'Basic Materials',
  'Communication Services',
  'Consumer Cyclical',
  'Consumer Defensive',
  'Energy',
  'Financial Services',
  'Healthcare',
  'Industrials',
  'Real Estate',
  'Technology',
  'Utilities',
]

// ─── shared styles ────────────────────────────────────────────────────────────

const dropdownStyle: React.CSSProperties = {
  padding: '7px 28px 7px 12px',
  borderRadius: '8px',
  border: '1px solid #1e2530',
  background: '#0d1117',
  color: '#c9d1d9',
  fontSize: '13px',
  cursor: 'pointer',
  outline: 'none',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237b8498' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 10px center',
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatMarketCap(num: number): string {
  if (num >= 1e12) return `$${(num / 1e12).toFixed(1)}T`
  if (num >= 1e9)  return `$${(num / 1e9).toFixed(1)}B`
  return `$${(num / 1e6).toFixed(1)}M`
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ExplorePage() {
  const [tickers, setTickers] = useState<Ticker[]>([])
  const [loading, setLoading] = useState(true)
  const [total,   setTotal]   = useState(0)
  const [pages,   setPages]   = useState(1)
  const [page,    setPage]    = useState(1)
  const [sector,  setSector]  = useState('All Sectors')
  const [sortBy,  setSortBy]  = useState<SortKey>('market_cap')
  const [search,  setSearch]  = useState('')
  const router   = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  // ── data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ sort: sortBy, page: String(page) })
    if (sector !== 'All Sectors') params.set('sector', sector)

    fetch(`/api/tickers?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setTickers(d.tickers ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
        setLoading(false)
      })
  }, [sector, sortBy, page])

  // Reset to page 1 when filters change (page itself is a dep so no double-fire)
  function changeSector(val: string) { setSector(val); setPage(1) }
  function changeSort(val: SortKey)  { setSortBy(val); setPage(1) }

  // ── search (client-side filter on visible 30) ──────────────────────────────

  const searchVal = search.trim().toUpperCase()

  const filtered = search.trim()
    ? tickers.filter((t) => {
        const q = search.toLowerCase()
        return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
      })
    : tickers

  const showSearchFor = searchVal.length > 0 && !filtered.some((t) => t.symbol === searchVal)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !searchVal) return
    const exact = filtered.find((t) => t.symbol === searchVal)
    if (exact)              { router.push(`/t/${exact.symbol}`);    return }
    if (filtered.length === 1) { router.push(`/t/${filtered[0].symbol}`); return }
    router.push(`/t/${searchVal}`)
  }

  // ── pagination label ───────────────────────────────────────────────────────

  const pageStart = (page - 1) * 30 + 1
  const pageEnd   = Math.min(page * 30, total)

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '48px 40px 80px', maxWidth: '1100px', margin: '0 auto' }}>

      {/* heading */}
      <p style={{ color: '#7b8498', fontSize: '12px', letterSpacing: '2px', margin: '0 0 10px' }}>
        TICKER EXPLORER
      </p>
      <h1 style={{ fontSize: '40px', fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.5px' }}>
        Ticker Explorer
      </h1>
      <p style={{ color: '#7b8498', fontSize: '15px', margin: '0 0 36px', lineHeight: 1.6 }}>
        Search any stock to see Sentra's signal analysis, or browse our coverage universe below.
      </p>

      {/* search bar */}
      <div style={{ position: 'relative', marginBottom: '20px' }}>
        <span style={{
          position: 'absolute', left: '20px', top: '50%', transform: 'translateY(-50%)',
          color: '#7b8498', fontSize: '18px', pointerEvents: 'none', lineHeight: 1,
        }}>
          ⌕
        </span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by ticker or company name… NVDA, Apple, Tesla"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%', padding: '18px 20px 18px 48px',
            borderRadius: '12px', border: '1px solid #1e2530',
            background: '#0d1117', color: 'white', fontSize: '17px',
            outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = '#3a4a60')}
          onBlur={(e)  => (e.currentTarget.style.borderColor = '#1e2530')}
        />
        {search && (
          <span style={{
            position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)',
            color: '#7b8498', fontSize: '12px', letterSpacing: '0.5px', pointerEvents: 'none',
          }}>
            ENTER ↵
          </span>
        )}
      </div>

      {/* controls row: count label left, dropdowns right */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px', marginBottom: '20px', flexWrap: 'wrap',
      }}>
        <span style={{ color: '#7b8498', fontSize: '13px' }}>
          {loading
            ? 'Loading…'
            : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} stocks`}
        </span>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <select value={sector} onChange={(e) => changeSector(e.target.value)} style={dropdownStyle}>
            {SECTOR_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => changeSort(e.target.value as SortKey)} style={dropdownStyle}>
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1e2530' }}>
            {['#', 'Ticker', 'Company', 'Sector', 'Price', 'Day Change', 'Market Cap'].map((h) => (
              <th key={h} style={{
                textAlign: 'left', padding: '10px 16px',
                color: '#7b8498', fontSize: '11px', letterSpacing: '1px', fontWeight: 500,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>

          {/* "Search for X" row — shown when query has no exact match in visible 30 */}
          {!loading && showSearchFor && (
            <tr
              onClick={() => router.push(`/t/${searchVal}`)}
              style={{ borderBottom: '1px solid #1a2235', cursor: 'pointer', transition: 'background 0.12s' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(158,203,255,0.05)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <td colSpan={7} style={{ padding: '14px 16px' }}>
                <span style={{ color: '#9ecbff', marginRight: '10px', fontSize: '15px' }}>↗</span>
                <span style={{ color: '#7b8498', fontSize: '14px' }}>Press Enter to search </span>
                <span style={{ color: '#c9d1d9', fontWeight: 700, fontSize: '14px' }}>{searchVal}</span>
                <span style={{ color: '#7b8498', fontSize: '14px' }}> directly</span>
                <span style={{ color: '#9ecbff', fontSize: '14px', marginLeft: '8px' }}>→</span>
              </td>
            </tr>
          )}

          {/* loading skeleton */}
          {loading && Array.from({ length: 10 }).map((_, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #141920' }}>
              {Array.from({ length: 7 }).map((_, j) => (
                <td key={j} style={{ padding: '14px 16px' }}>
                  <div style={{
                    height: '14px', borderRadius: '4px',
                    background: '#1a1f2a',
                    width: j === 2 ? '140px' : j === 0 ? '20px' : '60px',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }} />
                </td>
              ))}
            </tr>
          ))}

          {/* ticker rows */}
          {!loading && filtered.length === 0 && !showSearchFor ? (
            <tr>
              <td colSpan={7} style={{ padding: '48px 16px', textAlign: 'center', color: '#7b8498', fontSize: '14px' }}>
                No tickers match your filters.
              </td>
            </tr>
          ) : (
            !loading && filtered.map((t, i) => (
              <tr
                key={t.id}
                onClick={() => router.push(`/t/${t.symbol}`)}
                style={{ borderBottom: '1px solid #141920', cursor: 'pointer', transition: 'background 0.12s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#0d1117')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '14px 16px', color: '#7b8498', fontSize: '13px' }}>
                  {(page - 1) * 30 + i + 1}
                </td>
                <td style={{ padding: '14px 16px', fontWeight: 700, fontSize: '15px' }}>{t.symbol}</td>
                <td style={{ padding: '14px 16px', color: '#c9d1d9', fontSize: '14px' }}>{t.name}</td>
                <td style={{ padding: '14px 16px', color: '#7b8498', fontSize: '13px' }}>{t.sector}</td>
                <td style={{ padding: '14px 16px', fontSize: '14px' }}>
                  {t.price ? `$${t.price.toFixed(2)}` : '—'}
                </td>
                <td style={{
                  padding: '14px 16px', fontSize: '14px',
                  color: t.day_change_percent == null ? '#7b8498'
                    : t.day_change_percent >= 0 ? '#3fb950' : '#f85149',
                }}>
                  {t.day_change_percent != null
                    ? `${t.day_change_percent >= 0 ? '+' : ''}${t.day_change_percent.toFixed(2)}%`
                    : '—'}
                </td>
                <td style={{ padding: '14px 16px', fontSize: '14px' }}>
                  {formatMarketCap(t.market_cap)}
                </td>
              </tr>
            ))
          )}

        </tbody>
      </table>

      {/* pagination */}
      {!loading && pages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '16px', marginTop: '32px',
        }}>
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1}
            style={{
              padding: '8px 18px', borderRadius: '8px',
              border: '1px solid #1e2530', background: 'transparent',
              color: page === 1 ? '#3a4a5a' : '#c9d1d9',
              fontSize: '13px', cursor: page === 1 ? 'not-allowed' : 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => { if (page > 1) e.currentTarget.style.borderColor = '#3a4a60' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1e2530' }}
          >
            ← Previous
          </button>

          <span style={{ color: '#7b8498', fontSize: '13px' }}>
            Page {page} of {pages}
          </span>

          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page === pages}
            style={{
              padding: '8px 18px', borderRadius: '8px',
              border: '1px solid #1e2530', background: 'transparent',
              color: page === pages ? '#3a4a5a' : '#c9d1d9',
              fontSize: '13px', cursor: page === pages ? 'not-allowed' : 'pointer',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => { if (page < pages) e.currentTarget.style.borderColor = '#3a4a60' }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#1e2530' }}
          >
            Next →
          </button>
        </div>
      )}

      {/* skeleton animation */}
      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
    </div>
  )
}
