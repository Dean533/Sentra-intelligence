'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── shared types ─────────────────────────────────────────────────────────────

type Tab = 'insider' | 'sec' | 'news'

const TABS: { label: string; value: Tab }[] = [
  { label: 'Insider Buys',  value: 'insider' },
  { label: 'SEC Filings',   value: 'sec' },
  { label: 'News',          value: 'news' },
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
  textAlign: 'left', padding: '10px 14px',
  color: '#7b8498', fontSize: '11px', letterSpacing: '1px',
  fontWeight: 500, whiteSpace: 'nowrap',
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
  source_url: string | null
}

// ─── EVENTS FEED (SEC Filings + News) ────────────────────────────────────────

// Maps tab value → the event_type value stored in the DB
const TAB_EVENT_TYPE: Record<string, string> = {
  sec:  'sec_filing',
  news: 'news',
}

function EventsFeed({ eventType }: { eventType: string }) {
  const [events,  setEvents]  = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [page,    setPage]    = useState(1)
  const [total,   setTotal]   = useState(0)
  const [pages,   setPages]   = useState(1)
  const router = useRouter()

  useEffect(() => {
    setPage(1)
  }, [eventType])

  useEffect(() => {
    setLoading(true)
    fetch(`/api/signals?type=${eventType}&page=${page}&limit=30`)
      .then((r) => r.json())
      .then((d) => { setEvents(d.events ?? []); setTotal(d.total ?? 0); setPages(d.pages ?? 1) })
      .finally(() => setLoading(false))
  }, [eventType, page])

  const pageStart = (page - 1) * 30 + 1
  const pageEnd   = Math.min(page * 30, total)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <span style={{ color: '#7b8498', fontSize: '13px' }}>
          {loading ? 'Loading…' : total === 0 ? 'No events found' : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} events`}
        </span>
      </div>

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

// ─── INSIDER BUYS TABLE ───────────────────────────────────────────────────────

function transactionColor(t: string | null) {
  if (!t) return '#7b8498'
  const upper = t.toUpperCase()
  if (upper.includes('BUY') || upper === 'P') return '#3fb950'
  if (upper.includes('SELL') || upper === 'S') return '#f85149'
  return '#d29922'
}

function transactionLabel(t: string | null) {
  if (!t) return '—'
  const upper = t.toUpperCase()
  if (upper === 'P') return 'Purchase'
  if (upper === 'S') return 'Sale'
  return t
}

function InsiderBuysTable() {
  const [rows,    setRows]    = useState<InsiderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [page,    setPage]    = useState(1)
  const [total,   setTotal]   = useState(0)
  const [pages,   setPages]   = useState(1)
  const router = useRouter()

  useEffect(() => {
    setLoading(true)
    fetch(`/api/insider/fetch?page=${page}&limit=50`)
      .then((r) => r.json())
      .then((d) => { setRows(d.rows ?? []); setTotal(d.total ?? 0); setPages(d.pages ?? 1) })
      .finally(() => setLoading(false))
  }, [page])

  const pageStart = (page - 1) * 50 + 1
  const pageEnd   = Math.min(page * 50, total)

  const COLS = ['Ticker', 'Insider Name', 'Role', 'Date', 'Type', 'Price', 'Shares', 'Value']

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <span style={{ color: '#7b8498', fontSize: '13px' }}>
          {loading ? 'Loading…' : total === 0 ? 'No insider purchases found yet' : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} purchases`}
        </span>
      </div>

      <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e2530' }}>
              {COLS.map((h) => <th key={h} style={thStyle}>{h.toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #141920' }}>
                {Array.from({ length: 8 }).map((_, j) => (
                  <td key={j} style={{ padding: '13px 14px' }}>
                    <div style={{ height: '13px', borderRadius: '4px', background: '#1a1f2a', width: j === 1 ? '140px' : '64px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  </td>
                ))}
              </tr>
            ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '56px 24px', textAlign: 'center' }}>
                  <div style={{ color: '#3a4a60', fontSize: '12px', letterSpacing: '2px', marginBottom: '8px' }}>NO DATA</div>
                  <div style={{ color: '#7b8498', fontSize: '14px' }}>
                    Insider transaction data coming soon.
                  </div>
                  <div style={{ color: '#3a4a60', fontSize: '12px', marginTop: '6px' }}>
                    Run <code style={{ color: '#9ecbff' }}>/api/insider/ingest</code> to populate.
                  </div>
                </td>
              </tr>
            )}

            {!loading && rows.map((row, i) => {
              const displayRole = row.officer_title ?? row.role ?? '—'
              return (
                <tr
                  key={row.id}
                  style={{
                    borderBottom: i < rows.length - 1 ? '1px solid #141920' : 'none',
                    cursor: 'pointer', transition: 'background 0.12s',
                    background: 'rgba(63,185,80,0.02)',  // subtle green tint for buy rows
                  }}
                  onClick={() => router.push(`/t/${row.ticker}`)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(63,185,80,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(63,185,80,0.02)')}
                >
                  <td style={{ padding: '13px 14px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: '6px',
                      background: '#151c28', border: '1px solid #1e2a3a',
                      color: '#9ecbff', fontSize: '12px', fontWeight: 700,
                    }}>
                      {row.ticker}
                    </span>
                  </td>
                  <td style={{ padding: '13px 14px', color: '#c9d1d9', fontSize: '13px', maxWidth: '200px' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.insider_name ?? '—'}
                    </div>
                  </td>
                  <td style={{ padding: '13px 14px', color: '#7b8498', fontSize: '12px', maxWidth: '160px' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {displayRole}
                    </div>
                  </td>
                  <td style={{ padding: '13px 14px', color: '#7b8498', fontSize: '13px', whiteSpace: 'nowrap' }}>
                    {fmtDate(row.transaction_date)}
                  </td>
                  <td style={{ padding: '13px 14px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
                      color: '#3fb950', background: 'rgba(63,185,80,0.12)',
                      border: '1px solid rgba(63,185,80,0.25)',
                    }}>
                      Purchase
                    </span>
                  </td>
                  <td style={{ padding: '13px 14px', color: '#c9d1d9', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
                    {row.price_per_share != null ? `$${Number(row.price_per_share).toFixed(2)}` : '—'}
                  </td>
                  <td style={{ padding: '13px 14px', color: '#c9d1d9', fontSize: '13px', fontVariantNumeric: 'tabular-nums' }}>
                    {row.shares != null ? Number(row.shares).toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: '13px', fontWeight: 600, color: '#3fb950', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtCurrency(row.total_value)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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

// ─── PLACEHOLDER ──────────────────────────────────────────────────────────────

function Placeholder({ label }: { label: string }) {
  return (
    <div style={{
      background: '#0d1117', border: '1px solid #1e2530',
      borderRadius: '12px', padding: '64px 24px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '13px', color: '#3a4a60', letterSpacing: '2px', marginBottom: '10px' }}>COMING SOON</div>
      <div style={{ color: '#7b8498', fontSize: '14px' }}>{label} feed is under construction.</div>
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function EventsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('insider')

  return (
    <div style={{ padding: '48px 40px 80px', maxWidth: '1000px', margin: '0 auto' }}>

      {/* heading */}
      <p style={{ color: '#7b8498', fontSize: '12px', letterSpacing: '2px', margin: '0 0 10px' }}>
        EVENT FEED
      </p>
      <h1 style={{ fontSize: '40px', fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.5px' }}>
        Events
      </h1>
      <p style={{ color: '#7b8498', fontSize: '15px', margin: '0 0 32px', lineHeight: 1.6 }}>
        Real-time feed of news, SEC filings, and insider activity across all tracked tickers.
      </p>

      {/* tab bar */}
      <div style={{
        display: 'flex', gap: '2px',
        borderBottom: '1px solid #1e2530',
        marginBottom: '24px',
      }}>
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

      {/* tab content */}
      {activeTab === 'insider' && <InsiderBuysTable />}
      {activeTab === 'sec'     && <EventsFeed eventType={TAB_EVENT_TYPE.sec} />}
      {activeTab === 'news'    && <EventsFeed eventType={TAB_EVENT_TYPE.news} />}

      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
    </div>
  )
}
