'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import BackButton from '@/app/components/BackButton'

// ─── Types ────────────────────────────────────────────────────────────────────

type Transaction = {
  id: string
  ticker: string
  insider_name: string
  officer_title: string | null
  transaction_date: string
  total_value: number | null
  shares: number | null
  price_per_share: number | null
  price_on_day: number | null
  price_1d: number | null
  price_3d: number | null
  price_5d: number | null
  price_10d: number | null
  actual_return_5d: number | null
  adjusted_return_5d: number | null
  spy_return_5d: number | null
  fundamental_score: number | null
  gap_score: number | null
  purchase_pct_market_cap: number | null
  accession_number: string | null
  source_url: string | null
  filed_date: string | null
}

type SentimentEntry = {
  score: number
  label: string
  scored_at: string
  headline: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtValue(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function fmtShares(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function gapColor(score: number): string {
  if (score >= 70) return '#e24d39'
  if (score >= 50) return '#d29922'
  return '#7b8498'
}

function gapSignalLabel(score: number): string {
  if (score >= 70) return 'HIGH SIGNAL'
  if (score >= 50) return 'MODERATE SIGNAL'
  return 'WEAK SIGNAL'
}

function expectedRange(fs: number | null): { label: string; mid: number } {
  if (fs == null) return { label: '+1% to +3%', mid: 2 }
  if (fs >= 70) return { label: '+4% to +8%', mid: 6 }
  if (fs >= 50) return { label: '+2% to +5%', mid: 3.5 }
  if (fs >= 30) return { label: '+1% to +3%', mid: 2 }
  return { label: '+0.5% to +2%', mid: 1.25 }
}

function convictionFromTitle(title: string | null): 'HIGH' | 'MEDIUM' | 'LOW' {
  const t = (title ?? '').toLowerCase()
  if (
    t.includes('chief executive') || t.includes('ceo') ||
    t.includes('president') || t.includes('chairman') ||
    t.includes('co-chief') || t.includes('co chief')
  ) return 'HIGH'
  if (
    t.includes('chief financial') || t.includes('cfo') ||
    t.includes('chief operating') || t.includes('coo') ||
    t.includes('chief technology') || t.includes('cto') ||
    t.includes(' svp') || t.includes('senior vice') ||
    t.includes(' vp ') || t.includes('vice president')
  ) return 'MEDIUM'
  return 'LOW'
}

function convictionColor(level: 'HIGH' | 'MEDIUM' | 'LOW'): string {
  if (level === 'HIGH') return '#3fb950'
  if (level === 'MEDIUM') return '#d29922'
  return '#7b8498'
}

function sentimentColor(label: string): string {
  if (label === 'bullish') return '#3fb950'
  if (label === 'bearish') return '#f85149'
  return '#7b8498'
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const sectionLabel: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '2px',
  color: '#7b8498',
  textTransform: 'uppercase',
  marginBottom: '20px',
}

const statLabel: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '1.5px',
  color: '#7b8498',
  marginBottom: '5px',
  textTransform: 'uppercase',
}

const divider: React.CSSProperties = {
  height: '1px',
  background: '#1e2530',
  margin: '28px 0',
}

const card: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #1e2530',
  borderRadius: '12px',
  padding: '28px',
}

// ─── Bar Visualization ────────────────────────────────────────────────────────

function ReturnBar({ label, value, maxAbs, color }: { label: string; value: number | null; maxAbs: number; color: string }) {
  const pct = value == null ? 0 : (Math.abs(value) / maxAbs) * 100
  const isNeg = (value ?? 0) < 0
  return (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
        <span style={{ fontSize: '12px', color: '#7b8498', letterSpacing: '1px', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color }}>{fmtPct(value)}</span>
      </div>
      <div style={{ height: '6px', background: '#1a1f2a', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${Math.min(pct, 100)}%`,
          background: isNeg ? '#f85149' : color,
          borderRadius: '3px',
          transition: 'width 0.4s ease',
        }} />
      </div>
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function Skeleton({ width, height }: { width?: string; height?: string }) {
  return (
    <div style={{
      width: width ?? '100%',
      height: height ?? '16px',
      background: '#1a1f2a',
      borderRadius: '4px',
      animation: 'pulse 1.5s ease-in-out infinite',
    }} />
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [tx, setTx] = useState<Transaction | null>(null)
  const [sentiment, setSentiment] = useState<SentimentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    if (!id) return
    fetch(`/api/events/${id}`)
      .then(async (r) => {
        if (r.status === 404) { setNotFound(true); return }
        const d = await r.json()
        setTx(d.transaction ?? null)
        setSentiment(d.sentiment ?? [])
      })
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#070b10', padding: '40px 24px', maxWidth: '780px', margin: '0 auto', fontFamily: 'Arial, sans-serif' }}>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
        <div style={{ marginBottom: '32px' }}>
          <Skeleton width="120px" height="14px" />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '36px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Skeleton width="80px" height="28px" />
            <Skeleton width="200px" height="16px" />
          </div>
          <Skeleton width="100px" height="60px" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} style={{ ...card, marginBottom: '16px' }}>
            <Skeleton width="100px" height="11px" />
            <div style={{ marginTop: '20px', display: 'flex', gap: '16px' }}>
              <Skeleton height="48px" />
              <Skeleton height="48px" />
              <Skeleton height="48px" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (notFound || !tx) {
    return (
      <div style={{ minHeight: '100vh', background: '#070b10', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', fontWeight: 800, color: '#1e2530', marginBottom: '16px' }}>404</div>
          <div style={{ fontSize: '16px', color: '#7b8498', marginBottom: '24px' }}>Event not found</div>
          <BackButton label="Back to Events" href="/events" />
        </div>
      </div>
    )
  }

  const gap = tx.gap_score ?? 0
  const gc = gapColor(gap)
  const fs = tx.fundamental_score ?? 0
  const { label: expLabel, mid: expMid } = expectedRange(tx.fundamental_score)
  const conviction = convictionFromTitle(tx.officer_title)
  const cc = convictionColor(conviction)

  const actualRet = tx.adjusted_return_5d
  const maxAbs = Math.max(Math.abs(actualRet ?? 0), Math.abs(expMid), 1)

  // Sentiment stats
  const avgScore = sentiment.length > 0
    ? sentiment.reduce((s, e) => s + e.score, 0) / sentiment.length
    : null
  const bullishCount = sentiment.filter((e) => e.label === 'bullish').length
  const bearishCount = sentiment.filter((e) => e.label === 'bearish').length
  const neutralCount = sentiment.filter((e) => e.label === 'neutral').length

  // Gap explanation
  const gapExplain = (() => {
    const direction = (actualRet ?? 0) < expMid ? 'underperformed' : 'outperformed'
    const magnitude = gap >= 70 ? 'significantly' : gap >= 50 ? 'moderately' : 'slightly'
    return `An insider at ${tx.ticker} placed a notable buy on ${fmtDate(tx.transaction_date)}. Based on the company's fundamentals — including purchase size relative to market cap and the seniority of the buyer — Sentra's model expected the stock to return ${expLabel} over the following 5 days. The stock ${direction} that expectation ${magnitude}, returning ${fmtPct(actualRet)} after stripping out market noise. The gap score of ${gap}/100 reflects how large that divergence is: a higher score means a wider gap between insider confidence and market pricing, and a stronger potential opportunity.`
  })()

  return (
    <div style={{ minHeight: '100vh', background: '#070b10', fontFamily: 'Arial, sans-serif', color: '#c9d1d9' }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ borderBottom: '1px solid #1e2530', padding: '20px 24px' }}>
        <div style={{ maxWidth: '780px', margin: '0 auto' }}>
          <BackButton label="Back to Events" href="/events" />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '15px', fontWeight: 800, letterSpacing: '1px',
                  color: gc, padding: '4px 12px',
                  borderRadius: '6px', border: `1px solid ${gc}44`,
                  background: `${gc}11`,
                }}>
                  {tx.ticker}
                </span>
                <span style={{
                  fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px',
                  color: '#9ecbff', padding: '3px 10px',
                  borderRadius: '4px', border: '1px solid #9ecbff33',
                  background: '#9ecbff11', textTransform: 'uppercase',
                }}>
                  Insider Buy
                </span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', marginBottom: '6px' }}>
                {tx.insider_name}
              </div>
              <div style={{ fontSize: '13px', color: '#7b8498' }}>
                {tx.officer_title ?? 'Insider'} · {fmtDate(tx.transaction_date)}
              </div>
            </div>

            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498', marginBottom: '4px', textTransform: 'uppercase' }}>
                Gap Score
              </div>
              <div style={{ fontSize: '52px', fontWeight: 800, lineHeight: 1, color: gc }}>
                {gap}
                <span style={{ fontSize: '20px', fontWeight: 400, color: '#3a4a5a' }}>/100</span>
              </div>
              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', color: gc, marginTop: '6px' }}>
                {gapSignalLabel(gap)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BODY ───────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: '780px', margin: '0 auto', padding: '32px 24px' }}>

        {/* SECTION 1 — PRICE REACTION */}
        <div style={card}>
          <div style={sectionLabel}>Price Reaction</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0', borderTop: '1px solid #1e2530', borderBottom: '1px solid #1e2530', marginBottom: '28px' }}>
            <div style={{ padding: '20px 16px 20px 0', borderRight: '1px solid #1e2530' }}>
              <div style={statLabel}>Stock moved after buy</div>
              <div style={{
                fontSize: '24px', fontWeight: 800,
                color: tx.actual_return_5d != null && tx.actual_return_5d < 0 ? '#f85149' : '#3fb950',
              }}>
                {fmtPct(tx.actual_return_5d)}
              </div>
              <div style={{ fontSize: '11px', color: '#3a4a5a', marginTop: '4px' }}>5-day raw return</div>
            </div>

            <div style={{ padding: '20px 16px', borderRight: '1px solid #1e2530' }}>
              <div style={statLabel}>Stripped of market noise</div>
              <div style={{
                fontSize: '24px', fontWeight: 800,
                color: tx.adjusted_return_5d != null && tx.adjusted_return_5d < 0 ? '#f85149' : '#3fb950',
              }}>
                {fmtPct(tx.adjusted_return_5d)}
              </div>
              <div style={{ fontSize: '11px', color: '#3a4a5a', marginTop: '4px' }}>vs. SPY adjusted</div>
            </div>

            <div style={{ padding: '20px 0 20px 16px' }}>
              <div style={statLabel}>What Sentra expected</div>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#3fb950' }}>
                {expLabel}
              </div>
              <div style={{ fontSize: '11px', color: '#3a4a5a', marginTop: '4px' }}>
                based on fs {fs}/100
              </div>
            </div>
          </div>

          <ReturnBar
            label="Actual (adjusted)"
            value={actualRet}
            maxAbs={maxAbs}
            color={actualRet != null && actualRet < 0 ? '#f85149' : '#3fb950'}
          />
          <ReturnBar
            label="Expected (midpoint)"
            value={expMid}
            maxAbs={maxAbs}
            color="#9ecbff"
          />
        </div>

        <div style={divider} />

        {/* SECTION 2 — INSIDER SIGNAL */}
        <div style={card}>
          <div style={sectionLabel}>Insider Signal</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#e6edf3' }}>{tx.insider_name}</div>
              <div style={{ fontSize: '13px', color: '#7b8498', marginTop: '3px' }}>{tx.officer_title ?? 'Insider'}</div>
            </div>
            <span style={{
              fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
              color: cc, padding: '3px 10px',
              borderRadius: '20px', border: `1px solid ${cc}33`,
              background: `${cc}11`, marginLeft: 'auto',
            }}>
              {conviction} CONVICTION
            </span>
          </div>

          <div style={{ height: '1px', background: '#1e2530', marginBottom: '20px' }} />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px', marginBottom: '20px' }}>
            <div>
              <div style={statLabel}>Shares purchased</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#e6edf3' }}>{fmtShares(tx.shares)}</div>
            </div>
            <div>
              <div style={statLabel}>Price per share</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#e6edf3' }}>{fmtPrice(tx.price_per_share)}</div>
            </div>
            <div>
              <div style={statLabel}>Total value</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#e6edf3' }}>{fmtValue(tx.total_value)}</div>
            </div>
            <div>
              <div style={statLabel}>% of market cap</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: tx.purchase_pct_market_cap != null && tx.purchase_pct_market_cap > 0.1 ? '#d29922' : '#e6edf3' }}>
                {tx.purchase_pct_market_cap != null ? `${tx.purchase_pct_market_cap.toFixed(3)}%` : '—'}
              </div>
            </div>
          </div>

          {tx.source_url && (
            <>
              <div style={{ height: '1px', background: '#1e2530', marginBottom: '16px' }} />
              <a
                href={tx.source_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: '13px', color: '#9ecbff', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
              >
                View SEC Filing →
              </a>
              {tx.filed_date && (
                <span style={{ fontSize: '12px', color: '#3a4a5a', marginLeft: '12px' }}>
                  Filed {fmtDate(tx.filed_date)}
                </span>
              )}
            </>
          )}
        </div>

        <div style={divider} />

        {/* SECTION 3 — NARRATIVE SIGNAL */}
        <div style={card}>
          <div style={sectionLabel}>Narrative Signal</div>

          {sentiment.length === 0 ? (
            <div style={{ color: '#3a4a5a', fontSize: '14px', padding: '8px 0' }}>
              No recent narrative data for {tx.ticker}.
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0', borderTop: '1px solid #1e2530', borderBottom: '1px solid #1e2530', marginBottom: '24px' }}>
                <div style={{ padding: '18px 16px 18px 0', borderRight: '1px solid #1e2530' }}>
                  <div style={statLabel}>Avg score</div>
                  <div style={{
                    fontSize: '22px', fontWeight: 800,
                    color: avgScore != null && avgScore > 0 ? '#3fb950' : avgScore != null && avgScore < 0 ? '#f85149' : '#7b8498',
                  }}>
                    {avgScore != null ? (avgScore > 0 ? '+' : '') + avgScore.toFixed(2) : '—'}
                  </div>
                </div>
                <div style={{ padding: '18px 16px', borderRight: '1px solid #1e2530' }}>
                  <div style={statLabel}>Bullish</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#3fb950' }}>{bullishCount}</div>
                </div>
                <div style={{ padding: '18px 16px', borderRight: '1px solid #1e2530' }}>
                  <div style={statLabel}>Neutral</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#7b8498' }}>{neutralCount}</div>
                </div>
                <div style={{ padding: '18px 0 18px 16px' }}>
                  <div style={statLabel}>Bearish</div>
                  <div style={{ fontSize: '22px', fontWeight: 800, color: '#f85149' }}>{bearishCount}</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {sentiment.map((entry, i) => {
                  const sc = sentimentColor(entry.label)
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '12px',
                      padding: '12px 14px',
                      background: '#0a0e14',
                      border: `1px solid #1e2530`,
                      borderLeft: `3px solid ${sc}`,
                      borderRadius: '6px',
                    }}>
                      <span style={{
                        fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
                        color: sc, minWidth: '56px', paddingTop: '1px',
                        textTransform: 'uppercase',
                      }}>
                        {entry.label}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5 }}>
                          {entry.headline ?? '(no headline)'}
                        </div>
                        <div style={{ fontSize: '11px', color: '#3a4a5a', marginTop: '4px' }}>
                          {fmtDate(entry.scored_at)}
                          {' · score: '}
                          <span style={{ color: sc }}>{entry.score > 0 ? '+' : ''}{entry.score.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div style={divider} />

        {/* SECTION 4 — GAP ANALYSIS */}
        <div style={card}>
          <div style={sectionLabel}>Gap Analysis</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0a0e14', borderRadius: '8px', border: '1px solid #1e2530' }}>
              <span style={{ fontSize: '13px', color: '#7b8498', letterSpacing: '0.5px' }}>Fundamental Score</span>
              <span style={{ fontSize: '20px', fontWeight: 800, color: '#9ecbff' }}>
                {fs}
                <span style={{ fontSize: '13px', fontWeight: 400, color: '#3a4a5a' }}>/100</span>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0a0e14', borderRadius: '8px', border: '1px solid #1e2530' }}>
              <span style={{ fontSize: '13px', color: '#7b8498', letterSpacing: '0.5px' }}>Market Reaction (adjusted)</span>
              <span style={{
                fontSize: '20px', fontWeight: 800,
                color: tx.adjusted_return_5d != null && tx.adjusted_return_5d < 0 ? '#f85149' : '#3fb950',
              }}>
                {fmtPct(tx.adjusted_return_5d)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: `${gc}0a`, borderRadius: '8px', border: `1px solid ${gc}33` }}>
              <span style={{ fontSize: '13px', color: '#7b8498', letterSpacing: '0.5px' }}>Final Gap Score</span>
              <span style={{ fontSize: '24px', fontWeight: 800, color: gc }}>
                {gap}
                <span style={{ fontSize: '14px', fontWeight: 400, color: '#3a4a5a' }}>/100</span>
              </span>
            </div>
          </div>

          <p style={{ fontSize: '14px', color: '#c9d1d9', lineHeight: 1.75, margin: 0 }}>
            {gapExplain}
          </p>
        </div>

      </div>
    </div>
  )
}
