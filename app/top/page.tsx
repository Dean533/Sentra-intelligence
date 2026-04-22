'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ─── types ────────────────────────────────────────────────────────────────────

type CmpSignalRow = {
  ticker: string
  signal_direction: 'bullish' | 'bearish' | 'neutral'
  expected_move_pct: number
  opportunistic_buy_count: number
  opportunistic_sell_count: number
  cluster_strength: 'LOW' | 'MEDIUM' | 'HIGH' | null
  routine_trades_filtered: number
  signal_month: string
}

type SignalRow = {
  ticker: string
  score: number
  analyst_gap: number | null
  analyst_target: number | null
  current_price: number | null
  recommendation: string | null
  signal: string | null
  computed_at: string
  name?: string | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 65) return '#3fb950'
  if (s >= 35) return '#d29922'
  return '#f85149'
}

function signalColor(sig: string | null) {
  if (sig === 'undervalued') return '#3fb950'
  if (sig === 'overvalued')  return '#f85149'
  return '#d29922'
}

function recColor(rec: string | null) {
  if (rec === 'Strong Buy')  return '#3fb950'
  if (rec === 'Buy')         return '#52d175'
  if (rec === 'Hold')        return '#d29922'
  if (rec === 'Sell')        return '#f85149'
  if (rec === 'Strong Sell') return '#f85149'
  return '#7b8498'
}

function fmtGap(gap: number | null) {
  if (gap == null) return null
  return `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}%`
}

function fmtRelTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffM  = Math.floor(diffMs / 60000)
  const diffH  = Math.floor(diffMs / 3600000)
  if (diffM < 1)  return 'just now'
  if (diffH < 1)  return `${diffM}m ago`
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function directionColor(d: 'bullish' | 'bearish' | 'neutral') {
  if (d === 'bullish') return '#3fb950'
  if (d === 'bearish') return '#f85149'
  return '#7b8498'
}

function clusterColor(s: 'LOW' | 'MEDIUM' | 'HIGH' | null) {
  if (s === 'HIGH')   return '#3fb950'
  if (s === 'MEDIUM') return '#d29922'
  return '#7b8498'
}

