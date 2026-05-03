'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

// ─── types ────────────────────────────────────────────────────────────────────

type SignalRow = {
  id:                string
  ticker:            string
  insider_name:      string | null
  officer_title:     string | null
  role:              string | null
  transaction_date:  string
  total_value:       number | null
  filed_date:        string | null
  days_since_filing: number | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtValue(v: number | null) {
  if (!v) return null
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtDate(s: string) {
  return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function displayRole(row: SignalRow): string | null {
  return row.officer_title || row.role || null
}

// ─── filter bar ───────────────────────────────────────────────────────────────

const dropdownStyle: React.CSSProperties = {
  background: '#0d1117', color: '#e6edf3', border: '1px solid #1e2530',
  borderRadius: '6px', padding: '6px 10px', fontSize: '13px', cursor: 'pointer',
  outline: 'none',
}

function FilterBar({
  days, setDays,
  role, setRole,
}: {
  days: string; setDays: (v: string) => void
  role: string; setRole: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '28px' }}>
      <select value={days} onChange={e => setDays(e.target.value)} style={dropdownStyle}>
        <option value="30">Last 30 days</option>
        <option value="60">Last 60 days</option>
        <option value="90">Last 90 days</option>
        <option value="all">All time</option>
      </select>
      <select value={role} onChange={e => setRole(e.target.value)} style={dropdownStyle}>
        <option value="all">All Roles</option>
        <option value="ceo">CEO</option>
        <option value="cfo">CFO</option>
        <option value="director">Director</option>
        <option value="10pct">10% Owner</option>
      </select>
    </div>
  )
}

// ─── card ─────────────────────────────────────────────────────────────────────

function SignalCard({ row }: { row: SignalRow }) {
  const router = useRouter()
  const val    = fmtValue(row.total_value)
  const role   = displayRole(row)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={() => router.push(`/t/${row.ticker}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background:   hovered ? '#111620' : '#0d1117',
        borderTop:    `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
        borderRight:  `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
        borderBottom: `1px solid ${hovered ? '#2a3a50' : '#1e2530'}`,
        borderLeft:   '3px solid #3fb950',
        borderRadius: '10px',
        padding:      '16px 20px',
        cursor:       'pointer',
        transition:   'background 0.15s, border-color 0.15s',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'space-between',
        gap:          '16px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
          <span style={{ fontSize: '18px', fontWeight: 800, color: '#e6edf3', letterSpacing: '-0.3px' }}>
            {row.ticker}
          </span>
          <span style={{
            fontSize: '10px', fontWeight: 700, letterSpacing: '1px',
            padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase',
            color: '#3fb950', border: '1px solid #3fb95033', background: '#3fb95011',
          }}>
            OPPORTUNISTIC
          </span>
        </div>

        {row.insider_name && (
          <div style={{ fontSize: '13px', color: '#c9d1d9', fontWeight: 500 }}>
            {row.insider_name}
          </div>
        )}
        {role && (
          <div style={{ fontSize: '11px', color: '#7b8498', marginTop: '2px' }}>
            {role}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '8px', flexWrap: 'wrap' }}>
          {val && (
            <span style={{ fontSize: '12px', color: '#e6edf3', fontWeight: 600 }}>{val}</span>
          )}
          <span style={{ fontSize: '12px', color: '#7b8498' }}>{fmtDate(row.transaction_date)}</span>
          {row.days_since_filing !== null && (
            <span style={{ fontSize: '12px', color: '#7b8498' }}>
              Filed {row.days_since_filing}d ago
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function TopSignalsPage() {
  const [rows,    setRows]    = useState<SignalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [days,    setDays]    = useState('90')
  const [role,    setRole]    = useState('all')

  useEffect(() => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ days, role })
    fetch(`/api/insider/top-signals?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setRows(d.data ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [days, role])

  return (
    <div style={{
      background: '#0a0e14', minHeight: '100vh', color: '#e6edf3',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '48px 40px 80px' }}>

        <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 10px' }}>
          SENTRA INTELLIGENCE
        </p>
        <h1 style={{ fontSize: '36px', fontWeight: 800, margin: '0 0 8px', letterSpacing: '-0.5px' }}>
          Top Signals
        </h1>
        <p style={{ fontSize: '14px', color: '#7b8498', margin: '0 0 32px', lineHeight: 1.6 }}>
          Most recent confirmed opportunistic insider purchases.
        </p>

        <FilterBar days={days} setDays={setDays} role={role} setRole={setRole} />

        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{
                height: '96px', borderRadius: '10px', background: '#0d1117',
                border: '1px solid #1e2530', animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            ))}
          </div>
        )}

        {error && !loading && (
          <div style={{
            background: '#1a0d0d', border: '1px solid #5a1a1a',
            borderRadius: '10px', padding: '20px', color: '#f85149', fontSize: '13px',
          }}>
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div style={{
            background: '#0d1117', border: '1px solid #1e2530',
            borderRadius: '12px', padding: '48px 32px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '14px', color: '#7b8498' }}>
              No confirmed opportunistic purchases match these filters.
            </div>
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <>
            <div style={{ fontSize: '12px', color: '#7b8498', marginBottom: '12px' }}>
              <span style={{ color: '#e6edf3', fontWeight: 600 }}>{rows.length}</span> purchase{rows.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {rows.map(row => <SignalCard key={row.id} row={row} />)}
            </div>
          </>
        )}

      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
