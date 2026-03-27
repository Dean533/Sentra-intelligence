'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { MarketRange } from '@/lib/marketData'

const MarketPriceChart = dynamic(() => import('@/app/components/MarketPriceChart'), {
  ssr: false,
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number | null | undefined, decimals = 2) {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function fmtLarge(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  return `$${n.toLocaleString()}`
}

function fmtVol(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`
  return `${n}`
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return '—'
  // yahoo returns dividend yield as a decimal (0.0052), or sometimes as a %
  const val = Math.abs(n) < 1 ? n * 100 : n
  return `${val.toFixed(2)}%`
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function scoreColor(s: number) {
  if (s >= 65) return '#3fb950'
  if (s >= 35) return '#d29922'
  return '#f85149'
}

function scoreLabel(s: number) {
  if (s >= 65) return 'Bullish'
  if (s >= 35) return 'Neutral'
  return 'Bearish'
}

const ITEM_LABELS: Record<string, string> = {
  '1.01': 'Material Agreement',
  '1.02': 'Agreement Terminated',
  '2.01': 'Asset Acquisition',
  '2.02': 'Earnings Release',
  '2.05': 'Officer Departure',
  '2.06': 'Asset Impairment',
  '3.01': 'Exchange Delisting',
  '4.01': 'Auditor Change',
  '4.02': 'Financial Restatement',
  '5.01': 'Change of Control',
  '5.02': 'Director/Officer Change',
  '5.03': 'Bylaw Amendment',
  '5.07': 'Shareholder Vote',
  '7.01': 'Reg FD Disclosure',
  '8.01': 'Other Events',
}

function parseItems(rawText: string | null): string[] {
  if (!rawText) return []
  try {
    const parsed = JSON.parse(rawText)
    const raw = parsed.items
    if (!raw) return []
    const codes: string[] = Array.isArray(raw)
      ? raw
      : String(raw).split(',').map((s: string) => s.trim())
    return codes.filter((c) => c !== '9.01')
  } catch {
    return []
  }
}

function itemBorderColor(items: string[]): string {
  if (items.includes('2.02')) return '#3fb950'
  if (items.some((i) => ['5.02', '5.01', '2.05'].includes(i))) return '#d29922'
  if (items.some((i) => ['4.01', '4.02'].includes(i))) return '#f85149'
  if (items.some((i) => ['1.01', '1.02'].includes(i))) return '#9ecbff'
  return '#2a3040'
}

// ─── types ────────────────────────────────────────────────────────────────────

type TickerData = {
  symbol: string
  quote: any
  summary: any
  ticker: any
  events: any[]
  related: any[]
}

type ChartPoint = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

const RANGES: { label: string; value: MarketRange }[] = [
  { label: '1D', value: '1d' },
  { label: '5D', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
]

// ─── shared style tokens ──────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #1e2530',
  borderRadius: '12px',
  padding: '24px',
}

const label: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '1.5px',
  color: '#7b8498',
  marginBottom: '4px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '2px',
  color: '#7b8498',
  margin: '0 0 20px',
  textTransform: 'uppercase' as const,
}

// ─── component ────────────────────────────────────────────────────────────────

export default function TickerPage() {
  const params = useParams()
  const ticker = (params?.ticker as string)?.toUpperCase()

  const [data, setData] = useState<TickerData | null>(null)
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([])
  const [range, setRange] = useState<MarketRange>('1mo')
  const [loading, setLoading] = useState(true)
  const [loadingChart, setLoadingChart] = useState(true)
  const [showFullSummary, setShowFullSummary] = useState(false)
  const [news, setNews] = useState<any[]>([])
  const [loadingNews, setLoadingNews] = useState(true)
  const [scoreData, setScoreData] = useState<{ score: number; breakdown: { news: number; sec: number; mispricing: number; reasons: string[] } } | null>(null)
  const [loadingScore, setLoadingScore] = useState(true)
  const [valuation, setValuation] = useState<{ analystTarget: number | null; currentPrice: number | null; analystGap: number | null; weekRange52Position: number | null; recommendation: string | null; signal: string | null } | null>(null)
  const [loadingValuation, setLoadingValuation] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    fetch(`/api/ticker/${ticker}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false))
  }, [ticker])

  useEffect(() => {
    if (!ticker) return
    setLoadingChart(true)
    fetch(`/api/market/history?ticker=${ticker}&range=${range}`)
      .then((r) => r.json())
      .then((d) => setChartPoints(d.points ?? []))
      .finally(() => setLoadingChart(false))
  }, [ticker, range])

  useEffect(() => {
    if (!ticker) return
    setLoadingNews(true)
    fetch(`/api/news?ticker=${ticker}`)
      .then((r) => r.json())
      .then((d) => setNews(d.articles ?? []))
      .finally(() => setLoadingNews(false))
  }, [ticker])

  useEffect(() => {
    if (!ticker) return
    setLoadingScore(true)
    fetch(`/api/score/${ticker}`)
      .then((r) => r.json())
      .then((d) => { if (d.score != null) setScoreData(d) })
      .finally(() => setLoadingScore(false))
  }, [ticker])

  useEffect(() => {
    if (!ticker) return
    setLoadingValuation(true)
    fetch(`/api/valuation/${ticker}`)
      .then((r) => r.json())
      .then((d) => { if (d.currentPrice != null || d.analystTarget != null) setValuation(d) })
      .finally(() => setLoadingValuation(false))
  }, [ticker])

  const q = data?.quote ?? null
  const s = data?.summary ?? null
  const meta = data?.ticker ?? null
  const events = data?.events ?? []
  const related = data?.related ?? []

  const isUp = (q?.regularMarketChangePercent ?? 0) >= 0
  const priceColor = isUp ? '#3fb950' : '#f85149'
  const changeSign = isUp ? '+' : ''
  const displayName = q?.longName ?? q?.shortName ?? meta?.name ?? ticker
  const sector = meta?.sector ?? q?.sector ?? null

  const ceo = s?.assetProfile?.companyOfficers?.find(
    (o: any) => o.title?.toLowerCase().includes('ceo') || o.title?.toLowerCase().includes('chief executive')
  )
  const hq = [s?.assetProfile?.city, s?.assetProfile?.state ?? s?.assetProfile?.country]
    .filter(Boolean).join(', ')
  const summary = s?.assetProfile?.longBusinessSummary ?? null
  const SUMMARY_LIMIT = 280

  if (loading) {
    return (
      <div style={{ background: '#0a0e14', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#7b8498', fontSize: '14px', letterSpacing: '1px' }}>LOADING {ticker}…</div>
      </div>
    )
  }

  return (
    <div style={{ background: '#0a0e14', minHeight: '100vh', color: '#e6edf3', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '0 40px 80px' }}>

        {/* ── back ────────────────────────────────────────────────────────────── */}
        <div style={{ paddingTop: '24px', paddingBottom: '20px' }}>
          <a href="/explore" style={{ color: '#7b8498', fontSize: '12px', letterSpacing: '1.5px', textDecoration: 'none' }}>
            ← EXPLORE
          </a>
        </div>

        {/* ── header bar ──────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: '24px', paddingBottom: '28px',
          borderBottom: '1px solid #1e2530', marginBottom: '24px',
        }}>
          {/* left */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
              <h1 style={{ fontSize: '52px', fontWeight: 800, margin: 0, lineHeight: 1, letterSpacing: '-1px' }}>
                {ticker}
              </h1>
              {sector && (
                <span style={{
                  fontSize: '12px', padding: '4px 12px', borderRadius: '20px',
                  border: '1px solid #2a3a50', background: 'rgba(158,203,255,0.06)',
                  color: '#9ecbff', letterSpacing: '0.5px', whiteSpace: 'nowrap',
                  alignSelf: 'center', marginTop: '6px',
                }}>
                  {sector}
                </span>
              )}
            </div>
            <div style={{ color: '#c9d1d9', fontSize: '17px', marginTop: '2px' }}>
              {displayName}
            </div>
            {q?.exchange && (
              <div style={{ color: '#7b8498', fontSize: '12px', marginTop: '6px' }}>
                {q.exchange} · {q?.currency ?? 'USD'}
              </div>
            )}
          </div>

          {/* right */}
          {q?.regularMarketPrice != null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '48px', fontWeight: 700, lineHeight: 1, letterSpacing: '-1px' }}>
                {fmt$(q.regularMarketPrice)}
              </div>
              <div style={{ fontSize: '18px', color: priceColor, marginTop: '6px', fontWeight: 500 }}>
                {changeSign}{q.regularMarketChange?.toFixed(2)}&nbsp;
                <span style={{ opacity: 0.85 }}>
                  ({changeSign}{q.regularMarketChangePercent?.toFixed(2)}%)
                </span>
              </div>
              {q?.marketState && (
                <div style={{ fontSize: '11px', color: '#7b8498', marginTop: '6px', letterSpacing: '1px' }}>
                  {q.marketState === 'REGULAR' ? '● MARKET OPEN' : '● MARKET CLOSED'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── range selector ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              style={{
                padding: '5px 14px', borderRadius: '6px', border: 'none',
                background: range === r.value ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: range === r.value ? '#ffffff' : '#7b8498',
                fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => { if (range !== r.value) e.currentTarget.style.color = '#c9d1d9' }}
              onMouseLeave={(e) => { if (range !== r.value) e.currentTarget.style.color = '#7b8498' }}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* ── chart ───────────────────────────────────────────────────────────── */}
        <div style={{
          ...card,
          padding: '20px 12px 12px',
          marginBottom: '16px',
          opacity: loadingChart ? 0.5 : 1,
          transition: 'opacity 0.2s',
        }}>
          {chartPoints.length > 0 ? (
            <MarketPriceChart points={chartPoints} range={range} color={priceColor} />
          ) : (
            <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#7b8498' }}>
              {loadingChart ? 'Loading chart…' : 'No chart data available'}
            </div>
          )}
        </div>

        {/* ── stats bar ───────────────────────────────────────────────────────── */}
        <div style={{
          ...card,
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          padding: '0',
          marginBottom: '16px',
          overflow: 'hidden',
        }}>
          {[
            { label: 'Open', value: fmt$(q?.regularMarketOpen) },
            { label: 'High', value: fmt$(q?.regularMarketDayHigh) },
            { label: 'Low', value: fmt$(q?.regularMarketDayLow) },
            { label: 'Volume', value: fmtVol(q?.regularMarketVolume) },
            { label: 'Mkt Cap', value: fmtLarge(q?.marketCap) },
            { label: '52W High', value: fmt$(q?.fiftyTwoWeekHigh) },
            { label: '52W Low', value: fmt$(q?.fiftyTwoWeekLow) },
          ].map(({ label: lbl, value }, i, arr) => (
            <div
              key={lbl}
              style={{
                padding: '16px 20px',
                borderRight: i < arr.length - 1 ? '1px solid #1e2530' : 'none',
              }}
            >
              <div style={label}>{lbl}</div>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* ── two-column main section ─────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: '16px', alignItems: 'start' }}>

          {/* ── LEFT COLUMN ─────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* sentra score */}
            <div style={card}>
              <p style={sectionTitle}>Sentra Score</p>
              {loadingScore ? (
                <div style={{ height: '120px', borderRadius: '8px', background: '#1a1f2a', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ) : (() => {
                const s = scoreData?.score ?? 50
                const bd = scoreData?.breakdown
                return (
                  <>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '24px' }}>
                      <span style={{ fontSize: '64px', fontWeight: 800, color: scoreColor(s), lineHeight: 1 }}>
                        {s}
                      </span>
                      <span style={{ color: '#7b8498', fontSize: '22px' }}>/100</span>
                      <span style={{
                        marginLeft: '8px', fontSize: '13px', fontWeight: 600,
                        color: scoreColor(s), padding: '3px 10px',
                        borderRadius: '20px', border: `1px solid ${scoreColor(s)}22`,
                        background: `${scoreColor(s)}11`,
                      }}>
                        {scoreLabel(s)}
                      </span>
                    </div>

                    {/* heat bar */}
                    <div style={{ position: 'relative', height: '6px', borderRadius: '3px', background: 'linear-gradient(to right, #f85149 0%, #d29922 50%, #3fb950 100%)', marginBottom: '24px' }}>
                      <div style={{
                        position: 'absolute', top: '-4px',
                        left: `calc(${s}% - 7px)`,
                        width: '14px', height: '14px', borderRadius: '50%',
                        background: scoreColor(s),
                        border: '2.5px solid #0d1117',
                        boxShadow: `0 0 10px ${scoreColor(s)}88`,
                      }} />
                    </div>

                    {/* breakdown */}
                    {bd && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                        {[
                          { key: 'News',      pts: bd.news,       max: 40, reason: bd.reasons[0] },
                          { key: 'SEC',       pts: bd.sec,        max: 35, reason: bd.reasons[1] },
                          { key: 'Signal',    pts: bd.mispricing, max: 25, reason: bd.reasons[2] },
                        ].map(({ key, pts, max, reason }, i, arr) => (
                          <div key={key} style={{
                            padding: '10px 0',
                            borderBottom: i < arr.length - 1 ? '1px solid #141920' : 'none',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498' }}>{key.toUpperCase()}</span>
                              <span style={{ fontSize: '12px', fontWeight: 600, color: '#c9d1d9' }}>{pts}<span style={{ color: '#7b8498', fontWeight: 400 }}>/{max}</span></span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#7b8498', lineHeight: 1.5 }}>{reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>

            {/* fair value & valuation */}
            <div style={card}>
              <p style={sectionTitle}>Fair Value &amp; Valuation</p>
              {loadingValuation ? (
                <div style={{ height: '130px', borderRadius: '8px', background: '#1a1f2a', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ) : !valuation ? (
                <p style={{ color: '#7b8498', fontSize: '14px', margin: 0 }}>Valuation data unavailable.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>

                  {/* signal badge */}
                  {valuation.signal && (() => {
                    const sigColor =
                      valuation.signal === 'undervalued' ? '#3fb950' :
                      valuation.signal === 'overvalued'  ? '#f85149' : '#d29922'
                    return (
                      <div style={{ marginBottom: '20px' }}>
                        <span style={{
                          fontSize: '12px', fontWeight: 600, padding: '4px 12px',
                          borderRadius: '20px', textTransform: 'uppercase' as const,
                          letterSpacing: '0.8px', color: sigColor,
                          border: `1px solid ${sigColor}33`, background: `${sigColor}11`,
                        }}>
                          {valuation.signal}
                        </span>
                      </div>
                    )
                  })()}

                  {/* analyst target row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #141920' }}>
                    <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498' }}>ANALYST TARGET</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
                        {valuation.analystTarget != null ? fmt$(valuation.analystTarget) : '—'}
                      </span>
                      {valuation.analystGap != null && (
                        <span style={{
                          fontSize: '12px', fontWeight: 600,
                          color: valuation.analystGap >= 0 ? '#3fb950' : '#f85149',
                        }}>
                          {valuation.analystGap >= 0 ? '+' : ''}{valuation.analystGap}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* current price row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #141920' }}>
                    <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498' }}>CURRENT PRICE</span>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>
                      {valuation.currentPrice != null ? fmt$(valuation.currentPrice) : '—'}
                    </span>
                  </div>

                  {/* 52-week range bar */}
                  <div style={{ padding: '14px 0', borderBottom: '1px solid #141920' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498' }}>52-WEEK RANGE</span>
                      {valuation.weekRange52Position != null && (
                        <span style={{ fontSize: '11px', color: '#7b8498' }}>{valuation.weekRange52Position}% of range</span>
                      )}
                    </div>
                    <div style={{ position: 'relative', height: '5px', borderRadius: '3px', background: '#1e2530' }}>
                      {valuation.weekRange52Position != null && (
                        <div style={{
                          position: 'absolute', top: '-4px',
                          left: `calc(${Math.min(100, Math.max(0, valuation.weekRange52Position))}% - 6px)`,
                          width: '13px', height: '13px', borderRadius: '50%',
                          background: '#9ecbff', border: '2px solid #0d1117',
                        }} />
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                      <span style={{ fontSize: '11px', color: '#7b8498' }}>{fmt$(q?.fiftyTwoWeekLow)}</span>
                      <span style={{ fontSize: '11px', color: '#7b8498' }}>{fmt$(q?.fiftyTwoWeekHigh)}</span>
                    </div>
                  </div>

                  {/* recommendation row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                    <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498' }}>ANALYST REC.</span>
                    {valuation.recommendation ? (() => {
                      const recColor =
                        valuation.recommendation === 'Strong Buy' ? '#3fb950' :
                        valuation.recommendation === 'Buy'        ? '#52d175' :
                        valuation.recommendation === 'Hold'       ? '#d29922' :
                        valuation.recommendation === 'Sell'       ? '#f85149' : '#f85149'
                      return (
                        <span style={{ fontSize: '13px', fontWeight: 600, color: recColor }}>
                          {valuation.recommendation}
                        </span>
                      )
                    })() : <span style={{ fontSize: '13px', color: '#7b8498' }}>—</span>}
                  </div>

                </div>
              )}
            </div>

            {/* SEC filings */}
            <div style={card}>
              <p style={sectionTitle}>SEC Filings & Events</p>
              {events.length === 0 ? (
                <p style={{ color: '#7b8498', fontSize: '14px', margin: 0 }}>
                  No recent filings for {ticker}.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {events.map((ev, i) => {
                    const items = parseItems(ev.raw_text)
                    const borderColor = itemBorderColor(items)
                    const visibleItems = items.slice(0, 3)

                    return (
                      <div
                        key={ev.id}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: '16px',
                          padding: '14px 0 14px 16px',
                          borderLeft: `3px solid ${borderColor}`,
                          marginLeft: '-24px', paddingLeft: '21px',
                          borderBottom: i < events.length - 1 ? '1px solid #141920' : 'none',
                        }}
                      >
                        {/* date */}
                        <div style={{ color: '#7b8498', fontSize: '12px', whiteSpace: 'nowrap', minWidth: '72px', paddingTop: '2px' }}>
                          {fmtDate(ev.published_at)}
                        </div>

                        {/* title + tags */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: '#c9d1d9', marginBottom: '6px', lineHeight: 1.3 }}>
                            {ev.title.replace(/^8-K — /, '')}
                          </div>
                          {visibleItems.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {visibleItems.map((code) => (
                                <span
                                  key={code}
                                  style={{
                                    fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
                                    background: '#151c28', border: '1px solid #1e2a3a',
                                    color: '#9ecbff', letterSpacing: '0.3px',
                                  }}
                                >
                                  {code} · {ITEM_LABELS[code] ?? code}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* link */}
                        {ev.source_url && (
                          <a
                            href={ev.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: '#7b8498', fontSize: '12px', textDecoration: 'none',
                              whiteSpace: 'nowrap', paddingTop: '2px',
                              transition: 'color 0.15s',
                            }}
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
              )}
            </div>

            {/* recent news */}
            <div style={card}>
              <p style={sectionTitle}>Recent News</p>
              {loadingNews ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} style={{ height: '52px', borderRadius: '6px', background: '#1a1f2a', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  ))}
                </div>
              ) : news.length === 0 ? (
                <p style={{ color: '#7b8498', fontSize: '14px', margin: 0 }}>No recent news for {ticker}.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                  {news.map((article, i) => {
                    let source = ''
                    let sentiment: string = article.summary ?? 'neutral'
                    try {
                      const raw = JSON.parse(article.raw_text ?? '{}')
                      source = raw.source ?? ''
                      sentiment = raw.sentiment ?? sentiment
                    } catch { /* ok */ }

                    const sentimentColor =
                      sentiment === 'bullish' ? '#3fb950'
                      : sentiment === 'bearish' ? '#f85149'
                      : '#7b8498'

                    const pubDate = article.published_at ? new Date(article.published_at) : null
                    const relTime = pubDate ? (() => {
                      const diffMs = Date.now() - pubDate.getTime()
                      const diffH = Math.floor(diffMs / 3600000)
                      if (diffH < 1) return `${Math.floor(diffMs / 60000)}m ago`
                      if (diffH < 24) return `${diffH}h ago`
                      return `${Math.floor(diffH / 24)}d ago`
                    })() : ''

                    return (
                      <div
                        key={article.id}
                        style={{
                          padding: '14px 0 14px 16px',
                          borderLeft: `3px solid ${sentimentColor}`,
                          marginLeft: '-24px', paddingLeft: '21px',
                          borderBottom: i < news.length - 1 ? '1px solid #141920' : 'none',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', fontWeight: 500, color: '#c9d1d9', lineHeight: 1.4, marginBottom: '6px' }}>
                              {article.title}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {source && <span style={{ fontSize: '11px', color: '#7b8498' }}>{source}</span>}
                              {source && relTime && <span style={{ fontSize: '11px', color: '#3a4a60' }}>·</span>}
                              {relTime && <span style={{ fontSize: '11px', color: '#7b8498' }}>{relTime}</span>}
                              <span style={{
                                fontSize: '10px', padding: '1px 7px', borderRadius: '4px',
                                background: `${sentimentColor}14`, border: `1px solid ${sentimentColor}30`,
                                color: sentimentColor, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                              }}>
                                {sentiment}
                              </span>
                            </div>
                          </div>
                          {article.source_url && (
                            <a
                              href={article.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#7b8498', fontSize: '12px', textDecoration: 'none', whiteSpace: 'nowrap', paddingTop: '2px', transition: 'color 0.15s' }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = '#9ecbff')}
                              onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}
                            >
                              View →
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

          </div>

          {/* ── RIGHT COLUMN ────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* company overview */}
            <div style={card}>
              <p style={sectionTitle}>Company Overview</p>

              {/* description */}
              {summary && (
                <div style={{ marginBottom: '20px' }}>
                  <p style={{
                    color: '#c9d1d9', fontSize: '13px', lineHeight: 1.7, margin: 0,
                    display: showFullSummary ? 'block' : '-webkit-box',
                    WebkitLineClamp: showFullSummary ? undefined : 4,
                    WebkitBoxOrient: 'vertical' as any,
                    overflow: showFullSummary ? 'visible' : 'hidden',
                  }}>
                    {summary}
                  </p>
                  {summary.length > SUMMARY_LIMIT && (
                    <button
                      onClick={() => setShowFullSummary((v) => !v)}
                      style={{
                        background: 'none', border: 'none', color: '#9ecbff',
                        fontSize: '12px', cursor: 'pointer', padding: '6px 0 0',
                      }}
                    >
                      {showFullSummary ? 'Show less ↑' : 'Show more ↓'}
                    </button>
                  )}
                </div>
              )}

              {/* meta rows */}
              {[
                { label: 'CEO', value: ceo?.name ?? '—' },
                { label: 'Industry', value: s?.assetProfile?.industry ?? '—' },
                { label: 'HQ', value: hq || '—' },
                { label: 'Employees', value: s?.assetProfile?.fullTimeEmployees ? s.assetProfile.fullTimeEmployees.toLocaleString() : '—' },
                {
                  label: 'Website',
                  value: s?.assetProfile?.website ?? null,
                  link: true,
                },
              ].map(({ label: lbl, value, link }) => (
                <div
                  key={lbl}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    padding: '9px 0', borderBottom: '1px solid #141920', gap: '12px',
                  }}
                >
                  <span style={{ color: '#7b8498', fontSize: '13px', flexShrink: 0 }}>{lbl}</span>
                  {link && value ? (
                    <a
                      href={value as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#9ecbff', fontSize: '13px', textDecoration: 'none', textAlign: 'right', wordBreak: 'break-all' }}
                    >
                      {(value as string).replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  ) : (
                    <span style={{ color: '#c9d1d9', fontSize: '13px', textAlign: 'right' }}>{value as string}</span>
                  )}
                </div>
              ))}
            </div>

            {/* key statistics */}
            <div style={card}>
              <p style={sectionTitle}>Key Statistics</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
                {[
                  { label: 'P/E Ratio', value: s?.defaultKeyStatistics?.forwardPE ? s.defaultKeyStatistics.forwardPE.toFixed(1) : (s?.defaultKeyStatistics?.trailingPE ? s.defaultKeyStatistics.trailingPE.toFixed(1) : '—') },
                  { label: 'EPS (TTM)', value: s?.defaultKeyStatistics?.trailingEps ? fmt$(s.defaultKeyStatistics.trailingEps) : '—' },
                  { label: 'Revenue', value: fmtLarge(s?.financialData?.totalRevenue) },
                  { label: 'Net Income', value: fmtLarge(s?.financialData?.netIncomeToCommon) },
                  { label: 'Div Yield', value: s?.defaultKeyStatistics?.dividendYield ? fmtPct(s.defaultKeyStatistics.dividendYield) : (s?.defaultKeyStatistics?.trailingAnnualDividendYield ? fmtPct(s.defaultKeyStatistics.trailingAnnualDividendYield) : '—') },
                  { label: 'Beta', value: s?.defaultKeyStatistics?.beta ? s.defaultKeyStatistics.beta.toFixed(2) : '—' },
                ].map(({ label: lbl, value }, i) => (
                  <div
                    key={lbl}
                    style={{
                      padding: '12px 0',
                      borderBottom: i < 4 ? '1px solid #141920' : 'none',
                      borderRight: i % 2 === 0 ? '1px solid #141920' : 'none',
                      paddingRight: i % 2 === 0 ? '16px' : '0',
                      paddingLeft: i % 2 === 1 ? '16px' : '0',
                    }}
                  >
                    <div style={label}>{lbl}</div>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: '#e6edf3' }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── related tickers ─────────────────────────────────────────────────── */}
        {related.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <p style={{ ...sectionTitle, marginBottom: '12px' }}>You May Also Like</p>
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
              {related.map((r) => (
                <a
                  key={r.symbol}
                  href={`/t/${r.symbol}`}
                  style={{
                    ...card,
                    flexShrink: 0,
                    width: '160px',
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'border-color 0.15s',
                    display: 'block',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#3a4a60')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#1e2530')}
                >
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#e6edf3', marginBottom: '4px' }}>
                    {r.symbol}
                  </div>
                  <div style={{ fontSize: '12px', color: '#7b8498', marginBottom: '8px', lineHeight: 1.3,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
                    {r.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#7b8498' }}>
                    {fmtLarge(r.market_cap)}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
