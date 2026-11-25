// "You may also like" section of the ticker page. Server component, streamed in
// its own <Suspense> boundary (see page.tsx).

import Link from 'next/link'
import { fmtDate } from '@/lib/insider/format'
import { Dot, fmtLarge, h2Cls, labelMono } from './ui'

export type SimilarCompany = {
  symbol: string
  name: string | null
  marketCap: number
  signalScore: number | null
  lastBuyDate: string | null
}

export default function SimilarCompanies({ similar, sectorLabel }: { similar: SimilarCompany[]; sectorLabel: string | null }) {
  if (similar.length === 0) return null
  return (
    <section className="mt-12 flex flex-col gap-5 border-t border-border pt-12">
      <div className="flex flex-col gap-1.5">
        <div className={labelMono}>SIMILAR COMPANIES{sectorLabel ? ` · ${sectorLabel.toUpperCase()}` : ''}</div>
        <h2 className={h2Cls}>You may also like</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {similar.map((c) => (
          <Link
            key={c.symbol}
            href={`/t/${c.symbol}`}
            className={`flex flex-col gap-2 rounded-md border bg-surface p-4 no-underline transition-colors hover:bg-surface-hover ${
              c.signalScore != null ? 'border-[#1F4D2A]' : 'border-border hover:border-border-strong'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-base font-semibold text-heading">{c.symbol}</span>
              <span className="font-mono text-xs text-muted">{fmtLarge(c.marketCap)}</span>
            </div>
            <span className="line-clamp-1 text-[13px] text-text-secondary">{c.name ?? '—'}</span>
            {c.signalScore != null ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-opportunistic">
                <Dot color="var(--color-opportunistic)" />Opportunistic buy · {c.signalScore}
              </span>
            ) : c.lastBuyDate ? (
              <span className="text-xs text-muted">Last insider buy: {fmtDate(c.lastBuyDate, true)}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </section>
  )
}
