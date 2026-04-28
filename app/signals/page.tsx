import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

type SignalRow = {
  ticker: string
  signal_direction: 'bullish' | 'bearish' | 'neutral'
  conviction_score: number | null
  hold_days: number | null
  signal_month: string
}

function scoreColor(score: number | null): string {
  if (score == null || score === 0) return '#4a5568'
  if (score >= 85) return '#3fb950'
  if (score >= 70) return '#58a6ff'
  if (score >= 50) return '#d4a037'
  return '#f85149'
}

function dirColor(dir: string): string {
  if (dir === 'bullish') return '#3fb950'
  if (dir === 'bearish') return '#f85149'
  return '#7b8498'
}

function classificationLabel(score: number | null): string {
  if (score == null || score < 50) return 'Do not trade'
  if (score < 70) return 'Monitor only'
  if (score < 85) return 'Take trade'
  return 'High conviction'
}

function fmtMonth(s: string): string {
  return new Date(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export default async function SignalsPage() {
  const currentMonth = new Date()
  currentMonth.setUTCDate(1)
  currentMonth.setUTCHours(0, 0, 0, 0)
  const monthStr = currentMonth.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('insider_signals_monthly')
    .select('ticker, signal_direction, conviction_score, hold_days, signal_month')
    .eq('signal_month', monthStr)
    .order('conviction_score', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) {
    return (
      <div style={{ color: '#f85149', padding: '24px', fontFamily: 'monospace', fontSize: '13px' }}>
        Error loading signals: {error.message}
      </div>
    )
  }

  const rows = (data ?? []) as SignalRow[]
  const monthLabel = rows[0] ? fmtMonth(rows[0].signal_month) : '—'
  const tradeable  = rows.filter(r => (r.conviction_score ?? 0) >= 70).length

  return (
    <main style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 24px', fontFamily: 'monospace' }}>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '18px', fontWeight: 700, color: '#e6edf3', margin: '0 0 6px', letterSpacing: '-0.3px' }}>
          Insider Signals
        </h1>
        <p style={{ fontSize: '12px', color: '#7b8498', margin: 0 }}>
          {monthLabel} · {rows.length} ticker{rows.length !== 1 ? 's' : ''} · {tradeable} tradeable (score ≥ 70)
        </p>
      </div>

      {rows.length === 0 ? (
        <p style={{ color: '#7b8498', fontSize: '13px' }}>No signals computed for this month yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '72px 1fr 56px 96px 54px',
            padding: '8px 14px',
            fontSize: '10px', letterSpacing: '1.5px', color: '#4a5568',
            textTransform: 'uppercase',
            borderBottom: '1px solid #1a1f2a',
          }}>
            <span>Ticker</span>
            <span>Verdict</span>
            <span style={{ textAlign: 'right' }}>Score</span>
            <span style={{ textAlign: 'center' }}>Direction</span>
            <span style={{ textAlign: 'right' }}>Hold</span>
          </div>

          {rows.map((row, i) => {
            const sc       = row.conviction_score ?? 0
            const scColor  = scoreColor(row.conviction_score)
            const cls      = classificationLabel(row.conviction_score)
            const isActive = sc >= 70

            return (
              <Link key={row.ticker} href={`/t/${row.ticker}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '72px 1fr 56px 96px 54px',
                  padding: '13px 14px',
                  borderBottom: '1px solid #1a1f2a',
                  background: isActive ? 'rgba(88, 166, 255, 0.03)' : 'transparent',
                  cursor: 'pointer',
                }}>
                  <span style={{ fontSize: '14px', fontWeight: 700, color: '#e6edf3' }}>
                    {row.ticker}
                  </span>
                  <span style={{ fontSize: '12px', color: scColor, fontWeight: isActive ? 600 : 400 }}>
                    {cls}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: scColor, lineHeight: 1 }}>
                      {sc}
                    </span>
                    <div style={{ width: '36px', height: '2px', background: '#1f2937', borderRadius: '1px' }}>
                      <div style={{ height: '100%', width: `${sc}%`, background: scColor, borderRadius: '1px' }} />
                    </div>
                  </div>
                  <span style={{
                    fontSize: '11px', color: dirColor(row.signal_direction),
                    textAlign: 'center', fontWeight: 600, textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {row.signal_direction}
                  </span>
                  <span style={{ fontSize: '12px', color: '#7b8498', textAlign: 'right' }}>
                    {row.hold_days ? `${row.hold_days}d` : '—'}
                  </span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </main>
  )
}