function fmtMonth(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// ─── CMP card ─────────────────────────────────────────────────────────────────

function CmpCard({ row, rank }: { row: CmpSignalRow; rank: number }) {
  const dc = directionColor(row.signal_direction)
  const em = row.expected_move_pct
  const emLabel = em >= 0 ? `+${em.toFixed(2)}%` : `${em.toFixed(2)}%`
  const [hovered, setHovered] = useState(false)

  return (
    <Link href={`/t/${row.ticker}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
      <div
        style={{
          background: hovered ? '#111620' : '#0d1117',
          borderTop: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
          borderRight: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
          borderBottom: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
          borderLeft: `3px solid ${dc}`,
          borderRadius: '10px',
          padding: '14px 20px',
          transition: 'border-color 0.15s, background 0.15s',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', color: '#3a4a60', fontWeight: 700, minWidth: '20px' }}>
            #{rank}
          </span>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '17px', fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px' }}>
                {row.ticker}
              </span>
              <span style={{
                fontSize: '10px', fontWeight: 700, letterSpacing: '1px', padding: '2px 8px',
                borderRadius: '20px', textTransform: 'uppercase' as const,
                color: dc, border: `1px solid ${dc}33`, background: `${dc}11`,
              }}>
                {row.signal_direction}
              </span>
            </div>
            <div style={{ fontSize: '11px', color: '#7b8498', marginTop: '2px' }}>
              {fmtMonth(row.signal_month)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>B / S</div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#e6edf3' }}>
              {row.opportunistic_buy_count} / {row.opportunistic_sell_count}
            </div>
          </div>
          {row.cluster_strength && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>CLUSTER</div>
              <span style={{
                fontSize: '11px', fontWeight: 700, letterSpacing: '1px',
                color: clusterColor(row.cluster_strength),
                padding: '2px 8px', borderRadius: '20px',
                border: `1px solid ${clusterColor(row.cluster_strength)}33`,
                background: `${clusterColor(row.cluster_strength)}11`,
              }}>
                {row.cluster_strength}
              </span>
            </div>
          )}
          <div style={{ textAlign: 'right', minWidth: '52px' }}>
            <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>MOVE</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: dc, lineHeight: 1 }}>
              {emLabel}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ─── card ─────────────────────────────────────────────────────────────────────

function TickerCard({ row, rank }: { row: SignalRow; rank: number }) {
  const borderColor = scoreColor(row.score)
  const gapStr      = fmtGap(row.analyst_gap)
  const gapPositive = (row.analyst_gap ?? 0) >= 0
  const [hovered, setHovered] = useState(false)

  return (
    <Link
      href={`/t/${row.ticker}`}
      style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    >
      <div
        style={{
          background: hovered ? '#111620' : '#0d1117',
          borderTop: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
          borderRight: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
          borderBottom: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: '10px',
          padding: '16px 20px',
          transition: 'border-color 0.15s, background 0.15s',
          cursor: 'pointer',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>

          {/* left: rank + ticker + name */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', minWidth: 0 }}>
            <span style={{ fontSize: '13px', color: '#3a4a60', fontWeight: 700, minWidth: '20px', paddingTop: '2px' }}>
              #{rank}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '17px', fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px' }}>
                  {row.ticker}
                </span>
                {row.signal && (
                  <span style={{
                    fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px',
                    letterSpacing: '0.5px', textTransform: 'uppercase' as const,
                    color: signalColor(row.signal),
                    border: `1px solid ${signalColor(row.signal)}33`,
                    background: `${signalColor(row.signal)}11`,
                  }}>
                    {row.signal}
                  </span>
                )}
              </div>
              {row.name && (
                <div style={{
                  fontSize: '12px', color: '#7b8498', marginTop: '2px',
                  overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '260px',
                }}>
                  {row.name}
                </div>
              )}
            </div>
          </div>

          {/* right: gap + rec + score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
            {gapStr && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>UPSIDE</div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: gapPositive ? '#3fb950' : '#f85149' }}>
                  {gapStr}
                </div>
              </div>
            )}
            {row.recommendation && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>REC</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: recColor(row.recommendation) }}>
                  {row.recommendation}
                </div>
              </div>
            )}
            <div style={{ textAlign: 'right', minWidth: '52px' }}>
              <div style={{ fontSize: '10px', color: '#7b8498', letterSpacing: '1px', marginBottom: '2px' }}>SCORE</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: scoreColor(row.score), lineHeight: 1 }}>
                {row.score}
              </div>
            </div>
          </div>

        </div>
      </div>
    </Link>
  )
}

// ─── section ──────────────────────────────────────────────────────────────────

function Section({ title, subtitle, rows }: { title: string; subtitle: string; rows: SignalRow[] }) {
  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 6px' }}>
          {subtitle}
        </p>
        <h2 style={{ fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>
          {title}
        </h2>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {rows.map((row, i) => (
          <TickerCard key={row.ticker} row={row} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TopPage() {
  const [longs,       setLongs]       = useState<SignalRow[]>([])
  const [shorts,      setShorts]      = useState<SignalRow[]>([])
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [cmpSignals,  setCmpSignals]  = useState<CmpSignalRow[]>([])

  useEffect(() => {
    fetch('/api/scores/top')
      .then((r) => r.json())
      .then((d) => {
        setLongs(d.longs   ?? [])
        setShorts(d.shorts  ?? [])
        setLastUpdated(d.lastUpdated ?? null)
      })
      .finally(() => setLoading(false))

    fetch('/api/insider/signals-monthly?top=10')
      .then((r) => r.json())
      .then((d) => setCmpSignals(d.data ?? []))
  }, [])

  const isEmpty = !loading && longs.length === 0 && shorts.length === 0

  return (
    <div style={{
        background: '#0a0e14', minHeight: '100vh', color: '#e6edf3',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '48px 40px 80px' }}>

          {/* heading */}
          <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 10px' }}>
            SENTRA INTELLIGENCE
          </p>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <h1 style={{ fontSize: '40px', fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
              Top Signals
            </h1>
            {lastUpdated && (
              <span style={{ fontSize: '12px', color: '#7b8498', paddingBottom: '6px' }}>
                Updated {fmtRelTime(lastUpdated)}
              </span>
            )}
          </div>
          <p style={{ color: '#7b8498', fontSize: '15px', margin: '0 0 40px', lineHeight: 1.6 }}>
            Highest and lowest Sentra Score tickers based on news sentiment, SEC filings, and mispricing signals.
          </p>

          {/* loading skeleton */}
          {loading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
              {[0, 1].map((col) => (
                <div key={col}>
                  <div style={{ height: '16px', width: '120px', borderRadius: '4px', background: '#1a1f2a', marginBottom: '20px', animation: 'pulse 1.5s ease-in-out infinite' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} style={{ height: '64px', borderRadius: '10px', background: '#0d1117', border: '1px solid #1e2530', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* empty state */}
          {isEmpty && (
            <div style={{
              background: '#0d1117', border: '1px solid #1e2530', borderRadius: '12px',
              padding: '48px 32px', textAlign: 'center',
            }}>
              <div style={{ fontSize: '14px', color: '#7b8498', lineHeight: 1.8 }}>
                No scores computed yet.<br />
                <span style={{ fontFamily: 'monospace', color: '#9ecbff', fontSize: '13px' }}>
                  GET /api/scores/compute
                </span>
                {' '}to generate scores for all tickers.
              </div>
            </div>
          )}

          {/* results */}
          {!loading && !isEmpty && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', alignItems: 'start' }}>
              <Section title="Top 10 Longs"  subtitle="HIGHEST SCORE" rows={longs}  />
              <Section title="Top 10 Shorts" subtitle="LOWEST SCORE"  rows={shorts} />
            </div>
          )}

          {/* CMP insider signal clusters */}
          {cmpSignals.length > 0 && (
            <div style={{ marginTop: '56px' }}>
              <div style={{ marginBottom: '16px' }}>
                <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 6px' }}>
                  COHEN, MALLOY &amp; POMORSKI (2012)
                </p>
                <h2 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.3px' }}>
                  Top Insider Signal Clusters
                </h2>
                <p style={{ fontSize: '14px', color: '#7b8498', margin: 0, lineHeight: 1.6 }}>
                  Tickers with the strongest opportunistic insider signals this month — routine traders excluded.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {cmpSignals.map((row, i) => (
                  <CmpCard key={row.ticker} row={row} rank={i + 1} />
                ))}
              </div>
            </div>
          )}

        </div>
    </div>
  )
}
