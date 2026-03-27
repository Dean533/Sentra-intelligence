'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── types ────────────────────────────────────────────────────────────────────

type EventItem = {
  id: string
  ticker: string
  event_type: 'news' | 'sec_filing'
  title: string
  summary: string | null
  source_url: string | null
  published_at: string
  raw_text: string | null
}

type FilterType = 'all' | 'news' | 'sec_filing'

const TYPE_OPTIONS: { label: string; value: FilterType }[] = [
  { label: 'All Signals', value: 'all' },
  { label: 'News',        value: 'news' },
  { label: 'SEC Filings', value: 'sec_filing' },
]

// ─── helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffH  = Math.floor(diffMs / 3600000)
  if (diffH < 1) return `${Math.floor(diffMs / 60000)}m ago`
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function parseMeta(raw: string | null): { source?: string; sentiment?: string; items?: string[] } {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function sentimentColor(s: string | undefined): string {
  if (s === 'bullish') return '#3fb950'
  if (s === 'bearish') return '#f85149'
  return '#7b8498'
}

function eventBorderColor(ev: EventItem): string {
  if (ev.event_type === 'news') return sentimentColor(parseMeta(ev.raw_text).sentiment)
  // SEC: derive from items
  const parsed = parseMeta(ev.raw_text)
  const items: string[] = Array.isArray(parsed?.items) ? parsed.items : []
  if (items.includes('2.02')) return '#3fb950'
  if (items.some((i) => ['5.02', '5.01', '2.05'].includes(i))) return '#d29922'
  if (items.some((i) => ['4.01', '4.02'].includes(i))) return '#f85149'
  if (items.some((i) => ['1.01', '1.02'].includes(i))) return '#9ecbff'
  return '#2a3040'
}

const TYPE_TAG_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  news:       { bg: '#0d1f30', color: '#9ecbff', label: 'NEWS' },
  sec_filing: { bg: '#1a1a0a', color: '#d29922', label: 'SEC' },
}

// ─── component ────────────────────────────────────────────────────────────────

