'use client'

import { useEffect, useState } from 'react'

type MispricingRow = {
  id: string
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
  expected_move: number | null
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
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
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

// Color the expected move by signal strength — higher expected move = greener
function expectedMoveColor(pct: number): string {
  if (pct >= 6) return '#3fb950'
  if (pct >= 3) return '#d29922'
  return '#7b8498'
}

const card: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #1e2530',
  borderRadius: '12px',
  padding: '28px',
}

const statLabel: React.CSSProperties = {
  fontSize: '11px',
  letterSpacing: '1.5px',
  color: '#7b8498',
  marginBottom: '5px',
  textTransform: 'uppercase' as const,
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

  if (loading || !row || row.expected_move == null) return null

  const em = row.expected_move
  const ec = expectedMoveColor(em)
  const conviction = convictionFromTitle(row.officer_title)
  const cc = convictionColor(conviction)
  const title = row.officer_title ?? 'Insider'
  const ret = row.actual_return_5d

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#7b8498', marginBottom: '6px', textTransform: 'uppercase' as const }}>
            Insider Signal
          </div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#e6edf3' }}>
            {ticker}'s {title} bought{' '}
            <span style={{ color: ec }}>{fmtValue(row.total_value)}</span>
            {' '}on {fmtDate(row.transaction_date)}
          </div>
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#7b8498', marginBottom: '4px', textTransform: 'uppercase' as const }}>
            Sentra Expected Move
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, lineHeight: 1, color: ec }}>
            +{em.toFixed(1)}
            <span style={{ fontSize: '18px', fontWeight: 600 }}>%</span>
          </div>
        </div>
      </div>

      <div style={{ height: '1px', background: '#1e2530', marginBottom: '18px' }} />

      <p style={{ fontSize: '14px', color: '#c9d1d9', lineHeight: 1.7, margin: '0 0 24px' }}>
        Based on this insider buy, Sentra estimates a potential{' '}
        <span style={{ color: ec, fontWeight: 600 }}>+{em.toFixed(1)}% price move</span>
        {' '}— based on who bought, how much they spent relative to the company's size, and whether other insiders were buying around the same time.
        {ret != null && (
          <>
            {' '}The stock has{' '}
            {ret < 0 ? 'fallen' : 'risen'}{' '}
            <span style={{ color: ret < 0 ? '#f85149' : '#3fb950', fontWeight: 600 }}>
              {fmtPct(ret)}
            </span>
            {' '}in the 5 days following the buy.
          </>
        )}
      </p>

      <div style={{ borderTop: '1px solid #1e2530', borderBottom: '1px solid #1e2530', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={statLabel}>Stock moved after buy</span>
          <span style={{ fontSize: '16px', fontWeight: 700, color: ret != null && ret < 0 ? '#f85149' : '#3fb950' }}>
            {fmtPct(row.actual_return_5d)}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={statLabel}>Stripped of market noise</span>
          <span style={{ fontSize: '16px', fontWeight: 700, color: row.adjusted_return_5d != null && row.adjusted_return_5d < 0 ? '#f85149' : '#3fb950' }}>
            {fmtPct(row.adjusted_return_5d)}
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={statLabel}>Sentra expected move</span>
          <span style={{ fontSize: '16px', fontWeight: 700, color: ec }}>
            +{em.toFixed(1)}%
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={statLabel}>Insider conviction</span>
          <span style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
            color: cc, padding: '3px 10px',
            borderRadius: '20px', border: `1px solid ${cc}33`,
            background: `${cc}11`,
          }}>
            {conviction}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <a
          href={`/events/${row.id}`}
          style={{ fontSize: '13px', color: '#7b8498', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#9ecbff' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#7b8498' }}
        >
          See Full Analysis →
        </a>
      </div>
    </div>
  )
}
