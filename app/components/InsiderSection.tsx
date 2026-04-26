'use client'

import { useEffect, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type CmpSignal = {
  signal_direction: 'bullish' | 'bearish' | 'neutral'
  expected_move_pct: number
  opportunistic_buy_count: number
  opportunistic_sell_count: number
  routine_trades_filtered: number
  cluster_strength: 'LOW' | 'MEDIUM' | 'HIGH' | null
  signal_month: string
}

type Trade = {
  id: string
  insider_name: string
  officer_title: string | null
  transaction_date: string
  transaction_direction: string | null
  transaction_code: string
  total_value: number | null
  shares: number | null
  price_per_share: number | null
  is_opportunistic: boolean
}

type ConvictionData = {
  score: number
  classification: 'HIGH_CONVICTION' | 'TAKE_TRADE' | 'MONITOR' | 'DO_NOT_TRADE'
  role: string
  factors: string[]
  holdDays: number
  positionMultiplier: number
  exitRules: {
    stopLoss: number
    takeProfit: number
    holdDays: number
    stopLossPrice: number | null
    takeProfitPrice: number | null
  }
  trade: {
    insider_name: string
    officer_title: string | null
    transaction_date: string
    total_value: number | null
    price_per_share: number | null
    shares: number | null
    is_opportunistic: boolean
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtValue(n: number | null): string {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}

function fmtDate(s: string): string {
  return new Date(s).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function fmtMonth(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

// expected_move_pct is a log-scale CMP formula score (range ~-0.43 to +0.46), not a real %.
function signalStrengthLabel(v: number): string {
  if (v > 0.3)   return 'Strong bullish signal'
  if (v > 0.05)  return 'Bullish signal'
  if (v < -0.2)  return 'Strong bearish signal'
  if (v < -0.05) return 'Bearish signal'
  return 'Neutral'
}

// ─── Conviction score helpers ─────────────────────────────────────────────────

function classificationLabel(c: ConvictionData['classification']): string {
  if (c === 'HIGH_CONVICTION') return 'HIGH CONVICTION'
  if (c === 'TAKE_TRADE')      return 'TAKE TRADE'
  if (c === 'MONITOR')         return 'MONITOR ONLY'
  return 'DO NOT TRADE'
}

function classificationColor(c: ConvictionData['classification']): string {
  if (c === 'HIGH_CONVICTION') return '#3fb950'
  if (c === 'TAKE_TRADE')      return '#58a6ff'
  if (c === 'MONITOR')         return '#d4a037'
  return '#f85149'
}

function scoreBarColor(score: number): string {
  if (score >= 85) return '#3fb950'
  if (score >= 70) return '#58a6ff'
  if (score >= 50) return '#d4a037'
  return '#f85149'
}

// ─── Conviction score panel ───────────────────────────────────────────────────

function ConvictionPanel({ conviction }: { conviction: ConvictionData }) {
  const { score, classification, factors, holdDays, positionMultiplier, exitRules } = conviction
  const clsColor = classificationColor(classification)
  const barColor  = scoreBarColor(score)

  return (
    <div style={{
      background: '#0d1117',
      border: '1px solid #1f2937',
      borderRadius: '6px',
      padding: '16px',
      marginBottom: '20px',
    }}>
      {/* Score row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
        <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498', textTransform: 'uppercase' }}>
          Conviction Score
        </span>
        <span style={{ fontSize: '22px', fontWeight: 800, color: barColor, letterSpacing: '-0.5px' }}>
          {score}<span style={{ fontSize: '14px', fontWeight: 400, color: '#4a5568', marginLeft: '2px' }}>/100</span>
        </span>
      </div>

      {/* Score bar */}
      <div style={{ height: '3px', background: '#1f2937', borderRadius: '2px', marginBottom: '12px' }}>
        <div style={{ height: '100%', width: `${score}%`, background: barColor, borderRadius: '2px', transition: 'width 0.4s ease' }} />
      </div>

      {/* Classification + hold + multiplier */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: clsColor, letterSpacing: '0.5px' }}>
          {classificationLabel(classification)}
        </span>
        <span style={{ color: '#3a4a60' }}>·</span>
        <span style={{ fontSize: '12px', color: '#c9d1d9' }}>
          Hold <strong style={{ color: '#e6edf3' }}>{holdDays}d</strong>
        </span>
        {positionMultiplier > 1 && (
          <>
            <span style={{ color: '#3a4a60' }}>·</span>
            <span style={{ fontSize: '12px', color: '#c9d1d9' }}>
              Position <strong style={{ color: '#e6edf3' }}>{positionMultiplier}×</strong>
            </span>
          </>
        )}
      </div>

      {/* Exit rules */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', marginBottom: '12px', fontSize: '12px', color: '#7b8498' }}>
        <span>
          Stop loss{' '}
          <strong style={{ color: '#f85149' }}>
            {exitRules.stopLossPrice != null ? `$${exitRules.stopLossPrice.toFixed(2)}` : '−10%'}
          </strong>
        </span>
        <span style={{ color: '#3a4a60' }}>·</span>
        <span>
          Take profit{' '}
          <strong style={{ color: '#3fb950' }}>
            {exitRules.takeProfitPrice != null ? `$${exitRules.takeProfitPrice.toFixed(2)}` : '+25%'}
          </strong>
        </span>
      </div>

      {/* Factors */}
      {factors.length > 0 && (
        <div style={{ borderTop: '1px solid #1f2937', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {factors.map((f, i) => (
            <div key={i} style={{ fontSize: '11px', color: f.includes('-') ? '#f85149' : '#7b8498', display: 'flex', gap: '6px' }}>
              <span style={{ color: f.includes('-') ? '#f85149' : '#4a5568', flexShrink: 0 }}>
                {f.includes('-') ? '✕' : '✓'}
              </span>
              <span>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Trade row ────────────────────────────────────────────────────────────────

function TradeRow({ trade, marketCap }: { trade: Trade; marketCap: number | null }) {
  const isBuy       = trade.transaction_direction === 'buy' || trade.transaction_code === 'P'
  const dirColor    = isBuy ? '#3fb950' : '#f85149'
  const dirLabel    = isBuy ? 'BUY' : 'SELL'
  const accentColor = trade.is_opportunistic ? (isBuy ? '#3fb950' : '#f85149') : 'transparent'

  const pctOfMktCap =
    trade.total_value != null && marketCap != null && marketCap > 0
      ? (trade.total_value / marketCap) * 100
      : null

  return (
    <div style={{
      padding: '14px 0 14px 16px',
      borderLeft: `2px solid ${accentColor}`,
      marginLeft: trade.is_opportunistic ? '0' : '2px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#e6edf3' }}>
            {trade.insider_name}
          </span>
          {trade.officer_title && (
            <span style={{ fontSize: '12px', color: '#7b8498', marginLeft: '8px' }}>
              {trade.officer_title}
            </span>
          )}
        </div>
        <span style={{ fontSize: '12px', color: '#7b8498', flexShrink: 0, marginLeft: '16px' }}>
          {fmtDate(trade.transaction_date)}
        </span>
      </div>

      <div style={{ marginTop: '4px', fontSize: '13px', color: '#c9d1d9', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
        <span style={{ fontWeight: 700, color: dirColor, letterSpacing: '0.5px' }}>{dirLabel}</span>
        <span style={{ color: '#3a4a60' }}>·</span>
        <span>{fmtValue(trade.total_value)}</span>
        {trade.shares != null && (
          <>
            <span style={{ color: '#3a4a60' }}>·</span>
            <span>{trade.shares.toLocaleString()} shares</span>
          </>
        )}
        {trade.price_per_share != null && (
          <>
            <span style={{ color: '#3a4a60' }}>·</span>
            <span style={{ color: '#7b8498' }}>${trade.price_per_share.toFixed(2)}/sh</span>
          </>
        )}
      </div>

      {pctOfMktCap != null && (
        <div style={{ marginTop: '3px', fontSize: '11px', color: '#4a5568' }}>
          {pctOfMktCap < 0.001
            ? pctOfMktCap.toFixed(4)
            : pctOfMktCap < 0.01
            ? pctOfMktCap.toFixed(3)
            : pctOfMktCap.toFixed(2)}% of market cap
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InsiderSection({
  ticker,
  marketCap,
}: {
  ticker: string
  marketCap: number | null
}) {
  const [signal,     setSignal]     = useState<CmpSignal | null>(null)
  const [trades,     setTrades]     = useState<Trade[]>([])
  const [conviction, setConviction] = useState<ConvictionData | null>(null)

  const [loadingSignal,     setLoadingSignal]     = useState(true)
  const [loadingTrades,     setLoadingTrades]     = useState(true)
  const [loadingConviction, setLoadingConviction] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoadingSignal(true)
    setLoadingTrades(true)
    setLoadingConviction(true)

    fetch(`/api/insider/cmp-signal/${ticker}`)
      .then(r => r.json())
      .then(d => setSignal(d.data ?? null))
      .finally(() => setLoadingSignal(false))

    fetch(`/api/insider/fetch?ticker=${ticker}&limit=5`)
      .then(r => r.json())
      .then(d => setTrades(d.rows ?? []))
      .finally(() => setLoadingTrades(false))

    fetch(`/api/insider/conviction/${ticker}`)
      .then(r => r.json())
      .then(d => setConviction(d.data ?? null))
      .finally(() => setLoadingConviction(false))
  }, [ticker])

  if (loadingSignal || loadingTrades) return null
  if (!signal && trades.length === 0) return null

  const dirColor =
    signal?.signal_direction === 'bullish' ? '#3fb950' :
    signal?.signal_direction === 'bearish' ? '#f85149' : '#7b8498'

  return (
    <div>
      {/* Top row: section label + signal direction */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '20px' }}>
        <p style={{
          fontSize: '11px', letterSpacing: '2px', color: '#7b8498',
          textTransform: 'uppercase', margin: 0,
        }}>
          Recent Insider Trading
        </p>
        {signal && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
            <span style={{ fontSize: '18px', fontWeight: 800, color: dirColor, letterSpacing: '0.5px', textTransform: 'uppercase' as const }}>
              {signal.signal_direction}
            </span>
            <span style={{ fontSize: '13px', color: dirColor }}>
              {signalStrengthLabel(signal.expected_move_pct)}
            </span>
            {signal.signal_month && (
              <span style={{ fontSize: '11px', color: '#7b8498' }}>
                {fmtMonth(signal.signal_month)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Conviction score panel (shown when loaded) */}
      {!loadingConviction && conviction && (
        <ConvictionPanel conviction={conviction} />
      )}

      {/* Trade list */}
      {trades.length > 0 ? (
        <div>
          {trades.map((trade, i) => (
            <div key={trade.id}>
              {i > 0 && <div style={{ height: '1px', background: '#1a1f2a', marginLeft: '18px' }} />}
              <TradeRow trade={trade} marketCap={marketCap} />
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: '13px', color: '#7b8498', margin: 0 }}>
          No recent insider transactions for {ticker}.
        </p>
      )}

      {/* Full analysis link */}
      <div style={{ marginTop: '20px' }}>
        <a
          href={`/insider/${ticker}`}
          style={{ fontSize: '12px', color: '#7b8498', textDecoration: 'none', letterSpacing: '0.5px' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#c9d1d9')}
          onMouseLeave={e => (e.currentTarget.style.color = '#7b8498')}
        >
          See full analysis →
        </a>
      </div>
    </div>
  )
}
