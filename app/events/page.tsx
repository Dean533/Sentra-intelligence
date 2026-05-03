'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── shared types ─────────────────────────────────────────────────────────────

type Tab = 'insider' | 'sec' | 'news'
type DirFilter = 'all' | 'buys' | 'sells'

const TABS: { label: string; value: Tab }[] = [
  { label: 'Insider Activity', value: 'insider' },
  { label: 'SEC Filings',      value: 'sec' },
  { label: 'News',             value: 'news' },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffH  = Math.floor(diffMs / 3600000)
  if (diffH < 1)  return `${Math.floor(diffMs / 60000)}m ago`
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtCurrency(val: number | null): string {
  if (val == null) return '—'
  if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(1)}M`
  if (Math.abs(val) >= 1e3) return `$${(val / 1e3).toFixed(0)}K`
  return `$${val.toLocaleString()}`
}

function parseMeta(raw: string | null): Record<string, any> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function sentimentColor(s: string | undefined) {
  if (s === 'bullish') return '#3fb950'
  if (s === 'bearish') return '#f85149'
  return '#7b8498'
}

function eventBorderColor(ev: EventItem): string {
  if (ev.event_type === 'news') return sentimentColor(parseMeta(ev.raw_text).sentiment)
  const parsed = parseMeta(ev.raw_text)
  const items: string[] = Array.isArray(parsed?.items) ? parsed.items : []
  if (items.includes('2.02')) return '#3fb950'
  if (items.some((i) => ['5.02', '5.01', '2.05'].includes(i))) return '#d29922'
  if (items.some((i) => ['4.01', '4.02'].includes(i))) return '#f85149'
  if (items.some((i) => ['1.01', '1.02'].includes(i))) return '#9ecbff'
  return '#2a3040'
}

const TYPE_TAG: Record<string, { bg: string; color: string; label: string }> = {
  news:       { bg: '#0d1f30', color: '#9ecbff',  label: 'NEWS' },
  sec_filing: { bg: '#1a1a0a', color: '#d29922',  label: 'SEC'  },
}

// ─── shared styles ────────────────────────────────────────────────────────────

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 18px', borderRadius: '8px',
  border: '1px solid #1e2530', background: 'transparent',
  color: disabled ? '#3a4a5a' : '#c9d1d9',
  fontSize: '13px', cursor: disabled ? 'not-allowed' : 'pointer',
})

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '10px 10px',
  color: '#7b8498', fontSize: '11px', letterSpacing: '1px',
  fontWeight: 500, whiteSpace: 'nowrap',
}

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
  fontFamily: 'inherit',
}

// ─── types ────────────────────────────────────────────────────────────────────

type EventItem = {
  id: string; ticker: string; event_type: 'news' | 'sec_filing'
  title: string; summary: string | null
  source_url: string | null; published_at: string; raw_text: string | null
}

type InsiderRow = {
  id: string
  ticker: string
  insider_name: string | null
  role: string | null
  officer_title: string | null
  transaction_date: string
  transaction_code: string | null
  shares: number | null
  price_per_share: number | null
  total_value: number | null
  shares_owned_after: number | null
  source_url: string | null
  classification: string | null
}

// ─── EVENTS FEED (SEC Filings + News) ────────────────────────────────────────

const TAB_EVENT_TYPE: Record<string, string> = {
  sec:  'sec_filing',
  news: 'news',
}

function EventsFeed({ eventType, ticker }: { eventType: string; ticker?: string }) {
  const isNews = eventType === 'news'

  const [events,    setEvents]    = useState<EventItem[]>([])
  const [loading,   setLoading]   = useState(true)
  const [page,      setPage]      = useState(1)
  const [total,     setTotal]     = useState(0)
  const [pages,     setPages]     = useState(1)
  const [sentiment, setSentiment] = useState('all')
  const [source,    setSource]    = useState('all')
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [sources,   setSources]   = useState<string[]>([])
  const router = useRouter()

  // Fetch distinct news sources once on mount
  useEffect(() => {
    if (!isNews) return
    fetch('/api/signals?distinct=source')
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
  }, [isNews])

  useEffect(() => { setPage(1) }, [eventType, ticker, sentiment, source, startDate, endDate])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ type: eventType, page: String(page), limit: '30' })
    if (ticker)                      params.set('ticker', ticker)
    if (isNews && sentiment !== 'all') params.set('sentiment', sentiment)
    if (isNews && source !== 'all')    params.set('source', source)
    if (isNews && startDate)           params.set('start_date', startDate)
    if (isNews && endDate)             params.set('end_date', endDate)
    fetch(`/api/signals?${params}`)
      .then((r) => r.json())
      .then((d) => { setEvents(d.events ?? []); setTotal(d.total ?? 0); setPages(d.pages ?? 1) })
      .finally(() => setLoading(false))
  }, [eventType, ticker, sentiment, source, startDate, endDate, page, isNews])

  const pageStart = (page - 1) * 30 + 1
  const pageEnd   = Math.min(page * 30, total)
  const countLabel = loading ? 'Loading…' : total === 0 ? 'No events found' : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} events`

  return (
    <>
      {isNews && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
          <select value={sentiment} onChange={(e) => setSentiment(e.target.value)} style={dropdownStyle}>
            <option value="all">All Sentiments</option>
            <option value="bullish">Bullish</option>
            <option value="neutral">Neutral</option>
            <option value="bearish">Bearish</option>
          </select>

          <select value={source} onChange={(e) => setSource(e.target.value)} style={dropdownStyle}>
            <option value="all">All Sources</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#7b8498', fontSize: '12px' }}>From</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              style={{ ...dropdownStyle, padding: '7px 10px', colorScheme: 'dark', minWidth: '130px' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: '#7b8498', fontSize: '12px' }}>To</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              style={{ ...dropdownStyle, padding: '7px 10px', colorScheme: 'dark', minWidth: '130px' }} />
          </div>

          <span style={{ color: '#7b8498', fontSize: '13px', marginLeft: 'auto' }}>{countLabel}</span>
        </div>
      )}

      {!isNews && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ color: '#7b8498', fontSize: '13px' }}>{countLabel}</span>
        </div>
      )}

      <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: '12px', overflow: 'hidden' }}>
        {loading && Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ padding: '18px 24px', borderBottom: i < 7 ? '1px solid #141920' : 'none' }}>
            <div style={{ height: '14px', borderRadius: '4px', background: '#1a1f2a', marginBottom: '8px', width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ height: '11px', borderRadius: '4px', background: '#1a1f2a', width: '40%', animation: 'pulse 1.5s ease-in-out infinite' }} />
          </div>
        ))}

        {!loading && events.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#7b8498', fontSize: '14px' }}>No events found for this filter.</div>
        )}

        {!loading && events.map((ev, i) => {
          const meta      = parseMeta(ev.raw_text)
          const tag       = TYPE_TAG[ev.event_type] ?? TYPE_TAG.news
          const sentiment = ev.event_type === 'news' ? (meta.sentiment ?? null) : null
          return (
            <div
              key={ev.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '16px',
                padding: '16px 24px 16px 21px',
                borderLeft: `3px solid ${eventBorderColor(ev)}`,
                borderBottom: i < events.length - 1 ? '1px solid #141920' : 'none',
                cursor: 'pointer', transition: 'background 0.12s',
              }}
              onClick={() => router.push(`/t/${ev.ticker}`)}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(158,203,255,0.03)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ flexShrink: 0, paddingTop: '2px' }}>
                <span style={{
                  display: 'inline-block', minWidth: '56px', textAlign: 'center',
                  padding: '3px 8px', borderRadius: '6px',
                  background: '#151c28', border: '1px solid #1e2a3a',
                  color: '#9ecbff', fontSize: '12px', fontWeight: 700,
                }}>
                  {ev.ticker}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#c9d1d9', lineHeight: 1.4, marginBottom: '6px' }}>
                  {ev.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: tag.bg, color: tag.color, fontWeight: 700, letterSpacing: '0.5px' }}>
                    {tag.label}
                  </span>
                  {sentiment && (
                    <span style={{
                      fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                      background: `${sentimentColor(sentiment)}14`,
                      border: `1px solid ${sentimentColor(sentiment)}30`,
                      color: sentimentColor(sentiment), fontWeight: 600,
                      textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                    }}>
                      {sentiment}
                    </span>
                  )}
                  {meta.source && <span style={{ fontSize: '11px', color: '#7b8498' }}>{meta.source}</span>}
                  <span style={{ fontSize: '11px', color: '#3a4a60' }}>{relTime(ev.published_at)}</span>
                </div>
              </div>
              {ev.source_url && (
                <a
                  href={ev.source_url} target="_blank" rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#7b8498', fontSize: '12px', textDecoration: 'none', whiteSpace: 'nowrap', paddingTop: '2px', flexShrink: 0 }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#9ecbff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}
                >
                  View →
                </a>
              )}
            </div>
          )
        })}
      </div>

      {!loading && pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '32px' }}>
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} style={paginationBtn(page === 1)}>← Previous</button>
          <span style={{ color: '#7b8498', fontSize: '13px' }}>Page {page} of {pages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page === pages} style={paginationBtn(page === pages)}>Next →</button>
        </div>
      )}
    </>
  )
}

