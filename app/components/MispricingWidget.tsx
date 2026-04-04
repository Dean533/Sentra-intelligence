'use client'

import { useEffect, useState } from 'react'

type MispricingRow = {
  ticker: string
  insider_name: string
  officer_title: string | null
  transaction_date: string
  total_value: number | null
  shares: number | null
  price_per_share: number | null
  price_on_day: number | null
  price_5d: number | null
  actual_return_5d: number | null
  adjusted_return_5d: number | null
  fundamental_score: number | null
  gap_score: number | null
}

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

function gapColor(score: number): string {
  if (score >= 70) return '#f85149'
  if (score >= 50) return '#d29922'
  return '#7b8498'
}

function signalLabel(fundamentalScore: number): string {
  if (fundamentalScore >= 70) return 'HIGH'
  if (fundamentalScore >= 50) return 'MEDIUM'
  return 'LOW'
}

function signalColor(fundamentalScore: number): string {
  if (fundamentalScore >= 70) return '#3fb950'
  if (fundamentalScore >= 50) return '#d29922'
  return '#7b8498'
}

const card: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #1e2530',
  borderRadius: '12px',
  padding: '24px',
}

const eyebrow: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '2px',
  color: '#7b8498',
  textTransform: 'uppercase',
  fontVariant: 'small-caps',
}

const statLabel: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '1.5px',
  color: '#7b8498',
  marginBottom: '4px',
}

export default function MispricingWidget({ ticker }: { ticker: string }) {
  const [row, setRow] = useState<MispricingRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    fetch(`/api/mispricing/${ticker}`)
      .then((r) => r.json())
      .then((d) => setRow(d.data ?? null))
      .finally(() => setLoading(false))
  }, [ticker])

  if (loading || !row || row.gap_score == null) return null

  const gap = row.gap_score
  const gc  = gapColor(gap)
  const fs  = row.fundamental_score ?? 0

  const title = row.officer_title ?? 'Insider'
  const summaryReturnStr = row.actual_return_5d != null
    ? `${row.actual_return_5d >= 0 ? '+' : ''}${row.actual_return_5d.toFixed(2)}%`
    : 'N/A'

  return (
    <div style={card}>
      {/* header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <p style={{ ...eyebrow, margin: 0 }}>Event Mispricing</p>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', letterSpacing: '1px', color: gc, marginBottom: '2px' }}>
            GAP SCORE
          </div>
          <div style={{ fontSize: '40px', fontWeight: 800, lineHeight: 1, color: gc }}>
            {gap}
          </div>
        </div>
      </div>

      {/* divider */}
      <div style={{ height: '1px', background: '#1e2530', marginBottom: '16px' }} />

      {/* summary sentence */}
      <p style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.6, margin: '0 0 20px' }}>
        <span style={{ color: '#e6edf3', fontWeight: 600 }}>{row.insider_name}</span>
        {' '}
        <span style={{ color: '#7b8498' }}>({title})</span>
        {' '}purchased{' '}
        <span style={{ color: '#e6edf3', fontWeight: 600 }}>{fmtValue(row.total_value)}</span>
        {' '}on{' '}
        <span style={{ color: '#e6edf3' }}>{fmtDate(row.transaction_date)}</span>
        . Market reacted{' '}
        <span style={{ color: row.actual_return_5d != null && row.actual_return_5d >= 0 ? '#3fb950' : '#f85149', fontWeight: 600 }}>
          {summaryReturnStr}
        </span>
        {' '}vs Sentra expected signal.
      </p>

      {/* stat columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderTop: '1px solid #141920', borderBottom: '1px solid #141920' }}>

        {/* left column */}
        <div style={{ padding: '14px 16px 14px 0', borderRight: '1px solid #141920', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={statLabel}>ACTUAL RETURN (5D)</div>
            <div style={{
              fontSize: '17px', fontWeight: 700,
              color: row.actual_return_5d != null && row.actual_return_5d >= 0 ? '#3fb950' : '#f85149',
            }}>
              {fmtPct(row.actual_return_5d)}
            </div>
          </div>
          <div>
            <div style={statLabel}>SPY-ADJUSTED RETURN</div>
            <div style={{
              fontSize: '17px', fontWeight: 700,
              color: row.adjusted_return_5d != null && row.adjusted_return_5d >= 0 ? '#3fb950' : '#f85149',
            }}>
              {fmtPct(row.adjusted_return_5d)}
            </div>
          </div>
        </div>

        {/* right column */}
        <div style={{ padding: '14px 0 14px 16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={statLabel}>FUNDAMENTAL SCORE</div>
            <div style={{ fontSize: '17px', fontWeight: 700, color: '#e6edf3' }}>
              {row.fundamental_score != null ? (
                <>
                  <span style={{ color: signalColor(fs) }}>{row.fundamental_score}</span>
                  <span style={{ color: '#7b8498', fontSize: '13px', fontWeight: 400 }}>/100</span>
                </>
              ) : '—'}
            </div>
          </div>
          <div>
            <div style={statLabel}>SIGNAL STRENGTH</div>
            <div style={{ display: 'inline-flex' }}>
              <span style={{
                fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
                color: signalColor(fs), padding: '3px 10px',
                borderRadius: '20px', border: `1px solid ${signalColor(fs)}33`,
                background: `${signalColor(fs)}11`,
              }}>
                {signalLabel(fs)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
        <a
          href={`/events`}
          style={{
            fontSize: '12px', letterSpacing: '1px', color: '#7b8498',
            textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#c9d1d9' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#7b8498' }}
        >
          VIEW FULL ANALYSIS →
        </a>
      </div>
    </div>
  )
}
