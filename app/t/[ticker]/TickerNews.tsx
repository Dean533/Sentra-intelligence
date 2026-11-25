'use client'

// "What the headlines say" section of the ticker page. Rendered by the server
// inside a <Suspense> boundary: items === null is the loading state (also used
// as the Suspense fallback), so the skeleton matches the previous client fetch.

import { useMemo, useState } from 'react'
import type { NewsItem } from '@/lib/news/tickerNews'
import { Dot, Skeleton, h2Cls, labelMono } from './ui'

const NEWS_PER_COL = 8
const DAY = 86_400_000

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NewsThumb({ item }: { item: NewsItem }) {
  const [failed, setFailed] = useState(0) // 0 = try thumbnail, 1 = try logo, 2 = initials
  const logo = item.sourceDomain ? `https://www.google.com/s2/favicons?domain=${item.sourceDomain}&sz=64` : null
  const src = failed === 0 ? (item.thumbnail ?? logo) : failed === 1 && item.thumbnail ? logo : null
  const isLogo = src != null && src === logo
  if (!src) {
    const initials = item.source.replace(/[^A-Za-z0-9 ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    return (
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-sm border border-border bg-surface font-mono text-sm text-muted" aria-hidden="true">
        {initials || '·'}
      </span>
    )
  }
  return (
    <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- remote news images, arbitrary hosts */}
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed((f) => f + 1)}
        className={isLogo ? 'h-7 w-7' : 'h-full w-full object-cover'}
      />
    </span>
  )
}

function NewsCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex gap-3.5 rounded-sm border border-transparent p-2 no-underline transition-colors hover:border-border hover:bg-surface-hover"
    >
      <NewsThumb item={item} />
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-3 text-sm leading-[1.4] text-text group-hover:text-white">{item.title}</span>
        <span className="truncate text-xs text-muted">{item.source} · {timeAgo(item.publishedAt)}</span>
      </span>
    </a>
  )
}

export default function TickerNews({ items: news, fetchedAt: newsAt }: { items: NewsItem[] | null; fetchedAt: number | null }) {
  const [newsOpen, setNewsOpen] = useState(false)

  const split = useMemo(() => {
    const items = news ?? []
    const pos = items.filter((n) => n.sentiment === 'positive')
    const neg = items.filter((n) => n.sentiment === 'negative')
    const oldest = items.length ? items[items.length - 1].publishedAt : null
    return { pos, neg, neutral: items.length - pos.length - neg.length, total: items.length, oldest }
  }, [news])
  const newsWindow = split.oldest && newsAt
    ? newsAt - Date.parse(split.oldest) <= 7.5 * DAY
      ? 'last 7 days'
      : `since ${new Date(split.oldest).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : ''

  return (
    <section className="mt-12 flex flex-col gap-5 border-t border-border pt-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className={labelMono}>NEWS</div>
          <h2 className={h2Cls}>What the headlines say</h2>
        </div>
        {news && news.length > 0 && (
          <span className="font-mono text-xs text-muted">{split.total} headlines · {newsWindow}</span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {([
          { key: 'pos', title: 'Positive', color: 'var(--color-opportunistic)', items: split.pos },
          { key: 'neg', title: 'Negative', color: 'var(--color-routine)', items: split.neg },
        ] as const).map((col) => (
          <div key={col.key} className="flex flex-col rounded-md border border-border px-3 pb-3 pt-4" style={{ borderTop: `2px solid ${col.color}` }}>
            <div className="flex items-baseline justify-between px-2 pb-2">
              <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: col.color }}>
                <Dot color={col.color} size={8} />
                {col.title}
              </span>
              <span className="font-mono text-xs text-muted">{news ? col.items.length : ''}</span>
            </div>
            {news == null ? (
              <div className="flex flex-col gap-3 p-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3.5"><Skeleton className="h-16 w-16" /><div className="flex flex-1 flex-col gap-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-3 w-1/3" /></div></div>
                ))}
              </div>
            ) : col.items.length === 0 ? (
              <p className="m-0 px-2 py-3 text-sm text-muted">No {col.title.toLowerCase()} headlines {newsWindow ? `(${newsWindow})` : ''}.</p>
            ) : (
              <div className="flex flex-col gap-1">
                {(newsOpen ? col.items : col.items.slice(0, NEWS_PER_COL)).map((n) => <NewsCard key={n.id} item={n} />)}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span>
          Sentiment is a free keyword model over each headline (finance word list, phrase and negation rules).
          {news ? ` ${split.neutral} neutral headline${split.neutral === 1 ? '' : 's'} hidden.` : ''}
        </span>
        {(split.pos.length > NEWS_PER_COL || split.neg.length > NEWS_PER_COL) && (
          <button
            type="button"
            onClick={() => setNewsOpen((v) => !v)}
            className="h-8 cursor-pointer rounded-sm border border-border-strong bg-transparent px-3 font-sans text-[13px] text-text-secondary hover:border-muted hover:text-white"
          >
            {newsOpen ? 'Show fewer' : 'Show all headlines'}
          </button>
        )}
      </div>
    </section>
  )
}