// ─── INSIDER ACTIVITY TABLE ───────────────────────────────────────────────────

function transactionColor(t: string | null) {
  if (!t) return '#7b8498'
  if (t.toUpperCase() === 'P') return '#3fb950'
  if (t.toUpperCase() === 'S') return '#f85149'
  return '#d29922'
}

function transactionLabel(t: string | null) {
  if (!t) return '—'
  if (t.toUpperCase() === 'P') return 'Purchase'
  if (t.toUpperCase() === 'S') return 'Sale'
  return t
}

const CLS_BADGE: Record<string, { color: string; bg: string; border: string }> = {
  OPPORTUNISTIC:  { color: '#3fb950', bg: 'rgba(63,185,80,0.1)',    border: 'rgba(63,185,80,0.25)'   },
  ROUTINE:        { color: '#d29922', bg: 'rgba(210,153,34,0.1)',   border: 'rgba(210,153,34,0.25)'  },
  UNCLASSIFIABLE: { color: '#7b8498', bg: 'rgba(123,132,152,0.1)', border: 'rgba(123,132,152,0.2)'  },
}

function matchesRole(row: InsiderRow, filter: string): boolean {
  const title = (row.officer_title ?? row.role ?? '').toLowerCase()
  if (filter === 'ceo')      return title.includes('chief executive') || title.includes(' ceo')  || title.startsWith('ceo')
  if (filter === 'cfo')      return title.includes('chief financial') || title.includes(' cfo')  || title.startsWith('cfo')
  if (filter === 'director') return title.includes('director')
  if (filter === '10pct')    return title.includes('10%') || title.includes('10 percent')
  if (filter === 'other')    return !title.includes('chief') && !title.includes('director') && !title.includes('10%')
  return true
}

