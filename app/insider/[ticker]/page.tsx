'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import BackButton from '@/app/components/BackButton'

// ─── Types ────────────────────────────────────────────────────────────────────

type Signal = {
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
  role: string | null
  transaction_date: string
  transaction_direction: string | null
  transaction_code: string
  total_value: number | null
  shares: number | null
  price_per_share: number | null
  insider_cik: string | null
  is_opportunistic: boolean
}

type TickerMeta = {
  name: string | null
  sector: string | null
  market_cap: number | null
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
  return new Date(s).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

// expected_move_pct is a log-scale CMP formula score (range ~-0.43 to +0.46), not a real %.
function signalStrengthLabel(v: number): string {
  if (v > 0.3)   return 'Strong bullish signal'
  if (v > 0.05)  return 'Bullish signal'
  if (v < -0.2)  return 'Strong bearish signal'
  if (v < -0.05) return 'Bearish signal'
  return 'Neutral'
}

// ─── Verdict prose ────────────────────────────────────────────────────────────

function buildVerdictProse(signal: Signal, ticker: string, trades: Trade[]): string {
  const month = fmtMonth(signal.signal_month)
  const buys  = signal.opportunistic_buy_count
  const sells = signal.opportunistic_sell_count

  // Find the largest opportunistic trade to name-drop
  const oppTrades = trades.filter((t) => t.is_opportunistic)
  const topTrade  = oppTrades.sort((a, b) => (b.total_value ?? 0) - (a.total_value ?? 0))[0] ?? null

  let sentence1 = ''
  if (topTrade) {
    const dir  = topTrade.transaction_direction === 'buy' || topTrade.transaction_code === 'P' ? 'purchased' : 'sold'
    const role = topTrade.officer_title ?? topTrade.role ?? 'an insider'
    sentence1 = `${topTrade.insider_name} (${role}) ${dir} ${fmtValue(topTrade.total_value)} of ${ticker} in ${month}, classified as opportunistic — breaking from their historical trading pattern.`
  } else if (buys > 0 || sells > 0) {
    const parts: string[] = []
    if (buys  > 0) parts.push(`${buys} opportunistic buy${buys  !== 1 ? 's' : ''}`)
    if (sells > 0) parts.push(`${sells} opportunistic sell${sells !== 1 ? 's' : ''}`)
    sentence1 = `${ticker} had ${parts.join(' and ')} in ${month} from insiders classified as opportunistic.`
  }

  const strengthLabel = signalStrengthLabel(signal.expected_move_pct).toLowerCase()
  const sentence2 = `Sentra's analysis of timing and trade size relative to historical patterns shows a ${strengthLabel} over the next 1–6 months.`

  const sentence3 = signal.routine_trades_filtered > 0
    ? `${signal.routine_trades_filtered} routine trade${signal.routine_trades_filtered !== 1 ? 's were' : ' was'} excluded from this signal — insiders who trade on a predictable calendar are not counted.`
    : ''

  return [sentence1, sentence2, sentence3].filter(Boolean).join(' ')
}

// ─── Classification badge ─────────────────────────────────────────────────────

function ClassBadge({ isOpportunistic }: { isOpportunistic: boolean }) {
  if (isOpportunistic) {
    return (
      <span style={{
        fontSize: '10px', fontWeight: 700, letterSpacing: '0.5px',
        padding: '2px 7px', borderRadius: '4px',
        background: 'rgba(63,185,80,0.12)', color: '#3fb950',
        border: '1px solid rgba(63,185,80,0.25)',
      }}>
        OPPORTUNISTIC
      </span>
    )
  }
  return (
    <span style={{
      fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px',
      padding: '2px 7px', borderRadius: '4px',
      background: 'rgba(123,132,152,0.1)', color: '#7b8498',
      border: '1px solid rgba(123,132,152,0.15)',
    }}>
      ROUTINE
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InsiderAnalysisPage() {
  const params = useParams()
  const ticker = (params?.ticker as string)?.toUpperCase()

  const [signal,       setSignal]       = useState<Signal | null>(null)
  const [trades,       setTrades]       = useState<Trade[]>([])
  const [meta,         setMeta]         = useState<TickerMeta | null>(null)
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)

    Promise.all([
      fetch(`/api/insider/cmp-signal/${ticker}`).then((r) => r.json()),
      fetch(`/api/insider/fetch?ticker=${ticker}&limit=50`).then((r) => r.json()),
      fetch(`/api/ticker/${ticker}`).then((r) => r.json()),
    ]).then(([sigRes, tradesRes, tickerRes]) => {
      setSignal(sigRes.data ?? null)
      setTrades(tradesRes.rows ?? [])
      const q = tickerRes?.quote
      const t = tickerRes?.ticker
      setMeta({
        name:       q?.longName ?? q?.shortName ?? t?.name ?? null,
        sector:     t?.sector  ?? q?.sector    ?? null,
        market_cap: q?.marketCap ?? null,
      })
    }).finally(() => setLoading(false))
  }, [ticker])

  const secTitle: React.CSSProperties = {
    fontSize: '11px', letterSpacing: '2px', color: '#7b8498',
    textTransform: 'uppercase', margin: '0 0 24px',
  }

  const sep: React.CSSProperties = {
    padding: '40px 0',
    borderBottom: '1px solid #1e2530',
  }

  if (loading) {
    return (
      <div style={{ background: '#0a0e14', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#7b8498', fontSize: '14px', letterSpacing: '1px' }}>LOADING {ticker}…</div>
      </div>
    )
  }

  const dirColor =
    signal?.signal_direction === 'bullish' ? '#3fb950' :
    signal?.signal_direction === 'bearish' ? '#f85149' : '#7b8498'

  const verdictProse = signal && trades.length > 0
    ? buildVerdictProse(signal, ticker, trades)
    : signal
    ? `${ticker} has a ${signal.signal_direction} insider signal for ${fmtMonth(signal.signal_month)} based on ${signal.opportunistic_buy_count} opportunistic buy${signal.opportunistic_buy_count !== 1 ? 's' : ''} and ${signal.opportunistic_sell_count} sell${signal.opportunistic_sell_count !== 1 ? 's' : ''}.`
    : null

  return (
    <div style={{ background: '#0a0e14', minHeight: '100vh', color: '#e6edf3', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0 40px 100px' }}>

        {/* ── back ──────────────────────────────────────────────────────────── */}
        <div style={{ paddingTop: '24px', paddingBottom: '20px' }}>
          <BackButton label={ticker} href={`/t/${ticker}`} />
        </div>

        {/* ── header ────────────────────────────────────────────────────────── */}
        <div style={{ paddingBottom: '32px', borderBottom: '1px solid #1e2530' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
            <h1 style={{ fontSize: '48px', fontWeight: 800, margin: 0, lineHeight: 1, letterSpacing: '-1px' }}>
              {ticker}
            </h1>
            {meta?.sector && (
              <span style={{
                fontSize: '12px', padding: '4px 12px', borderRadius: '20px',
                border: '1px solid #2a3a50', background: 'rgba(158,203,255,0.06)',
                color: '#9ecbff', letterSpacing: '0.5px', alignSelf: 'center', marginTop: '6px',
              }}>
                {meta.sector}
              </span>
            )}
          </div>
          {meta?.name && (
            <div style={{ color: '#c9d1d9', fontSize: '17px', marginTop: '4px' }}>{meta.name}</div>
          )}
          <div style={{ color: '#7b8498', fontSize: '12px', letterSpacing: '1px', marginTop: '8px', textTransform: 'uppercase' }}>
            Insider Signal Analysis
          </div>
        </div>

        {/* ── verdict ───────────────────────────────────────────────────────── */}
        <div style={sep}>
          {signal ? (
            <>
              {/* direction + strength label */}
              <div style={{ marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '44px', fontWeight: 900, color: dirColor, letterSpacing: '-0.5px', textTransform: 'uppercase', lineHeight: 1 }}>
                    {signal.signal_direction}
                  </span>
                  <span style={{ fontSize: '22px', fontWeight: 600, color: dirColor, alignSelf: 'center' }}>
                    {signalStrengthLabel(signal.expected_move_pct)}
                  </span>
                </div>
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '12px', color: '#7b8498' }}>
                    1–6 month signal window · {fmtMonth(signal.signal_month)}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: '#4a5568', margin: '6px 0 0', maxWidth: '560px' }}>
                  Based on the timing and size of recent insider trades, adjusted for historical trading patterns
                </p>
              </div>

              {/* prose explanation */}
              {verdictProse && (
                <p style={{ fontSize: '15px', lineHeight: '1.7', color: '#c9d1d9', margin: 0, maxWidth: '720px' }}>
                  {verdictProse}
                </p>
              )}
            </>
          ) : (
            <div>
              <p style={secTitle}>Verdict</p>
              <p style={{ fontSize: '15px', color: '#7b8498', margin: 0 }}>
                No active CMP insider signal for {ticker} in the past 6 months.
              </p>
            </div>
          )}
        </div>

        {/* ── signal breakdown ──────────────────────────────────────────────── */}
        {signal && (
          <div style={sep}>
            <p style={secTitle}>Signal Breakdown</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '24px' }}>

              <div>
                <div style={{ fontSize: '11px', color: '#7b8498', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Opportunistic Buys</div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#3fb950' }}>{signal.opportunistic_buy_count}</div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#7b8498', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Opportunistic Sells</div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#f85149' }}>{signal.opportunistic_sell_count}</div>
              </div>

              {signal.cluster_strength && (
                <div>
                  <div style={{ fontSize: '11px', color: '#7b8498', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Cluster Strength</div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: signal.cluster_strength === 'HIGH' ? '#3fb950' : signal.cluster_strength === 'MEDIUM' ? '#d29922' : '#7b8498' }}>
                    {signal.cluster_strength}
                  </div>
                </div>
              )}

              <div>
                <div style={{ fontSize: '11px', color: '#7b8498', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>Routine Filtered</div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#7b8498' }}>{signal.routine_trades_filtered}</div>
                <div style={{ fontSize: '11px', color: '#4a5568', marginTop: '4px' }}>Trades on predictable calendars — excluded per CMP methodology</div>
              </div>

            </div>
          </div>
        )}

        {/* ── trade history table ───────────────────────────────────────────── */}
        <div style={{ ...sep, borderBottom: 'none' }}>
          <p style={secTitle}>Full Trade History</p>

          {trades.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#7b8498', margin: 0 }}>
              No insider transactions found for {ticker}.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e2530' }}>
                    {['Date', 'Insider', 'Role', 'Type', 'Amount', 'Shares', 'Price', 'Classification'].map((h) => (
                      <th key={h} style={{
                        textAlign: 'left', padding: '8px 12px',
                        fontSize: '11px', letterSpacing: '1px', color: '#7b8498',
                        textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap',
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, i) => {
                    const isBuy    = trade.transaction_direction === 'buy' || trade.transaction_code === 'P'
                    const dirColor = isBuy ? '#3fb950' : '#f85149'
                    const dirLabel = isBuy ? 'BUY' : 'SELL'
                    return (
                      <tr
                        key={trade.id}
                        style={{
                          borderBottom: '1px solid #111620',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        }}
                      >
                        <td style={{ padding: '10px 12px', color: '#7b8498', whiteSpace: 'nowrap' }}>
                          {fmtDate(trade.transaction_date)}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#e6edf3', fontWeight: 600 }}>
                          {trade.insider_name}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#7b8498', maxWidth: '160px' }}>
                          {trade.officer_title ?? trade.role ?? '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ fontWeight: 700, color: dirColor, letterSpacing: '0.5px' }}>
                            {dirLabel}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'nowrap' }}>
                          {fmtValue(trade.total_value)}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#7b8498', whiteSpace: 'nowrap' }}>
                          {trade.shares != null ? trade.shares.toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '10px 12px', color: '#7b8498', whiteSpace: 'nowrap' }}>
                          {trade.price_per_share != null ? `$${trade.price_per_share.toFixed(2)}` : '—'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <ClassBadge isOpportunistic={trade.is_opportunistic} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── methodology note ─────────────────────────────────────────────── */}
        <div style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid #1e2530' }}>
          <p style={{ fontSize: '12px', color: '#4a5568', margin: 0, lineHeight: '1.6' }}>
            Signal methodology based on Cohen, Malloy &amp; Pomorski (2012) "Decoding Inside Information."
            Routine insiders — those who trade in the same calendar month across multiple years — are excluded.
            Only opportunistic insiders, who break from their historical pattern, are counted toward the signal.
          </p>
        </div>

      </div>
    </div>
  )
}
