// Display helpers for insider-transaction rows, shared by the homepage and the ticker page.
import { classifyRole, type computeConvictionScore } from '@/lib/scoring/convictionScore'

export type Breakdown = { label: string; pts: string; pct: number }

export function displayRole(r: { role: string | null; officer_title: string | null }): string {
  const cls = classifyRole(r)
  if (cls === 'Insider (other)') return 'Insider'
  if (cls === 'Co-Founder/Partner') return 'Co-founder'
  if (cls === 'Other/EVP') {
    const t = (r.officer_title ?? r.role ?? '').trim()
    if (!t) return 'Officer'
    return t.length > 24 ? `${t.slice(0, 23)}…` : t
  }
  return cls
}

const ENTITY_RE = /\b(LLC|L\.?P\.?|INC|CORP|CO|FUND|TRUST|CAPITAL|PARTNERS|HOLDINGS|MANAGEMENT|GROUP|LTD|ADVISORS|INVESTMENTS?)\b\.?/i
const SUFFIX_RE = /^(JR|SR|II|III|IV|V)\.?$/i

function titleCase(w: string): string {
  if (SUFFIX_RE.test(w) && /^[IV]+$/i.test(w)) return w.toUpperCase()
  return w
    .toLowerCase()
    .replace(/(^|[-'])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())
    .replace(/^Mc(\p{L})/u, (_, c: string) => 'Mc' + c.toUpperCase())
}

// SEC Form 4 names are "LAST FIRST MIDDLE [SUFFIX]". Turn person names into
// "First Middle Last Suffix"; leave entity names (funds, LLCs) in order.
export function formatInsiderName(raw: string | null): string {
  if (!raw) return 'Unknown insider'
  const name = raw.trim().replace(/\s+/g, ' ')
  const isUpper = name === name.toUpperCase()
  if (ENTITY_RE.test(name) || name.includes(',')) return isUpper ? name.split(' ').map(titleCase).join(' ') : name
  const parts = name.split(' ')
  if (parts.length < 2 || parts.length > 5) return isUpper ? parts.map(titleCase).join(' ') : name
  const suffix = SUFFIX_RE.test(parts[parts.length - 1]) ? parts.pop()! : null
  const [last, ...rest] = parts
  const ordered = [...rest.map((p) => (p.length === 1 ? `${p}.` : p)), last, ...(suffix ? [suffix] : [])]
  return ordered.map((p) => (isUpper || p === p.toUpperCase() ? titleCase(p) : p)).join(' ')
}

export function fmtMoney(v: number | null): string {
  if (v == null) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`
  return `$${Math.round(v)}`
}

// Stake change from holdingsDeltaPct(). null = prior stake unknown (usually a new position).
export function fmtStake(s: { pct: number; capped: boolean } | null, isBuy = true): string {
  if (!s) return isBuy ? 'New' : '—'
  const a = Math.abs(s.pct)
  if (a > 0 && a < 0.1) return '<0.1%'
  const v = a >= 10 ? Math.round(a) : Number(a.toFixed(1))
  if (s.capped) return `>${s.pct < 0 ? '−' : ''}${v}%`
  return `${s.pct < 0 ? '−' : '+'}${v}%`
}

// Calendar dates (YYYY-MM-DD) formatted in UTC so they don't shift a day.
export function fmtDate(iso: string, withYear = false): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
}

export function toBreakdown(
  b: ReturnType<typeof computeConvictionScore>['breakdown'],
  role: string,
): Breakdown[] {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  const out: Breakdown[] = b.map((f) => ({
    label: f.factor === 'Role' ? `Insider role (${role})` : f.factor,
    pts: `${fmt(f.points)}/${f.maxPoints}`,
    pct: f.maxPoints ? Math.max(0, Math.min(100, (f.points / f.maxPoints) * 100)) : 0,
  }))
  // Opportunistic scores omit momentum entirely; show it as n/a so the 4 factors are visible.
  if (!b.some((f) => f.factor === 'Price momentum')) {
    out.push({ label: 'Price momentum (not used for Opportunistic)', pts: 'n/a', pct: 0 })
  }
  return out
}
