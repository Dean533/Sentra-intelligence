'use client'

import { useEffect, useId, useState } from 'react'

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
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n >= 0 ? '+' : ''
  return `${sign}${n.toFixed(2)}%`
}

function gapLabel(score: number): string {
  if (score >= 70) return 'HIGH MISPRICING DETECTED'
  if (score >= 50) return 'MODERATE MISPRICING DETECTED'
  return 'MILD MISPRICING DETECTED'
}

type SignalPalette = {
  primary: string
  accent: string
  glow: string
  track: string
}

function signalPalette(score: number): SignalPalette {
  if (score >= 70) {
    return {
      primary: '#e24d39',
      accent: '#ff7a5c',
      glow: '#ff6a4d',
      track: '#373535',
    }
  }
  if (score >= 50) {
    return {
      primary: '#d29922',
      accent: '#f0bf57',
      glow: '#e8af3d',
      track: '#36332d',
    }
  }
  return {
    primary: '#7b8498',
    accent: '#a2acc3',
    glow: '#8f99ae',
    track: '#303540',
  }
}

function gapColor(score: number): string {
  return signalPalette(score).primary
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

function expectedRange(fs: number): string {
  if (fs >= 70) return '+4% to +8%'
  if (fs >= 50) return '+2% to +5%'
  if (fs >= 30) return '+1% to +3%'
  return '+0.5% to +2%'
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

function GaugeWidget({ gap }: { gap: number }) {
  const palette = signalPalette(gap)
  const signalColor = palette.primary
  const signalText = gap >= 70 ? 'Strong Signal' : gap >= 50 ? 'Moderate Signal' : 'Weak Signal'
  const normalizedGap = Math.min(Math.max(gap, 0), 100)
  const endAngle = 180 - normalizedGap * 1.8
  const needleRotation = normalizedGap * 1.8 - 90
  const svgId = useId().replace(/:/g, '')
  const gradientId = `${svgId}-signal-gradient`
  const glowId = `${svgId}-signal-glow`

  function pointOnArc(angle: number) {
    const radians = (angle * Math.PI) / 180
    return {
      x: 100 + 80 * Math.cos(radians),
      y: 100 - 80 * Math.sin(radians),
    }
  }

  const activeEnd = pointOnArc(endAngle)
  const activeArc =
    normalizedGap <= 0
      ? null
      : `M 20 100 A 80 80 0 0 1 ${activeEnd.x} ${activeEnd.y}`

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={200} height={120} viewBox="0 0 200 120">
        <defs>
          <linearGradient id={gradientId} x1="20" y1="100" x2="180" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={palette.primary} />
            <stop offset="65%" stopColor={palette.primary} />
            <stop offset="100%" stopColor={palette.accent} />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor={palette.glow} floodOpacity="0.45" />
          </filter>
        </defs>
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none"
          stroke={palette.track}
          strokeWidth={12}
          strokeLinecap="round"
        />
        {activeArc && (
          <path
            d={activeArc}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={12}
            strokeLinecap="round"
            filter={`url(#${glowId})`}
          />
        )}
        <line
          x1="100"
          y1="100"
          x2="100"
          y2="25"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          transform={`rotate(${needleRotation}, 100, 100)`}
        />
        <circle cx="100" cy="100" r="4" fill="#fff" stroke={palette.accent} strokeWidth="1" />
        <text x="18" y="114" fontSize="10" fill="#666" textAnchor="start">No Signal</text>
        <text x="182" y="114" fontSize="10" fill="#666" textAnchor="end">Strong</text>
        <text x="100" y="12" fontSize="10" fill="#666" textAnchor="middle">Neutral</text>
      </svg>
      <div style={{ fontSize: '13px', fontWeight: 700, color: signalColor, marginTop: '2px', letterSpacing: '0.5px', textShadow: `0 0 10px ${palette.glow}33` }}>
        {signalText}
      </div>
    </div>
  )
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
  const gc = gapColor(gap)
  const fs = row.fundamental_score ?? 0
  const conviction = convictionFromTitle(row.officer_title)
  const cc = convictionColor(conviction)

  const title = row.officer_title ?? 'Insider'

  const ret = row.actual_return_5d
  const moveWord = ret == null ? 'moved' : ret < 0 ? 'fell' : 'rose'
  const moveStr = ret != null ? `${Math.abs(ret).toFixed(2)}%` : 'an unexpected amount'

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#7b8498', marginBottom: '6px', textTransform: 'uppercase' as const }}>
            Insider Signal
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '0.5px', color: gc }}>
            {gapLabel(gap)}
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#7b8498', marginBottom: '4px', textTransform: 'uppercase' as const }}>
            Gap Score
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, lineHeight: 1, color: gc }}>
            {gap}
            <span style={{ fontSize: '16px', fontWeight: 400, color: '#7b8498' }}>/100</span>
          </div>
        </div>
      </div>

      <div style={{ height: '1px', background: '#1e2530', marginBottom: '18px' }} />

      <p style={{ fontSize: '14px', color: '#c9d1d9', lineHeight: 1.7, margin: '0 0 24px' }}>
        <span style={{ color: '#e6edf3', fontWeight: 600 }}>{ticker}'s {title}</span>
        {' '}bought{' '}
        <span style={{ color: '#e6edf3', fontWeight: 600 }}>{fmtValue(row.total_value)}</span>
        {' '}in open market shares on {fmtDate(row.transaction_date)}.
        {' '}The stock {moveWord}{' '}
        <span style={{ color: ret != null && ret < 0 ? '#f85149' : '#3fb950', fontWeight: 600 }}>
          {moveStr}
        </span>
        {' '}in the following 5 days despite the strong insider conviction signal —{' '}
        <span style={{ color: '#9ecbff' }}>Sentra flags this as a potential undervalued opportunity.</span>
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0', borderTop: '1px solid #1e2530', borderBottom: '1px solid #1e2530' }}>
        <div style={{ padding: '16px 20px 16px 0', borderRight: '1px solid #1e2530', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <div style={statLabel}>Stock moved after buy</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: ret != null && ret < 0 ? '#f85149' : '#3fb950' }}>
              {fmtPct(row.actual_return_5d)}
            </div>
          </div>

          <div>
            <div style={statLabel}>Stripped of market noise</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: row.adjusted_return_5d != null && row.adjusted_return_5d < 0 ? '#f85149' : '#3fb950' }}>
              {fmtPct(row.adjusted_return_5d)}
            </div>
          </div>

          <div>
            <div style={statLabel}>What Sentra expected</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#3fb950' }}>
              {expectedRange(fs)}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 0 16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <GaugeWidget gap={gap} />
          <div style={{ marginTop: '12px', textAlign: 'center' }}>
            <div style={{ ...statLabel, marginBottom: '6px' }}>Insider Conviction</div>
            <span style={{
              fontSize: '12px', fontWeight: 700, letterSpacing: '1px',
              color: cc, padding: '3px 12px',
              borderRadius: '20px', border: `1px solid ${cc}33`,
              background: `${cc}11`,
            }}>
              {conviction}
            </span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '18px', display: 'flex', justifyContent: 'flex-end' }}>
        <a
          href={`/events/${row.id}`}
          style={{ fontSize: '13px', color: '#7b8498', textDecoration: 'none', transition: 'color 0.15s' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#9ecbff' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#7b8498' }}
        >
          See Why This Is Mispriced →
        </a>
      </div>
    </div>
  )
}