function holdingsPctOf(row: InsiderRow): number | null {
  const s     = row.shares
  const after = row.shares_owned_after
  if (s == null || after == null) return null
  const before = after - s
  if (before <= 0) return null
  return (s / before) * 100
}

function holdingsDeltaDisplay(row: InsiderRow): { pct: number; color: string } | null {
  const s     = row.shares
  const after = row.shares_owned_after
  if (s == null || after == null) return null
  const isBuy = row.transaction_code?.toUpperCase() === 'P'
  const denom = isBuy ? after - s : after + s
  if (denom <= 0) return null
  const raw = (s / denom) * 100
  const pct = Math.min(raw, 999)
  return { pct: isBuy ? pct : -pct, color: isBuy ? '#3fb950' : '#f85149' }
}

function InsiderActivityTable({ ticker }: { ticker?: string }) {
  const [rows,        setRows]        = useState<InsiderRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [page,        setPage]        = useState(1)
  const [total,       setTotal]       = useState(0)
  const [pages,       setPages]       = useState(1)
  const [dirFilter,   setDirFilter]   = useState<DirFilter>('all')
  const [clsFilter,   setClsFilter]   = useState('all')
  const [roleFilter,  setRoleFilter]  = useState('all')
  const [valueFilter, setValueFilter] = useState('all')
  const [startDate,   setStartDate]   = useState('')
  const [endDate,     setEndDate]     = useState('')
  const [holdingsPct, setHoldingsPct] = useState('any')
  const [clusterMin,  setClusterMin]  = useState('none')
  const router = useRouter()

  useEffect(() => { setPage(1) }, [ticker, dirFilter, clsFilter, roleFilter, startDate, endDate, clusterMin, holdingsPct])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: '50', direction: dirFilter })
    if (ticker)              params.set('ticker', ticker)
    if (clsFilter  !== 'all') params.set('classification', clsFilter)
    if (roleFilter !== 'all') params.set('role', roleFilter)
    if (startDate)            params.set('start_date', startDate)
    if (endDate)              params.set('end_date', endDate)
    if (clusterMin !== 'none') params.set('cluster_min', clusterMin)
    if (holdingsPct !== 'any') params.set('holdings_min', holdingsPct)
    fetch(`/api/insider/fetch?${params}`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setTotal(d.total ?? 0); setPages(d.pages ?? 1) })
      .finally(() => setLoading(false))
  }, [ticker, dirFilter, clsFilter, roleFilter, startDate, endDate, clusterMin, holdingsPct, page])

  // 'other' role and value filter remain client-side (negation / local threshold)
  const filteredRows = rows.filter((row) => {
    if (roleFilter === 'other' && !matchesRole(row, 'other')) return false
    if (valueFilter !== 'all'  && (row.total_value ?? 0) < parseInt(valueFilter)) return false
    return true
  })

  const hasClientFilter = roleFilter === 'other' || valueFilter !== 'all'
  const pageStart       = (page - 1) * 50 + 1
  const pageEnd         = Math.min(page * 50, total)
  const countLabel      = dirFilter === 'buys' ? 'purchases' : dirFilter === 'sells' ? 'sales' : 'transactions'

  const COLS = ['Ticker', 'Insider Name', 'Role', 'Date', 'Type', 'Price', 'Shares', 'Δ Hold', 'Value']

  // In cluster mode, group by ticker (sorted by each group's most recent trade) then flatten.
  const displayRows: InsiderRow[] = (() => {
    if (clusterMin === 'none') return filteredRows
    const map = new Map<string, InsiderRow[]>()
    for (const row of filteredRows) {
      if (!map.has(row.ticker)) map.set(row.ticker, [])
      map.get(row.ticker)!.push(row)
    }
    return [...map.entries()]
      .sort(([, a], [, b]) => (b[0]?.transaction_date ?? '').localeCompare(a[0]?.transaction_date ?? ''))
      .flatMap(([, rows]) => rows)
  })()

  const renderRow = (row: InsiderRow, isLast: boolean) => {
    const displayRole = row.officer_title ?? row.role ?? '—'
    const isBuy       = row.transaction_code?.toUpperCase() === 'P'
    const rowBg       = isBuy ? 'rgba(63,185,80,0.02)' : 'rgba(248,81,73,0.02)'
    const rowBgHover  = isBuy ? 'rgba(63,185,80,0.06)' : 'rgba(248,81,73,0.05)'
    const txColor     = transactionColor(row.transaction_code)
    const txLabel     = transactionLabel(row.transaction_code)
    const cls         = row.classification ?? 'UNCLASSIFIABLE'
    const badge       = CLS_BADGE[cls] ?? CLS_BADGE.UNCLASSIFIABLE
    const delta       = holdingsDeltaDisplay(row)
    return (
      <tr
        key={row.id}
        style={{ borderBottom: isLast ? 'none' : '1px solid #141920', cursor: 'pointer', transition: 'background 0.12s', background: rowBg }}
        onClick={() => router.push(`/t/${row.ticker}`)}
        onMouseEnter={(e) => (e.currentTarget.style.background = rowBgHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
      >
        <td style={{ padding: '11px 10px' }}>
          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '6px', background: '#151c28', border: '1px solid #1e2a3a', color: '#9ecbff', fontSize: '12px', fontWeight: 700 }}>
            {row.ticker}
          </span>
        </td>
        <td style={{ padding: '11px 10px', color: '#c9d1d9', fontSize: '13px', maxWidth: '200px' }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.insider_name ?? '—'}</div>
          <span style={{ display: 'inline-block', marginTop: '3px', fontSize: '10px', fontWeight: 600, padding: '1px 6px', borderRadius: '4px', color: badge.color, background: badge.bg, border: `1px solid ${badge.border}`, letterSpacing: '0.4px' }}>
            {cls}
          </span>
        </td>
        <td style={{ padding: '11px 10px', color: '#7b8498', fontSize: '12px', maxWidth: '160px' }}>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayRole}</div>
        </td>
        <td style={{ padding: '11px 10px', color: '#7b8498', fontSize: '13px', whiteSpace: 'nowrap' }}>{fmtDate(row.transaction_date)}</td>
        <td style={{ padding: '11px 10px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', color: txColor, background: `${txColor}1a`, border: `1px solid ${txColor}40` }}>
            {txLabel}
          </span>
        </td>
        <td style={{ padding: '11px 10px', color: '#c9d1d9', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
          {row.price_per_share != null ? `$${Number(row.price_per_share).toFixed(2)}` : '—'}
        </td>
        <td style={{ padding: '11px 10px', color: '#c9d1d9', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
          {row.shares != null ? Number(row.shares).toLocaleString() : '—'}
        </td>
        <td style={{ padding: '11px 10px', fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {delta
            ? <span style={{ color: delta.color }}>{delta.pct >= 0 ? '+' : ''}{delta.pct.toFixed(1)}%</span>
            : <span style={{ color: '#3a4a60' }}>—</span>
          }
        </td>
        <td style={{ padding: '11px 10px', fontSize: '13px', fontWeight: 600, color: txColor, fontVariantNumeric: 'tabular-nums' }}>
          {fmtCurrency(row.total_value)}
        </td>
      </tr>
    )
  }

  return (
    <>
      {/* filter row 1 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <select value={dirFilter} onChange={(e) => setDirFilter(e.target.value as DirFilter)} style={dropdownStyle}>
          <option value="all">All</option>
          <option value="buys">Buys</option>
          <option value="sells">Sells</option>
        </select>

        <select value={clsFilter} onChange={(e) => setClsFilter(e.target.value)} style={dropdownStyle}>
          <option value="all">All Classifications</option>
          <option value="OPPORTUNISTIC">Opportunistic</option>
          <option value="ROUTINE">Routine</option>
          <option value="UNCLASSIFIABLE">Unclassifiable</option>
        </select>

        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={dropdownStyle}>
          <option value="all">All Roles</option>
          <option value="ceo">CEO</option>
          <option value="cfo">CFO</option>
          <option value="director">Director</option>
          <option value="10pct">10% Owner</option>
          <option value="other">Other</option>
        </select>

        <select value={valueFilter} onChange={(e) => setValueFilter(e.target.value)} style={dropdownStyle}>
          <option value="all">All Values</option>
          <option value="100000">$100K+</option>
          <option value="500000">$500K+</option>
          <option value="1000000">$1M+</option>
          <option value="5000000">$5M+</option>
          <option value="10000000">$10M+</option>
        </select>
      </div>

      {/* filter row 2 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#7b8498', fontSize: '12px' }}>From</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              ...dropdownStyle,
              padding: '7px 10px',
              colorScheme: 'dark',
              minWidth: '130px',
            }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#7b8498', fontSize: '12px' }}>To</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              ...dropdownStyle,
              padding: '7px 10px',
              colorScheme: 'dark',
              minWidth: '130px',
            }}
          />
        </div>

        <select value={holdingsPct} onChange={(e) => setHoldingsPct(e.target.value)} style={dropdownStyle}>
          <option value="any">Any Holdings Δ</option>
          <option value="10">10%+ increase</option>
          <option value="25">25%+ increase</option>
          <option value="50">50%+ increase</option>
          <option value="100">100%+ increase</option>
        </select>

        <select value={clusterMin} onChange={(e) => setClusterMin(e.target.value)} style={dropdownStyle}>
          <option value="none">No Cluster Filter</option>
          <option value="2">2+ Insiders</option>
          <option value="3">3+ Insiders</option>
          <option value="4">4+ Insiders</option>
        </select>

        <span style={{ color: '#7b8498', fontSize: '13px', marginLeft: 'auto' }}>
          {loading
            ? 'Loading…'
            : hasClientFilter
              ? `${filteredRows.length} ${countLabel} on this page`
              : total === 0
                ? `No ${countLabel} found`
                : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} ${countLabel}`
          }
        </span>
      </div>

      <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: '12px', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2530' }}>
              {COLS.map((h) => <th key={h} style={thStyle}>{h.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #141920' }}>
                {Array.from({ length: 9 }).map((_, j) => (
                  <td key={j} style={{ padding: '11px 10px' }}>
                    <div style={{ height: '13px', borderRadius: '4px', background: '#1a1f2a', width: j === 1 ? '140px' : '64px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </td>
                ))}
              </tr>
            ))}

            {!loading && filteredRows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: '56px 24px', textAlign: 'center' }}>
                  <div style={{ color: '#3a4a60', fontSize: '12px', letterSpacing: '2px', marginBottom: '8px' }}>NO DATA</div>
                  <div style={{ color: '#7b8498', fontSize: '14px' }}>No {countLabel} match these filters.</div>
                </td>
              </tr>
            )}

            {!loading && displayRows.map((row, i) =>
              renderRow(row, i === displayRows.length - 1)
            )}
          </tbody>
        </table>
        </div>
      </div>

      {!loading && pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', marginTop: '32px' }}>
          <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} style={paginationBtn(page === 1)}>← Previous</button>
          <span style={{ color: '#7b8498', fontSize: '13px' }}>Page {page} of {pages}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page === pages} style={paginationBtn(page === pages)}>Next →</button>
        </div>
      )}
    </>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const [activeTab,    setActiveTab]    = useState<Tab>('insider')
  const [tickerInput,  setTickerInput]  = useState('')
  const [tickerFilter, setTickerFilter] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setTickerFilter(tickerInput.toUpperCase().trim()), 300)
    return () => clearTimeout(t)
  }, [tickerInput])

  return (
    <div style={{ padding: '48px 40px 80px', maxWidth: '1000px', margin: '0 auto' }}>

      {/* heading */}
      <p style={{ color: '#7b8498', fontSize: '12px', letterSpacing: '2px', margin: '0 0 10px' }}>
        EVENT FEED
      </p>
      <h1 style={{ fontSize: '40px', fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.5px' }}>
        Events
      </h1>
      <p style={{ color: '#7b8498', fontSize: '15px', margin: '0 0 24px', lineHeight: 1.6 }}>
        Real-time feed of news, SEC filings, and insider activity across all tracked tickers.
      </p>

      {/* tab bar */}
      <div style={{ display: 'flex', gap: '2px', borderBottom: '1px solid #1e2530', marginBottom: '16px' }}>
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            style={{
              padding: '10px 20px',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '14px', fontWeight: activeTab === tab.value ? 600 : 400,
              color: activeTab === tab.value ? '#c9d1d9' : '#7b8498',
              borderBottom: `2px solid ${activeTab === tab.value ? '#9ecbff' : 'transparent'}`,
              marginBottom: '-1px',
              transition: 'color 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => { if (activeTab !== tab.value) e.currentTarget.style.color = '#c9d1d9' }}
            onMouseLeave={(e) => { if (activeTab !== tab.value) e.currentTarget.style.color = '#7b8498' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ticker search — below tab bar, full width */}
      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <span style={{
          position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
          color: '#3a4a60', fontSize: '15px', pointerEvents: 'none',
        }}>⌕</span>
        <input
          type="text"
          placeholder="Filter by ticker…"
          value={tickerInput}
          onChange={(e) => setTickerInput(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '12px 40px 12px 38px',
            background: '#0d1117', border: '1px solid #1e2530',
            borderRadius: '8px', color: '#c9d1d9',
            fontSize: '15px', outline: 'none',
            fontFamily: 'inherit',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = '#2a3a50')}
          onBlur={(e)  => (e.currentTarget.style.borderColor = '#1e2530')}
        />
        {tickerInput && (
          <button
            onClick={() => setTickerInput('')}
            style={{
              position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', color: '#3a4a60', cursor: 'pointer',
              fontSize: '18px', padding: '0', lineHeight: 1,
            }}
          >×</button>
        )}
      </div>

      {/* tab content */}
      {activeTab === 'insider' && <InsiderActivityTable ticker={tickerFilter || undefined} />}
      {activeTab === 'sec'     && <EventsFeed eventType={TAB_EVENT_TYPE.sec}  ticker={tickerFilter || undefined} />}
      {activeTab === 'news'    && <EventsFeed eventType={TAB_EVENT_TYPE.news} ticker={tickerFilter || undefined} />}

      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
    </div>
  )
}
