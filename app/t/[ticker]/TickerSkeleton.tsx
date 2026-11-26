// Shown immediately while the ticker page's insider data streams in (outer
// Suspense fallback in page.tsx). Mirrors the header, chart and table layout of
// TickerView so the page doesn't jump when the real content arrives.

import Link from 'next/link'
import { Skeleton, labelMono } from './ui'

export default function TickerSkeleton({ symbol }: { symbol: string }) {
  return (
    <div className="bg-background pt-16" aria-busy="true">
      <main className="mx-auto max-w-[1400px] px-4 pb-16 md:px-8">
        <section className="flex flex-col gap-[18px] pb-5 pt-7">
          <Link href="/screener" className="-my-2.5 self-start py-2.5 font-mono text-xs tracking-[0.08em] text-muted no-underline hover:text-white">
            ← SCREENER
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <h1 className="m-0 font-mono text-[34px] font-semibold leading-none tracking-[-0.01em] text-heading md:text-[44px]">{symbol}</h1>
              <div className="text-base"><Skeleton className="h-4 w-48" /></div>
            </div>
            <div className="flex flex-col gap-1 sm:items-end">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3.5 rounded-md border border-border px-3 pb-3.5 pt-4 md:px-5 md:pt-5">
          <Skeleton className="h-8 w-72 max-w-full" />
          <div className="flex h-[260px] items-center justify-center md:h-[360px]">
            <span className="text-sm text-muted">Loading chart…</span>
          </div>
        </section>

        <section className="flex flex-col gap-4 pt-12">
          <div className={labelMono}>INSIDER ACTIVITY</div>
          <div className="flex flex-col overflow-hidden rounded-md border border-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-6 border-b border-row-border px-4 py-[15px] last:border-b-0">
                <Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-48" /><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
