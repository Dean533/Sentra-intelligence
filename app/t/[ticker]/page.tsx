'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { MarketRange } from '@/lib/marketData'
import MispricingWidget from '@/app/components/MispricingWidget'

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

  const sec: React.CSSProperties = {
    padding: '40px 0',
    borderBottom: '1px solid #1e2530',
  }

  const secTitle: React.CSSProperties = {
    fontSize: '11px',
    letterSpacing: '2px',
    color: '#7b8498',
    textTransform: 'uppercase' as const,
    margin: '0 0 24px',
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

        {/* ── 2. MISPRICING WIDGET — full width ───────────────────────────────── */}
        <div style={{ padding: '32px 0', borderBottom: '1px solid #1e2530' }}>
          <MispricingWidget ticker={ticker} />
        </div>

        {/* ── 3. COMPANY INFO ROW ─────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1.5fr', ...sec, gap: '0' }}>

          {/* left — description */}
          <div style={{ paddingRight: '48px', borderRight: '1px solid #1e2530' }}>
            <p style={secTitle}>Company Overview</p>
            {summary ? (
              <>
                <p style={{
                  color: '#c9d1d9', fontSize: '14px', lineHeight: 1.8, margin: 0,
                  display: showFullSummary ? 'block' : '-webkit-box',
                  WebkitLineClamp: showFullSummary ? undefined : 8,
                  WebkitBoxOrient: 'vertical' as any,
                  overflow: showFullSummary ? 'visible' : 'hidden',
                }}>
                  {summary}
                </p>
                {summary.length > SUMMARY_LIMIT && (
                  <button
                    onClick={() => setShowFullSummary((v) => !v)}
                    style={{ background: 'none', border: 'none', color: '#9ecbff', fontSize: '12px', cursor: 'pointer', padding: '10px 0 0', letterSpacing: '0.5px' }}
                  >
                    {showFullSummary ? 'Show less ↑' : 'Show more ↓'}
                  </button>
                )}
              </>
            ) : (
              <p style={{ color: '#7b8498', fontSize: '14px', margin: 0 }}>No description available.</p>
            )}
          </div>

          {/* middle — company details */}
          <div style={{ padding: '0 40px', borderRight: '1px solid #1e2530' }}>
            <p style={secTitle}>Company Details</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {[
                { lbl: 'CEO',      val: ceo?.name ?? null },
                { lbl: 'Industry', val: s?.assetProfile?.industry ?? null },
                { lbl: 'Sector',   val: sector },
                { lbl: 'HQ',       val: hq || null },
                { lbl: 'Employees',val: s?.assetProfile?.fullTimeEmployees ? s.assetProfile.fullTimeEmployees.toLocaleString() : null },
                { lbl: 'Website',  val: s?.assetProfile?.website ?? null, link: true },
              ].filter(({ val }) => val != null).map(({ lbl, val, link }, i, arr) => (
                <div key={lbl} style={{ padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid #141920' : 'none' }}>
                  <div style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#7b8498', marginBottom: '4px', textTransform: 'uppercase' as const }}>{lbl}</div>
                  {link ? (
                    <a href={val as string} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#9ecbff', fontSize: '13px', textDecoration: 'none', wordBreak: 'break-all', display: 'block' }}>
                      {(val as string).replace(/^https?:\/\/(www\.)?/, '')}
                    </a>
                  ) : (
                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#e6edf3', lineHeight: 1.3 }}>{val as string}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* right — key statistics */}
          <div style={{ paddingLeft: '40px' }}>
            <p style={secTitle}>Key Statistics</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0' }}>
              {[
                { lbl: 'P/E Ratio',  val: s?.defaultKeyStatistics?.forwardPE ? s.defaultKeyStatistics.forwardPE.toFixed(1) : (s?.defaultKeyStatistics?.trailingPE ? s.defaultKeyStatistics.trailingPE.toFixed(1) : '—') },
                { lbl: 'EPS (TTM)',  val: s?.defaultKeyStatistics?.trailingEps ? fmt$(s.defaultKeyStatistics.trailingEps) : '—' },
                { lbl: 'Revenue',    val: fmtLarge(s?.financialData?.totalRevenue) },
                { lbl: 'Net Income', val: fmtLarge(s?.financialData?.netIncomeToCommon) },
                { lbl: 'Div Yield',  val: s?.defaultKeyStatistics?.dividendYield ? fmtPct(s.defaultKeyStatistics.dividendYield) : (s?.defaultKeyStatistics?.trailingAnnualDividendYield ? fmtPct(s.defaultKeyStatistics.trailingAnnualDividendYield) : '—') },
                { lbl: 'Beta',       val: s?.defaultKeyStatistics?.beta ? s.defaultKeyStatistics.beta.toFixed(2) : '—' },
                { lbl: 'Market Cap', val: fmtLarge(q?.marketCap) },
                { lbl: '52W High',   val: fmt$(q?.fiftyTwoWeekHigh) },
                { lbl: '52W Low',    val: fmt$(q?.fiftyTwoWeekLow) },
              ].map(({ lbl, val }, i, arr) => (
                <div key={lbl} style={{
                  padding: '10px 0',
                  borderBottom: i < arr.length - 2 ? '1px solid #141920' : 'none',
                  borderRight: i % 2 === 0 ? '1px solid #141920' : 'none',
                  paddingRight: i % 2 === 0 ? '16px' : '0',
                  paddingLeft:  i % 2 === 1 ? '16px' : '0',
                }}>
                  <div style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#7b8498', marginBottom: '4px', textTransform: 'uppercase' as const }}>{lbl}</div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#e6edf3' }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── 4. FILINGS + NEWS ROW ───────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '64px', ...sec }}>

          {/* recent filings */}
          <div>
            <p style={secTitle}>Recent Filings</p>
            {events.length === 0 ? (
              <p style={{ color: '#7b8498', fontSize: '14px', margin: 0 }}>No recent filings for {ticker}.</p>
            ) : (
              <div>
                {events.map((ev, i) => {
                  const items = parseItems(ev.raw_text)
                  const borderColor = itemBorderColor(items)
                  const visibleItems = items.slice(0, 3)
                  return (
                    <div key={ev.id} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '16px',
                      padding: '14px 0 14px 16px',
                      borderLeft: `3px solid ${borderColor}`,
                      marginLeft: '-16px', paddingLeft: '13px',
                      borderBottom: i < events.length - 1 ? '1px solid #141920' : 'none',
                    }}>
                      <div style={{ color: '#7b8498', fontSize: '12px', whiteSpace: 'nowrap', minWidth: '72px', paddingTop: '2px' }}>
                        {fmtDate(ev.published_at)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: 500, color: '#c9d1d9', marginBottom: '6px', lineHeight: 1.3 }}>
                          {ev.title.replace(/^8-K — /, '')}
                        </div>
                        {visibleItems.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {visibleItems.map((code) => (
                              <span key={code} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#151c28', border: '1px solid #1e2a3a', color: '#9ecbff', letterSpacing: '0.3px' }}>
                                {code} · {ITEM_LABELS[code] ?? code}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {ev.source_url && (
                        <a href={ev.source_url} target="_blank" rel="noopener noreferrer"
                          style={{ color: '#7b8498', fontSize: '12px', textDecoration: 'none', whiteSpace: 'nowrap', paddingTop: '2px', transition: 'color 0.15s' }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#9ecbff')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}>
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
          <div>
            <p style={secTitle}>Recent News</p>
            {loadingNews ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} style={{ height: '52px', borderRadius: '6px', background: '#1a1f2a', animation: 'pulse 1.5s ease-in-out infinite' }} />
                ))}
              </div>
            ) : news.length === 0 ? (
              <p style={{ color: '#7b8498', fontSize: '14px', margin: 0 }}>No recent news for {ticker}.</p>
            ) : (
              <div>
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
                    <div key={article.id} style={{
                      padding: '14px 0 14px 16px',
                      borderLeft: `3px solid ${sentimentColor}`,
                      marginLeft: '-16px', paddingLeft: '13px',
                      borderBottom: i < news.length - 1 ? '1px solid #141920' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: 500, color: '#c9d1d9', lineHeight: 1.4, marginBottom: '6px' }}>
                            {article.title}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {source && <span style={{ fontSize: '11px', color: '#7b8498' }}>{source}</span>}
                            {source && relTime && <span style={{ fontSize: '11px', color: '#3a4a60' }}>·</span>}
                            {relTime && <span style={{ fontSize: '11px', color: '#7b8498' }}>{relTime}</span>}
                            <span style={{ fontSize: '10px', padding: '1px 7px', borderRadius: '4px', background: `${sentimentColor}14`, border: `1px solid ${sentimentColor}30`, color: sentimentColor, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                              {sentiment}
                            </span>
                          </div>
                        </div>
                        {article.source_url && (
                          <a href={article.source_url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#7b8498', fontSize: '12px', textDecoration: 'none', whiteSpace: 'nowrap', paddingTop: '2px', transition: 'color 0.15s' }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#9ecbff')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}>
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

        {/* ── 5. YOU MAY ALSO LIKE ────────────────────────────────────────────── */}
        {related.length > 0 && (
          <div style={{ padding: '40px 0' }}>
            <p style={{ ...secTitle, marginBottom: '20px' }}>You May Also Like</p>
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
              {related.map((r) => (
                <a key={r.symbol} href={`/t/${r.symbol}`} style={{
                  ...card, flexShrink: 0, width: '160px',
                  textDecoration: 'none', color: 'inherit',
                  transition: 'border-color 0.15s', display: 'block',
                }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#3a4a60')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#1e2530')}
                >
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#e6edf3', marginBottom: '4px' }}>{r.symbol}</div>
                  <div style={{ fontSize: '12px', color: '#7b8498', marginBottom: '8px', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>{r.name}</div>
                  <div style={{ fontSize: '11px', color: '#7b8498' }}>{fmtLarge(r.market_cap)}</div>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

