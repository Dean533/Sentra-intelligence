'use client'

import { useEffect, useState } from 'react'

type CmpSignal = {
  signal_direction: 'bullish' | 'bearish' | 'neutral'
  expected_move_pct: number
  opportunistic_buy_count: number
  opportunistic_sell_count: number
  local_opportunistic_count: number
  routine_trades_filtered: number
  cluster_strength: 'LOW' | 'MEDIUM' | 'HIGH' | null
  signal_month: string
  timeframe_label: string
}

function fmtMonth(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function directionColor(d: 'bullish' | 'bearish' | 'neutral'): string {
  if (d === 'bullish') return '#3fb950'
  if (d === 'bearish') return '#f85149'
  return '#7b8498'
}

function clusterColor(strength: 'LOW' | 'MEDIUM' | 'HIGH' | null): string {
  if (strength === 'HIGH')   return '#3fb950'
  if (strength === 'MEDIUM') return '#d29922'
  if (strength === 'LOW')    return '#7b8498'
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

export default function InsiderIntelligenceCard({ ticker }: { ticker: string }) {
  const [signal, setSignal] = useState<CmpSignal | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!ticker) return
    fetch(`/api/insider/cmp-signal/${ticker}`)
      .then((r) => r.json())
      .then((d) => setSignal(d.data ?? null))
      .finally(() => setLoading(false))
  }, [ticker])

  if (loading || !signal) return null

  const dc = directionColor(signal.signal_direction)
  const em = signal.expected_move_pct
  const emLabel = em >= 0 ? `+${em.toFixed(2)}%` : `${em.toFixed(2)}%`

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#7b8498', marginBottom: '6px', textTransform: 'uppercase' as const }}>
            Insider Intelligence
          </div>
          <div style={{ fontSize: '12px', color: '#7b8498' }}>
            {fmtMonth(signal.signal_month)}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px',
            color: dc, padding: '4px 12px',
            borderRadius: '20px', border: `1px solid ${dc}33`,
            background: `${dc}11`, textTransform: 'uppercase' as const,
          }}>
            {signal.signal_direction}
          </span>
        </div>
      </div>

      <div style={{ height: '1px', background: '#1e2530', marginBottom: '20px' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498', marginBottom: '8px', textTransform: 'uppercase' as const }}>
            Expected Move
          </div>
          <div style={{ fontSize: '40px', fontWeight: 800, lineHeight: 1, color: dc }}>
            {emLabel.replace('%', '')}
            <span style={{ fontSize: '20px', fontWeight: 600 }}>%</span>
          </div>
          <div style={{ fontSize: '11px', color: '#7b8498', marginTop: '6px', letterSpacing: '1px', textTransform: 'uppercase' as const }}>
            {signal.timeframe_label}
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1e2530', borderBottom: '1px solid #1e2530', padding: '16px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '18px' }}>
        <div>
          <div style={statLabel}>Opportunistic Buys</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#3fb950' }}>
            {signal.opportunistic_buy_count}
          </div>
        </div>

        <div>
          <div style={statLabel}>Opportunistic Sells</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: signal.opportunistic_sell_count > 0 ? '#f85149' : '#e6edf3' }}>
            {signal.opportunistic_sell_count}
          </div>
        </div>

        <div>
          <div style={statLabel}>Cluster Strength</div>
          {signal.cluster_strength ? (
            <span style={{
              fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
              color: clusterColor(signal.cluster_strength),
              padding: '3px 10px', borderRadius: '20px',
              border: `1px solid ${clusterColor(signal.cluster_strength)}33`,
              background: `${clusterColor(signal.cluster_strength)}11`,
            }}>
              {signal.cluster_strength}
            </span>
          ) : (
            <span style={{ fontSize: '16px', fontWeight: 700, color: '#7b8498' }}>—</span>
          )}
        </div>

        <div>
          <div style={statLabel}>Routine Filtered</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#7b8498' }}>
            {signal.routine_trades_filtered}
          </div>
        </div>
      </div>

      <div style={{ fontSize: '11px', color: '#4a5568', textAlign: 'center' }}>
        Based on Cohen, Malloy &amp; Pomorski (2012)
      </div>
    </div>
  )
}
