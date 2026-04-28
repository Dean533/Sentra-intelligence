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
  return s >= 70 ? '#3fb950' : '#d29922'
}

function fmtValue(v: number | null) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtMonth(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// ─── row ─────────────────────────────────────────────────────────────────────

function AlertRow({ row }: { row: SignalRow }) {
  const router    = useRouter()
  const sc        = scoreColor(row.conviction_score)
  const isTrade   = row.conviction_score >= 70
  const val       = fmtValue(row.total_buy_value)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => router.push(`/t/${row.ticker}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:     hovered ? '#111620' : '#0d1117',
        border:         `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
        borderLeft:     `3px solid ${sc}`,
        borderRadius:   '10px',
        padding:        '16px 20px',
        cursor:         'pointer',
        transition:     'background 0.15s, border-color 0.15s',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        gap:            '16px',
      }}
    >
      {/* left: ticker + insider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px' }}>
              {row.ticker}
            </span>

            {/* conviction score badge */}
            <span style={{
              fontSize: '11px', fontWeight: 700, padding: '2px 8px',
              borderRadius: '20px', color: sc,
              border: `1px solid ${sc}33`, background: `${sc}11`,
            }}>
              {row.conviction_score}
            </span>

            {/* BULLISH badge */}
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
              padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase' as const,
              color: '#3fb950', border: '1px solid #3fb95033', background: '#3fb95011',
            }}>
              BULLISH
            </span>

            {/* entry recommendation */}
            <span style={{
              fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
              padding: '2px 10px', borderRadius: '20px', textTransform: 'uppercase' as const,
              color: isTrade ? '#e6edf3' : '#7b8498',
              background: isTrade ? '#1a2a4a' : '#111620',
              border: `1px solid ${isTrade ? '#2a4a7a' : '#1e2530'}`,
            }}>
              {isTrade ? 'TRADE' : 'MONITOR'}
            </span>
          </div>

          {row.lead_insider_name && (
            <div style={{
              fontSize: '12px', color: '#7b8498', marginTop: '4px',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '340px',
            }}>
              {row.lead_insider_name}
              {row.lead_insider_role && (
                <span style={{ color: '#3a4a60', marginLeft: '6px' }}>· {row.lead_insider_role}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* right: buy value + hold + score */}
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

export default function AlertsPage() {
  const [rows,        setRows]        = useState<SignalRow[]>([])
  const [signalMonth, setSignalMonth] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/insider/top-signals')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        const filtered = (d.data ?? [] as SignalRow[]).filter((r: SignalRow) => r.conviction_score >= 60)
        setRows(filtered)
        setSignalMonth(d.signal_month ?? null)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const tradeReady = rows.filter(r => r.conviction_score >= 70).length

  return (
    <div style={{
      background: '#0a0e14', minHeight: '100vh', color: '#e6edf3',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '48px 40px 80px' }}>

        {/* heading */}
        <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 10px' }}>
          SENTRA INTELLIGENCE
        </p>
        <h1 style={{ fontSize: '36px', fontWeight: 800, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
          Alerts
        </h1>

        {/* summary line */}
        {!loading && !error && signalMonth && (
          <p style={{ color: '#7b8498', fontSize: '14px', margin: '0 0 32px', lineHeight: 1.6 }}>
            <span style={{ color: '#e6edf3', fontWeight: 600 }}>{rows.length}</span> active signal{rows.length !== 1 ? 's' : ''}
            {' · '}
            <span style={{ color: '#3fb950', fontWeight: 600 }}>{tradeReady}</span> trade-ready
            {' · '}
            {fmtMonth(signalMonth)}
          </p>
        )}

        {loading && (
          <>
            <div style={{ height: '20px', width: '240px', borderRadius: '4px', background: '#1a1f2a', marginBottom: '32px', animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ height: '76px', borderRadius: '10px', background: '#0d1117', border: '1px solid #1e2530', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          </>
        )}

        {error && !loading && (
          <div style={{ background: '#1a0d0d', border: '1px solid #5a1a1a', borderRadius: '10px', padding: '20px', color: '#f85149', fontSize: '13px' }}>
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div style={{ background: '#0d1117', border: '1px solid #1e2530', borderRadius: '12px', padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: '14px', color: '#7b8498' }}>No signals with conviction ≥ 60 this month.</div>
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rows.map(row => (
              <AlertRow key={row.ticker} row={row} />
            ))}
          </div>
        )}

      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
