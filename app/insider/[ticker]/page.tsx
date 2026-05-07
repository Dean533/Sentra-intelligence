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
  classification: string
}

type TickerMeta = {
  name: string | null
  sector: string | null
  market_cap: number | null
  price: number | null
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
  const oppTrades = trades.filter((t) => t.classification === 'OPPORTUNISTIC')
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

function ClassBadge({ classification }: { classification: string }) {
  if (classification === 'OPPORTUNISTIC') {
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
  if (classification === 'UNCLASSIFIABLE') {
    return (
      <span style={{
        fontSize: '10px', fontWeight: 600, letterSpacing: '0.5px',
        padding: '2px 7px', borderRadius: '4px',
        background: 'rgba(158,203,255,0.08)', color: '#9ecbff',
        border: '1px solid rgba(158,203,255,0.15)',
      }}>
        UNCLASSIFIABLE
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

  const [signal,     setSignal]     = useState<Signal | null>(null)
  const [trades,     setTrades]     = useState<Trade[]>([])
  const [meta,       setMeta]       = useState<TickerMeta | null>(null)
  const [conviction, setConviction] = useState<ConvictionData | null>(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    if (!ticker) return
    setLoading(true)

    Promise.all([
      fetch(`/api/insider/cmp-signal/${ticker}`).then((r) => r.json()),
      fetch(`/api/insider/fetch?ticker=${ticker}&limit=50`).then((r) => r.json()),
      fetch(`/api/ticker/${ticker}`).then((r) => r.json()),
      fetch(`/api/insider/conviction/${ticker}`).then((r) => r.json()),
    ]).then(([sigRes, tradesRes, tickerRes, convRes]) => {
      setSignal(sigRes.data ?? null)
      setTrades(tradesRes.rows ?? [])
      setConviction(convRes.data ?? null)
      const q = tickerRes?.quote
      const t = tickerRes?.ticker
      setMeta({
        name:       q?.longName ?? q?.shortName ?? t?.name ?? null,
        sector:     t?.sector  ?? q?.sector    ?? null,
        market_cap: q?.marketCap ?? null,
        price:      q?.regularMarketPrice ?? q?.currentPrice ?? null,
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

  const hasConviction = conviction != null && conviction.score > 0

  function buildReasoningBullets(
    factors: string[],
    totalValue: number | null,
    insiderClassification: string | null,
  ): { label: string; detail: string }[] {
    const bullets: { label: string; detail: string }[] = []

    for (const f of factors) {
      const lookup = f.match(/^Lookup rank (\d+): (.+?) · (.+?) · (\S+) — n=(\d+), avg α=([-\d.]+)%, hit=(\d+)%/)
      if (lookup) {
        const [, , lookupRole, sector, size, n, avgAlpha, hit] = lookup
        const alpha = parseFloat(avgAlpha)

        const roleDesc = lookupRole === 'all roles'    ? 'any insider role (no role filter applied)'
                       : lookupRole === 'CEO'          ? 'CEO — highest signal seniority'
                       : lookupRole === 'CFO'          ? 'CFO — senior officer'
                       : lookupRole === '10% Owner'    ? '10% Owner — major shareholder'
                       : lookupRole === 'Director'     ? 'Director — board-level signal'
                       : lookupRole === 'President'    ? 'President — senior executive'
                       : `${lookupRole} — moderate signal role`
        bullets.push({ label: 'Role', detail: roleDesc })

        const alphaQuality = alpha >= 10 ? 'historically high alpha for this combination'
                           : alpha >= 5  ? 'historically moderate alpha'
                           : alpha >= 0  ? 'historically modest alpha'
                           : 'historically mixed alpha'
        const sectorText = sector === 'all sectors' ? 'all sectors' : sector
        bullets.push({ label: 'Sector', detail: `${sectorText} (${alphaQuality})` })

        bullets.push({ label: 'Historical match', detail: `${n} similar trades averaged ${avgAlpha}% alpha, ${hit}% win rate at 90 days` })
        continue
      }

      if (f.includes('< $250K: capped')) {
        const fmtVal = totalValue == null ? 'below $250K'
                     : totalValue >= 1_000_000 ? `$${(totalValue / 1_000_000).toFixed(1)}M`
                     : totalValue >= 1_000     ? `$${(totalValue / 1_000).toFixed(0)}K`
                     : `$${totalValue.toLocaleString()}`
        bullets.push({ label: 'Purchase size', detail: `${fmtVal} (below $250K threshold — score capped at 30)` })
        continue
      }

      const tickerExcl = f.match(/Excluded ticker (\w+): ([-\d]+)/)
      if (tickerExcl) {
        bullets.push({ label: 'Ticker adjustment', detail: `${tickerExcl[1]} has shown below-average alpha for this pattern in backtests` })
        continue
      }

      const insiderExcl = f.match(/Excluded insider \((.+?)\): ([-\d]+)/)
      if (insiderExcl) {
        bullets.push({ label: 'Insider adjustment', detail: `${insiderExcl[1]} has a historical pattern of weaker signal quality` })
        continue
      }
    }

    if (insiderClassification === 'OPPORTUNISTIC') {
      bullets.push({ label: 'Classification', detail: 'Opportunistic — breaks from historical trading calendar, likely information-driven' })
    } else if (insiderClassification === 'UNCLASSIFIABLE') {
      bullets.push({ label: 'Classification', detail: 'Unclassifiable — insufficient trading history to establish a routine pattern' })
    } else if (insiderClassification === 'ROUTINE') {
      bullets.push({ label: 'Classification', detail: 'Routine — follows predictable calendar pattern, lower signal quality' })
    }

    return bullets
  }

  function scorePercentile(score: number): string {
    if (score >= 90) return 'This signal is ranked in the top 5% of all insider purchases in our database.'
    if (score >= 80) return 'This signal is ranked in the top 10% of all insider purchases in our database.'
    if (score >= 70) return 'This signal is ranked in the top 20% of all insider purchases in our database.'
    if (score >= 60) return 'This signal is ranked in the top 30% of all insider purchases in our database.'
    if (score >= 50) return 'This signal is ranked in the top 40% of all insider purchases in our database.'
    if (score >= 40) return 'This signal is ranked in the bottom 40% of all insider purchases in our database.'
    if (score >= 31) return 'This signal is ranked in the bottom 35% of all insider purchases in our database.'
    return 'This signal is ranked in the bottom 30% of all insider purchases in our database.'
  }

  function convBarColor(s: number) {
    if (s >= 85) return '#3fb950'
    if (s >= 70) return '#58a6ff'
    if (s >= 50) return '#d4a037'
    return '#f85149'
  }
  function signalColor(s: number) {
    if (s >= 70) return '#3fb950'
    if (s >= 51) return '#d29922'
    return '#7b8498'
  }
  function signalLabel(s: number) {
    if (s >= 85) return 'Very Strong Signal'
    if (s >= 70) return 'Strong Signal'
    if (s >= 51) return 'Moderate Signal'
    if (s >= 31) return 'Weak Signal'
    return 'No Signal'
  }

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
          <p style={secTitle}>Conviction Score</p>
          {hasConviction ? (() => {
            const { score, factors } = conviction!
            const barColor = convBarColor(score)
            const clsColor = signalColor(score)
            const recentPurchase = trades.find(t => t.transaction_code === 'P')
            const insiderClassification = recentPurchase?.classification ?? null
            const totalValue = recentPurchase?.total_value ?? null
            const bullets = buildReasoningBullets(factors, totalValue, insiderClassification)
            return (
              <div style={{ background: '#0d1117', border: '1px solid #1f2937', borderRadius: '6px', padding: '16px' }}>
                {/* Score row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                  <span style={{ fontSize: '11px', letterSpacing: '1.5px', color: '#7b8498', textTransform: 'uppercase' }}>Score</span>
                  <span style={{ fontSize: '22px', fontWeight: 800, color: barColor, letterSpacing: '-0.5px' }}>
                    {score}<span style={{ fontSize: '14px', fontWeight: 400, color: '#4a5568', marginLeft: '2px' }}>/100</span>
                  </span>
                </div>
                {/* Score bar */}
                <div style={{ height: '3px', background: '#1f2937', borderRadius: '2px', marginBottom: '12px' }}>
                  <div style={{ height: '100%', width: `${score}%`, background: barColor, borderRadius: '2px', transition: 'width 0.4s ease' }} />
                </div>
                {/* Signal label + source label */}
                <div style={{ marginBottom: '12px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: clsColor, letterSpacing: '0.5px' }}>
                    {signalLabel(score)}
                  </span>
                  <div style={{ fontSize: '11px', color: '#4a5568', marginTop: '4px' }}>
                    Based on most recent insider purchase
                  </div>
                </div>
                {/* Why this score? */}
                {bullets.length > 0 && (
                  <div style={{ borderTop: '1px solid #1f2937', paddingTop: '12px' }}>
                    <div style={{ fontSize: '11px', letterSpacing: '1px', color: '#7b8498', textTransform: 'uppercase', marginBottom: '8px' }}>
                      Why this score?
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {bullets.map((b, i) => (
                        <div key={i} style={{ fontSize: '12px', display: 'flex', gap: '8px' }}>
                          <span style={{ color: '#4a5568', flexShrink: 0, minWidth: '110px', fontWeight: 600 }}>
                            {b.label}
                          </span>
                          <span style={{ color: '#7b8498' }}>{b.detail}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: '12px', fontSize: '11px', color: '#4a5568', borderTop: '1px solid #131820', paddingTop: '10px' }}>
                      {scorePercentile(score)}
                    </div>
                  </div>
                )}
              </div>
            )
          })() : (
            <p style={{ fontSize: '15px', color: '#7b8498', margin: 0 }}>
              No actionable signal for {ticker}.
            </p>
          )}
        </div>

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
                          <ClassBadge classification={trade.classification} />
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
