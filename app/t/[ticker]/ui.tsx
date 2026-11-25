// Presentational pieces shared by the ticker page's client view (TickerView,
// TickerNews) and its server-rendered sections (SimilarCompanies, skeleton).
// No hooks, no 'use client': safe to render on either side.

export const labelMono = 'font-mono text-[11px] tracking-[0.08em] text-muted'
export const h2Cls = 'm-0 font-serif text-[26px] font-normal leading-tight text-heading md:text-[30px]'

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} aria-hidden="true" />
}

export function Skeleton({ className }: { className: string }) {
  return <span className={`inline-block animate-pulse rounded-sm bg-track ${className}`} aria-hidden="true" />
}

export function fmtLarge(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  return `${sign}$${a.toLocaleString()}`
}
