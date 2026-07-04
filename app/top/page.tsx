'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── types ────────────────────────────────────────────────────────────────────

type SignalRow = {
  ticker:            string
  conviction_score:  number
  signal_direction:  'bullish' | 'bearish' | 'neutral'
  signal_month:      string
  hold_days:         number | null
  lead_insider_name: string | null
  lead_insider_role: string | null
  total_buy_value:   number | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 70) return '#3fb950'
  if (s >= 60) return '#d29922'
  return '#f85149'
}

function fmtValue(v: number | null) {
  if (v == null || v === 0) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtMonth(s: string) {
  return new Date(s + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// ─── row card ─────────────────────────────────────────────────────────────────

function SignalCard({ row, rank }: { row: SignalRow; rank: number }) {
  const router   = useRouter()
  const sc       = scoreColor(row.conviction_score)
  const isBull   = row.signal_direction === 'bullish'
  const isBear   = row.signal_direction === 'bearish'
  const dirColor = isBull ? '#3fb950' : isBear ? '#f85149' : '#7b8498'
  const dirLabel = row.signal_direction.toUpperCase()
  const val      = fmtValue(row.total_buy_value)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => router.push(`/t/${row.ticker}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:    hovered ? '#111620' : '#0d1117',
        border:        `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
        borderLeft:    `3px solid ${sc}`,
        borderRadius:  '10px',
        padding:       '16px 20px',
        cursor:        'pointer',
        transition:    'background 0.15s, border-color 0.15s',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        gap:           '16px',
      }}
    >
      {/* left: rank + ticker + insider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <span style={{ fontSize: '13px', color: '#3a4a60', fontWeight: 700, minWidth: '22px', flexShrink: 0 }}>
          #{rank}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px' }}>
              {row.ticker}
            </span>
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
              padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase' as const,
              color: dirColor, border: `1px solid ${dirColor}33`, background: `${dirColor}11`,
            }}>
              {dirLabel}
            </span>
          </div>
          {row.lead_insider_name && (
            <div style={{
              fontSize: '12px', color: '#7b8498', marginTop: '3px',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '280px',
            }}>
              {row.lead_insider_name}
              {row.lead_insider_role && (
                <span style={{ color: '#4a5568', marginLeft: '6px' }}>· {row.lead_insider_role}</span>
              )}
            </div>
          )}
          <div style={{ fontSize: '11px', color: '#3a4a60', marginTop: '2px' }}>
            {fmtMonth(row.signal_month)}
          </div>
        </div>
      </div>

      {/* right: value + hold + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexShrink: 0 }}>
        {val && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>BUY VALUE</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>{val}</div>
          </div>
        )}
        {row.hold_days && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>HOLD</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>{row.hold_days}d</div>
          </div>
        )}
        <div style={{ textAlign: 'right', minWidth: '44px' }}>
          <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>SCORE</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: sc, lineHeight: 1 }}>
            {row.conviction_score}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TopPage() {
  const [rows,        setRows]        = useState<SignalRow[]>([])
  const [signalMonth, setSignalMonth] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/insider/top-signals')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setRows(d.data ?? [])
        setSignalMonth(d.signal_month ?? null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{
      background: '#0a0e14', minHeight: '100vh', color: '#e6edf3',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '48px 40px 80px' }}>

        {/* heading */}
        <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 10px' }}>
          SENTRA SIGNALS
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <h1 style={{ fontSize: '36px', fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
            Top Insider Transactions
          </h1>
          {signalMonth && (
            <span style={{ fontSize: '12px', color: '#7b8498', paddingBottom: '6px' }}>
              {fmtMonth(signalMonth)}
            </span>
          )}
        </div>
        <p style={{ color: '#7b8498', fontSize: '15px', margin: '0 0 36px', lineHeight: 1.6 }}>
          Opportunistic insider buys ranked by conviction score — routine traders excluded.
        </p>

        {/* loading */}
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: '72px', borderRadius: '10px', background: '#0d1117', border: '1px solid #1e2530', animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
        )}

        {/* error */}
        {error && !loading && (
          <div style={{ background: '#1a0d0d', border: '1px solid #5a1a1a', borderRadius: '10px', padding: '20px', color: '#f85149', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {/* empty */}
        {!loading && !error && rows.length === 0 && (
          <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: '12px', padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: '#7b8498' }}>No signals found for the most recent month.</div>
          </div>
        )}

        {/* list */}
        {!loading && rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rows.map((row, i) => (
              <SignalCard key={row.ticker} row={row} rank={i + 1} />
            ))}
          </div>
        )}

      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
