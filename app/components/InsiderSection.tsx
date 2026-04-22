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

// ─── Trade row ────────────────────────────────────────────────────────────────

function TradeRow({ trade, marketCap }: { trade: Trade; marketCap: number | null }) {
  const isBuy      = trade.transaction_direction === 'buy' || trade.transaction_code === 'P'
  const dirColor   = isBuy ? '#3fb950' : '#f85149'
  const dirLabel   = isBuy ? 'BUY' : 'SELL'
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
  const [signal,        setSignal]        = useState<CmpSignal | null>(null)
  const [trades,        setTrades]        = useState<Trade[]>([])
  const [loadingSignal, setLoadingSignal] = useState(true)
  const [loadingTrades, setLoadingTrades] = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoadingSignal(true)
    setLoadingTrades(true)

    fetch(`/api/insider/cmp-signal/${ticker}`)
      .then((r) => r.json())
      .then((d) => setSignal(d.data ?? null))
      .finally(() => setLoadingSignal(false))

    fetch(`/api/insider/fetch?ticker=${ticker}&limit=5`)
      .then((r) => r.json())
      .then((d) => {
        console.log(`[InsiderSection] fetch response for ${ticker}:`, d)
        setTrades(d.rows ?? [])
      })
      .finally(() => setLoadingTrades(false))
  }, [ticker])

  if (loadingSignal || loadingTrades) return null
  if (!signal && trades.length === 0) return null

  const dirColor =
    signal?.signal_direction === 'bullish' ? '#3fb950' :
    signal?.signal_direction === 'bearish' ? '#f85149' : '#7b8498'

  const emFormatted = signal
    ? (signal.expected_move_pct >= 0 ? '+' : '') + signal.expected_move_pct.toFixed(2) + '%'
    : null

  return (
    <div>
      {/* Top row: section label + signal direction */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '24px' }}>
        <p style={{
          fontSize: '11px', letterSpacing: '2px', color: '#7b8498',
          textTransform: 'uppercase', margin: 0,
        }}>
          Recent Insider Trading
        </p>
        {signal && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
            <span style={{ fontSize: '18px', fontWeight: 800, color: dirColor, letterSpacing: '0.5px', textTransform: 'uppercase' as const }}>
              {signal.signal_direction}
            </span>
            <span style={{ fontSize: '18px', fontWeight: 700, color: dirColor }}>
              {emFormatted}
            </span>
            {signal.signal_month && (
              <span style={{ fontSize: '11px', color: '#7b8498' }}>
                {fmtMonth(signal.signal_month)}
              </span>
            )}
          </div>
        )}
      </div>

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
    </div>
  )
}