export default function SignalsPage() {
  const [events,  setEvents]  = useState<EventItem[]>([])
  const [loading, setLoading] = useState(true)
  const [type,    setType]    = useState<FilterType>('all')
  const [page,    setPage]    = useState(1)
  const [total,   setTotal]   = useState(0)
  const [pages,   setPages]   = useState(1)
  const router = useRouter()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ type, page: String(page), limit: '30' })
    fetch(`/api/signals?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setEvents(d.events ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
      })
      .finally(() => setLoading(false))
  }, [type, page])

  function changeType(val: FilterType) { setType(val); setPage(1) }

  const pageStart = (page - 1) * 30 + 1
  const pageEnd   = Math.min(page * 30, total)

  return (
    <div style={{ padding: '48px 40px 80px', maxWidth: '900px', margin: '0 auto' }}>

      {/* heading */}
      <p style={{ color: '#7b8498', fontSize: '12px', letterSpacing: '2px', margin: '0 0 10px' }}>
        SIGNAL FEED
      </p>
      <h1 style={{ fontSize: '40px', fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.5px' }}>
        Signals
      </h1>
      <p style={{ color: '#7b8498', fontSize: '15px', margin: '0 0 32px', lineHeight: 1.6 }}>
        Real-time feed of news and SEC filings across all tracked tickers.
      </p>

      {/* controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: '12px', marginBottom: '20px', flexWrap: 'wrap',
      }}>
        <span style={{ color: '#7b8498', fontSize: '13px' }}>
          {loading ? 'Loading…' : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} signals`}
        </span>

        {/* type filter tabs */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {TYPE_OPTIONS.map((o) => (
            <button
              key={o.value}
              onClick={() => changeType(o.value)}
              style={{
                padding: '6px 16px', borderRadius: '8px', border: '1px solid',
                borderColor: type === o.value ? '#3a4a60' : '#1e2530',
                background: type === o.value ? 'rgba(158,203,255,0.06)' : 'transparent',
                color: type === o.value ? '#c9d1d9' : '#7b8498',
                fontSize: '13px', cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* feed */}
      <div style={{
        background: '#0d1117', border: '1px solid #1e2530',
        borderRadius: '12px', overflow: 'hidden',
      }}>

        {/* loading skeleton */}
        {loading && Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            padding: '18px 24px',
            borderBottom: i < 7 ? '1px solid #141920' : 'none',
          }}>
            <div style={{ height: '14px', borderRadius: '4px', background: '#1a1f2a', marginBottom: '8px', width: '70%', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ height: '11px', borderRadius: '4px', background: '#1a1f2a', width: '40%', animation: 'pulse 1.5s ease-in-out infinite' }} />
          </div>
        ))}

        {/* empty */}
        {!loading && events.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: '#7b8498', fontSize: '14px' }}>
            No signals found.
          </div>
        )}

        {/* events */}
        {!loading && events.map((ev, i) => {
          const meta        = parseMeta(ev.raw_text)
          const borderColor = eventBorderColor(ev)
          const tag         = TYPE_TAG_COLORS[ev.event_type] ?? TYPE_TAG_COLORS.news
          const sentiment   = ev.event_type === 'news' ? (meta.sentiment ?? ev.summary) : null

          return (
            <div
              key={ev.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '16px',
                padding: '16px 24px 16px 21px',
                borderLeft: `3px solid ${borderColor}`,
                borderBottom: i < events.length - 1 ? '1px solid #141920' : 'none',
                cursor: 'pointer', transition: 'background 0.12s',
              }}
              onClick={() => router.push(`/t/${ev.ticker}`)}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(158,203,255,0.03)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              {/* ticker chip */}
              <div style={{ flexShrink: 0, paddingTop: '2px' }}>
                <span style={{
                  display: 'inline-block', minWidth: '56px', textAlign: 'center',
                  padding: '3px 8px', borderRadius: '6px',
                  background: '#151c28', border: '1px solid #1e2a3a',
                  color: '#9ecbff', fontSize: '12px', fontWeight: 700, letterSpacing: '0.3px',
                }}>
                  {ev.ticker}
                </span>
              </div>

              {/* main content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: '#c9d1d9', lineHeight: 1.4, marginBottom: '6px' }}>
                  {ev.title}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {/* event type tag */}
                  <span style={{
                    fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                    background: tag.bg, color: tag.color, fontWeight: 700, letterSpacing: '0.5px',
                  }}>
                    {tag.label}
                  </span>

                  {/* sentiment badge (news only) */}
                  {sentiment && (
                    <span style={{
                      fontSize: '10px', padding: '1px 6px', borderRadius: '4px',
                      background: `${sentimentColor(sentiment)}14`,
                      border: `1px solid ${sentimentColor(sentiment)}30`,
                      color: sentimentColor(sentiment),
                      fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                    }}>
                      {sentiment}
                    </span>
                  )}

                  {/* source */}
                  {meta.source && (
                    <span style={{ fontSize: '11px', color: '#7b8498' }}>{meta.source}</span>
                  )}

                  {/* time */}
                  <span style={{ fontSize: '11px', color: '#3a4a60' }}>
                    {relTime(ev.published_at)}
                  </span>
                </div>
              </div>

              {/* external link */}
              {ev.source_url && (
                <a
                  href={ev.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: '#7b8498', fontSize: '12px', textDecoration: 'none', whiteSpace: 'nowrap', paddingTop: '2px', flexShrink: 0, transition: 'color 0.15s' }}
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
            }}
          >
            ← Previous
          </button>
          <span style={{ color: '#7b8498', fontSize: '13px' }}>Page {page} of {pages}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page === pages}
            style={{
              padding: '8px 18px', borderRadius: '8px',
              border: '1px solid #1e2530', background: 'transparent',
              color: page === pages ? '#3a4a5a' : '#c9d1d9',
              fontSize: '13px', cursor: page === pages ? 'not-allowed' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
    </div>
  )
}
