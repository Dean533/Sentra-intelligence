'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MarketRange } from '@/lib/marketData'
import type { NewsItem } from '@/lib/news/tickerNews'
import { fmtDate, fmtMoney, fmtStake, type Breakdown } from '@/lib/insider/format'
import { holdingsDeltaPct } from '@/lib/insider/holdingsDelta'
import { BUY_COLOR, SALE_COLOR, type ChartMarker, type ChartPoint } from './PriceChart'

const PriceChart = dynamic(() => import('./PriceChart'), { ssr: false })

// ─── Types ───────────────────────────────────────────────────────────────────

export type InsiderTrade = {
  id: string
  filed: string
  date: string
  insider: string
  role: string
  isBuy: boolean
  value: number | null
  shares: number | null
  sharesOwnedAfter: number | null
  stake: { pct: number; capped: boolean } | null
  cls: 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null
  score: number | null
}

// Same insider, same calendar day, same direction — almost always one Form 4
// reporting several fills (e.g. a purchase executed in lots at different prices).
// Collapsed into one table row: "{count} buys · $Xk–$Yk each". Chart markers and
// the popover still operate on the flat, ungrouped InsiderTrade[] — this shape is
// only for the insider-activity table.
type TableRow = {
  ids: string[] // underlying trade ids, largest fill first (= representative)
  filed: string
  date: string
  insider: string
  role: string
  isBuy: boolean
  count: number
  valueMin: number | null
  valueMax: number | null
  stake: { pct: number; capped: boolean } | null
  cls: InsiderTrade['cls']
  score: number | null
}

export type TickerSignal = {
  tradeId: string
  score: number
  label: string
  insider: string
  role: string
  value: number | null
  stake: { pct: number; capped: boolean } | null
  date: string
  breakdown: Breakdown[]
}

export type SimilarCompany = {
  symbol: string
  name: string | null
  marketCap: number
  signalScore: number | null
  lastBuyDate: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Yahoo quote/summary payloads are untyped */
type TickerApi = { quote: any; summary: any; ticker: any }

const RANGES: { label: string; value: MarketRange }[] = [
  { label: '1D', value: '1d' },
  { label: '1W', value: '5d' },
  { label: '1M', value: '1mo' },
  { label: '3M', value: '3mo' },
  { label: '6M', value: '6mo' },
  { label: '1Y', value: '1y' },
  { label: '5Y', value: '5y' },
  { label: 'All', value: 'max' },
]

const CLS: Record<string, { label: string; color: string }> = {
  OPPORTUNISTIC: { label: 'Opportunistic', color: 'var(--color-opportunistic)' },
  UNCLASSIFIABLE: { label: 'Unclassifiable', color: 'var(--color-unclassifiable)' },
  ROUTINE: { label: 'Routine', color: 'var(--color-routine)' },
}

const PAGE = 20
const NEWS_PER_COL = 8
const DAY = 86_400_000

// ─── Formatting ──────────────────────────────────────────────────────────────

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtLarge(n: number | null | undefined): string {
  if (n == null) return '—'
  const sign = n < 0 ? '−' : ''
  const a = Math.abs(n)
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  return `${sign}$${a.toLocaleString()}`
}

function fmtVol(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`
  return String(n)
}

const fmtPctFrac = (x: number) => `${(x * 100).toFixed(1)}%`
const signed = (x: number, digits = 2) => {
  const a = Math.abs(x)
  const body = a >= 1000
    ? Math.round(a).toLocaleString('en-US')
    : a.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `${x >= 0 ? '+' : '−'}${body}`
}

function fmtMoneyRange(min: number | null, max: number | null): string {
  if (min == null || max == null) return '—'
  const a = fmtMoney(min)
  const b = fmtMoney(max)
  return a === b ? a : `${a}–${b}`
}

// Collapse same insider + same calendar day + same direction into one row
// (one Form 4 reporting several fills at different prices is the usual cause).
// The largest fill is the representative for filed date / class / score; value
// becomes a range and stake Δ is recomputed from the group's true totals.
function groupSameDay(list: InsiderTrade[]): TableRow[] {
  const groups = new Map<string, InsiderTrade[]>()
  for (const t of list) {
    const k = `${t.insider}|${t.date}|${t.isBuy}`
    const g = groups.get(k)
    if (g) g.push(t)
    else groups.set(k, [t])
  }
  const out: TableRow[] = []
  for (const g of groups.values()) {
    g.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)) // largest fill leads
    const lead = g[0]
    const values = g.map((t) => t.value).filter((v): v is number => v != null)
    let stake = lead.stake
    if (g.length > 1) {
      const sharesList = g.map((t) => t.shares).filter((s): s is number => s != null)
      const afters = g.map((t) => t.sharesOwnedAfter).filter((a): a is number => a != null)
      if (sharesList.length === g.length && afters.length === g.length) {
        const totalShares = sharesList.reduce((a, b) => a + b, 0)
        const finalAfter = lead.isBuy ? Math.max(...afters) : Math.min(...afters)
        stake = holdingsDeltaPct({ shares: totalShares, shares_owned_after: finalAfter, transaction_code: lead.isBuy ? 'P' : 'S' })
      }
    }
    out.push({
      ids: g.map((t) => t.id),
      filed: lead.filed,
      date: lead.date,
      insider: lead.insider,
      role: lead.role,
      isBuy: lead.isBuy,
      count: g.length,
      valueMin: values.length ? Math.min(...values) : null,
      valueMax: values.length ? Math.max(...values) : null,
      stake,
      cls: lead.cls,
      score: lead.score,
    })
  }
  out.sort((a, b) => b.filed.localeCompare(a.filed) || b.date.localeCompare(a.date))
  return out
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const h = Math.floor(ms / 3_600_000)
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Insider trades carry calendar dates only; pin them to the US close (~20:00 UTC)
// so they land on the right day on intraday charts.
const tradeMs = (d: string) => Date.parse(`${d}T20:00:00Z`)

// ─── Small pieces ────────────────────────────────────────────────────────────

const labelMono = 'font-mono text-[11px] tracking-[0.08em] text-muted'
const h2Cls = 'm-0 font-serif text-[26px] font-normal leading-tight text-heading md:text-[30px]'
const textLink = 'text-sm text-text-secondary underline underline-offset-2 hover:text-white'
const linkBtn = 'cursor-pointer border-0 bg-transparent p-0 font-sans text-text-secondary underline underline-offset-2 hover:text-white'

function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: color, width: size, height: size }} aria-hidden="true" />
}

function Skeleton({ className }: { className: string }) {
  return <span className={`inline-block animate-pulse rounded-sm bg-track ${className}`} aria-hidden="true" />
}

// ─── Signal strip (only rendered when there is a recent opportunistic buy) ───

function SignalStrip({ signal, onWhy, whyOpen }: { signal: TickerSignal; onWhy: () => void; whyOpen: boolean }) {
  const divider = 'border-[#1F4D2A] sm:border-r'
  return (
    <div className="flex flex-col rounded-md border border-[#1F4D2A] bg-[#0D1712] sm:flex-row sm:flex-wrap sm:items-stretch">
      <div className={`flex items-center gap-2.5 px-5 pb-1 pt-3.5 sm:py-3.5 ${divider}`}>
        <Dot color="var(--color-opportunistic)" size={8} />
        <span className="text-sm font-semibold text-opportunistic">Opportunistic buy</span>
        <span className="text-[13px] text-muted">{signal.label}</span>
      </div>
      <div className={`flex items-baseline gap-2 px-5 py-1 sm:py-3.5 ${divider}`}>
        <span className={labelMono}>SCORE</span>
        <span className="font-mono text-lg font-semibold text-heading">{signal.score}</span>
      </div>
      <div className="px-5 py-1 text-sm leading-relaxed text-text-secondary sm:flex-[1_1_320px] sm:py-3.5">
        {signal.insider}, {signal.role}, bought <span className="font-mono text-heading">{fmtMoney(signal.value)}</span>
        {signal.stake ? <> ({fmtStake(signal.stake)} stake)</> : <> (new position)</>} on {fmtDate(signal.date, true)}
      </div>
      <button
        type="button"
        onClick={onWhy}
        aria-expanded={whyOpen}
        className={`${linkBtn} self-start px-5 pb-3.5 pt-1 text-left text-sm sm:self-center sm:py-3.5`}
      >
        Why it scored {signal.score}
      </button>
    </div>
  )
}

function BreakdownPanel({ rows, score }: { rows: Breakdown[]; score: number }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={labelMono}>SCORE BREAKDOWN</span>
        <span className="text-xs text-muted">Raw factor points; the score of {score} is this trade&apos;s percentile among opportunistic buys.</span>
      </div>
      <div className="grid grid-cols-1 gap-x-10 gap-y-2.5 md:grid-cols-2">
        {rows.map((b) => (
          <div key={b.label} className="flex items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1 text-text-secondary">{b.label}</span>
            <div className="h-1 w-24 shrink-0 rounded-[2px] bg-track">
              <div className="h-1 rounded-[2px] bg-text-secondary" style={{ width: `${b.pct}%` }} />
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-muted">{b.pts}</span>
          </div>
        ))}
      </div>
      <Link href="/about" className={`${textLink} self-start text-[13px]`}>How scoring works</Link>
    </div>
  )
}

// ─── Trade popover (opened by clicking a chart dot) ──────────────────────────

function TradePopover({
  trades,
  pos,
  box,
  onClose,
  onSeeInTable,
}: {
  trades: InsiderTrade[]
  pos: { x: number; y: number }
  box: { w: number; h: number }
  onClose: () => void
  onSeeInTable: (t: InsiderTrade) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const t = trades[0]

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    function onDown(e: PointerEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    window.addEventListener('keydown', onKey)
    // Defer so the click that opened it doesn't immediately close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
    ref.current?.focus()
    return () => { window.removeEventListener('keydown', onKey); clearTimeout(id); document.removeEventListener('pointerdown', onDown) }
  }, [onClose])

  const W = 272
  // Narrow charts: centre under the dot. Wide: beside it, flipping left near the right edge.
  const narrow = box.w < 560
  const left = narrow
    ? Math.min(Math.max(pos.x - W / 2, 0), box.w - W)
    : pos.x + 16 + W > box.w ? pos.x - 16 - W : pos.x + 16
  const top = narrow ? pos.y + 16 : Math.min(Math.max(pos.y - 40, 0), Math.max(box.h - 250, 0))
  const c = t.cls ? CLS[t.cls] : null
  const typeColor = t.isBuy ? BUY_COLOR : SALE_COLOR
  const rest = trades.length - 1
  const restValue = trades.slice(1).reduce((a, x) => a + (x.value ?? 0), 0)

  const rows: [string, React.ReactNode][] = [
    ['VALUE', fmtMoney(t.value)],
    ['SHARES', t.shares != null ? Math.round(t.shares).toLocaleString('en-US') : '—'],
    ['STAKE Δ', fmtStake(t.stake, t.isBuy)],
    ['CLASS', c ? <span key="c" className="inline-flex items-center gap-1.5" style={{ color: c.color }}><Dot color={c.color} />{c.label}</span> : '—'],
    ['SCORE', t.score ?? '—'],
    ['DATE', fmtDate(t.date, true)],
  ]

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${t.isBuy ? 'Insider buy' : 'Insider sale'} by ${t.insider}`}
      tabIndex={-1}
      className="absolute z-30 flex flex-col gap-3 rounded-md border border-border-strong bg-surface p-4 shadow-[0_12px_40px_rgba(0,0,0,0.6)] outline-none"
      style={{ left, top, width: W }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-heading">{t.insider}</span>
          <span className="truncate text-xs text-muted">{t.role}</span>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xs border px-1.5 py-0.5 font-mono text-[11px]" style={{ color: typeColor, borderColor: `${typeColor}55` }}>
          <Dot color={typeColor} />{t.isBuy ? 'BUY' : 'SALE'}
        </span>
      </div>
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className={labelMono}>{k}</dt>
            <dd className="m-0 truncate font-mono text-[13px] text-heading">{v}</dd>
          </div>
        ))}
      </dl>
      {rest > 0 && (
        <div className="text-xs text-muted">
          +{rest} more {t.isBuy ? 'buy' : 'sale'}{rest === 1 ? '' : 's'} that day ({fmtMoney(restValue)})
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border pt-3">
        <button type="button" onClick={() => onSeeInTable(t)} className={`${linkBtn} text-[13px]`}>See in table</button>
        <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer border-0 bg-transparent p-1 text-muted hover:text-white">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  )
}

// ─── News card ───────────────────────────────────────────────────────────────

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

// ─── Main view ───────────────────────────────────────────────────────────────

export default function TickerView({
  symbol,
  trades,
  truncated,
  signal,
  company,
  sector,
  similar,
}: {
  symbol: string
  trades: InsiderTrade[]
  truncated: boolean
  signal: TickerSignal | null
  company: string | null
  sector: string | null
  similar: SimilarCompany[]
}) {
  const [api, setApi] = useState<TickerApi | null>(null)
  const [apiState, setApiState] = useState<'loading' | 'ok' | 'missing'>('loading')
  const [range, setRange] = useState<MarketRange>('1y')
  const [points, setPoints] = useState<ChartPoint[]>([])
  const [pointsRange, setPointsRange] = useState<MarketRange | null>(null)
  const [news, setNews] = useState<NewsItem[] | null>(null)
  const [newsOpen, setNewsOpen] = useState(false)
  const [newsAt, setNewsAt] = useState<number | null>(null)
  const [showBuys, setShowBuys] = useState(true)
  const [showSales, setShowSales] = useState(true)
  const [mode, setMode] = useState<'buys' | 'all'>('buys')
  const [limit, setLimit] = useState(PAGE)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [whyOpen, setWhyOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [popover, setPopover] = useState<{ marker: ChartMarker; pos: { x: number; y: number } } | null>(null)
  const chartBoxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 1000, h: 360 })

  useEffect(() => {
    let live = true
    fetch(`/api/ticker/${symbol}`)
      .then(async (r) => {
        if (!live) return
        if (!r.ok) { setApiState('missing'); return }
        setApi(await r.json())
        setApiState('ok')
      })
      .catch(() => live && setApiState('missing'))
    const qs = new URLSearchParams({ ticker: symbol, ...(company ? { company } : {}) })
    fetch(`/api/news/feed?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (live) { setNews(d.items ?? []); setNewsAt(Date.now()) } })
      .catch(() => live && setNews([]))
    return () => { live = false }
  }, [symbol, company])

  useEffect(() => {
    let live = true
    fetch(`/api/market/history?ticker=${symbol}&range=${range}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return
        const pts: ChartPoint[] = (d.points ?? [])
          .filter((p: { date: string; close: number | null }) => p.date && p.close != null)
          .map((p: { date: string; close: number }) => ({ t: Date.parse(p.date), close: p.close }))
        setPoints(pts)
        setPointsRange(range)
      })
      .catch(() => { if (live) { setPoints([]); setPointsRange(range) } })
    return () => { live = false }
  }, [symbol, range])

  // Track the chart box size (popover placement + tick density).
  useEffect(() => {
    const el = chartBoxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Scroll the table to a trade chosen from the chart, a frame after commit
  // (a smooth scroll started during the commit gets cancelled).
  useEffect(() => {
    if (!focusId) return
    const raf = requestAnimationFrame(() => {
      document.getElementById(`trade-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    const t = setTimeout(() => setFocusId(null), 2400)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [focusId])

  const q = api?.quote ?? null
  const s = api?.summary ?? null
  const name = q?.longName ?? q?.shortName ?? company ?? api?.ticker?.name ?? null
  const sectorLabel = sector ?? api?.ticker?.sector ?? q?.sector ?? null
  const chartReady = pointsRange === range
  const rangeLabel = RANGES.find((r) => r.value === range)!.label

  // Header change follows the selected range. 1D uses Yahoo's change vs the
  // previous close (the standard daily figure); longer ranges use the first bar.
  const change = useMemo(() => {
    if (range === '1d' && q?.regularMarketChange != null && q?.regularMarketChangePercent != null) {
      return { abs: q.regularMarketChange as number, pct: q.regularMarketChangePercent as number }
    }
    if (!chartReady || points.length < 2) return null
    const start = points[0].close
    const end = q?.regularMarketPrice ?? points[points.length - 1].close
    if (!start) return null
    return { abs: end - start, pct: ((end - start) / start) * 100 }
  }, [range, chartReady, points, q?.regularMarketPrice, q?.regularMarketChange, q?.regularMarketChangePercent])
  const up = (change?.abs ?? 0) >= 0

  const buys = useMemo(() => trades.filter((t) => t.isBuy), [trades])
  const tradeById = useMemo(() => new Map(trades.map((t) => [t.id, t])), [trades])
  const groupedBuys = useMemo(() => groupSameDay(buys), [buys])
  const groupedAll = useMemo(() => groupSameDay(trades), [trades])
  const rows = mode === 'buys' ? groupedBuys : groupedAll

  // Markers: one per (day, direction), largest trade first.
  const markers = useMemo<ChartMarker[]>(() => {
    if (!chartReady || points.length < 2) return []
    const first = points[0].t
    const last = points[points.length - 1].t
    const slack = Math.min(4 * DAY, 0.08 * (last - first))
    const groups = new Map<string, InsiderTrade[]>()
    for (const t of trades) {
      if ((t.isBuy && !showBuys) || (!t.isBuy && !showSales)) continue
      const k = `${t.date}|${t.isBuy ? 'b' : 's'}`
      const g = groups.get(k)
      if (g) g.push(t)
      else groups.set(k, [t])
    }
    const out: ChartMarker[] = []
    for (const [k, g] of groups) {
      const raw = tradeMs(g[0].date)
      if (raw < first - slack || raw > last + slack) continue
      g.sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
      const lead = g[0]
      const total = g.reduce((acc, t) => acc + (t.value ?? 0), 0)
      const verb = lead.isBuy ? 'buy' : 'sale'
      const label =
        g.length === 1
          ? `${lead.insider}, ${lead.role}, ${verb} of ${fmtMoney(lead.value)} on ${fmtDate(lead.date, true)}`
          : `${g.length} insider ${verb}s totalling ${fmtMoney(total)} on ${fmtDate(lead.date, true)}`
      out.push({ key: k, t: Math.min(Math.max(raw, first), last), isBuy: lead.isBuy, tradeIds: g.map((t) => t.id), value: total, label })
    }
    return out
  }, [chartReady, points, trades, showBuys, showSales])

  // Close the popover when its marker disappears (range change / toggle).
  const openKey = popover?.marker.key ?? null
  const popoverLive = openKey != null && markers.some((m) => m.key === openKey)
  const signalKey = signal ? `${tradeById.get(signal.tradeId)?.date ?? ''}|b` : null

  function seeInTable(t: InsiderTrade) {
    setPopover(null)
    const nextMode = !t.isBuy && mode === 'buys' ? 'all' : mode
    if (nextMode !== mode) setMode(nextMode)
    const list = nextMode === 'buys' ? groupedBuys : groupedAll
    const idx = list.findIndex((r) => r.ids.includes(t.id))
    const repId = idx >= 0 ? list[idx].ids[0] : t.id
    if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE) * PAGE)
    setFocusId(null)
    requestAnimationFrame(() => setFocusId(repId))
  }

  const summary: string | null = s?.assetProfile?.longBusinessSummary ?? null
  const ks = s?.defaultKeyStatistics ?? {}
  const fd = s?.financialData ?? {}
  const website: string | null = s?.assetProfile?.website ?? null
  const hq = [s?.assetProfile?.city, s?.assetProfile?.state ?? s?.assetProfile?.country].filter(Boolean).join(', ')
  const price: number | null = q?.regularMarketPrice ?? null

  const dayChg = q?.regularMarketChange != null && q?.regularMarketChangePercent != null
    ? { abs: q.regularMarketChange as number, pct: q.regularMarketChangePercent as number }
    : null
  const stats: { label: string; value: string; tone?: 'up' | 'down' }[] = [
    { label: 'PREV CLOSE', value: fmtPrice(q?.regularMarketPreviousClose) },
    { label: 'OPEN', value: fmtPrice(q?.regularMarketOpen) },
    {
      label: 'DAY CHANGE',
      value: dayChg ? `${signed(dayChg.abs)} (${signed(dayChg.pct, 1)}%)` : '—',
      tone: dayChg ? (dayChg.abs >= 0 ? 'up' : 'down') : undefined,
    },
    { label: 'DAY RANGE', value: q?.regularMarketDayLow != null ? `${fmtPrice(q.regularMarketDayLow)} – ${fmtPrice(q.regularMarketDayHigh)}` : '—' },
    { label: 'VOLUME', value: fmtVol(q?.regularMarketVolume) },
    { label: 'MKT CAP', value: fmtLarge(q?.marketCap) },
    { label: '52W RANGE', value: q?.fiftyTwoWeekLow != null ? `${fmtPrice(q.fiftyTwoWeekLow)} – ${fmtPrice(q.fiftyTwoWeekHigh)}` : '—' },
  ]

  // Only fields Yahoo returned; nulls are dropped.
  const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null)
  const target = num(fd.targetMeanPrice)
  const analysts = num(fd.numberOfAnalystOpinions)
  const factsRaw: { label: string; value: React.ReactNode | null }[] = [
    { label: 'INDUSTRY', value: s?.assetProfile?.industry ?? null },
    { label: 'HQ', value: hq || null },
    { label: 'EMPLOYEES', value: num(s?.assetProfile?.fullTimeEmployees)?.toLocaleString('en-US') ?? null },
    { label: 'REVENUE (TTM)', value: num(fd.totalRevenue) != null ? fmtLarge(fd.totalRevenue) : null },
    { label: 'PROFIT MARGIN', value: num(fd.profitMargins ?? ks.profitMargins) != null ? fmtPctFrac(fd.profitMargins ?? ks.profitMargins) : null },
    { label: 'P/E (TTM)', value: num(q?.trailingPE) != null ? (q.trailingPE as number).toFixed(1) : null },
    { label: 'FORWARD P/E', value: num(ks.forwardPE ?? q?.forwardPE) != null ? Number(ks.forwardPE ?? q?.forwardPE).toFixed(1) : null },
    { label: 'BETA', value: num(ks.beta) != null ? (ks.beta as number).toFixed(2) : null },
    {
      label: 'ANALYST TARGET',
      value: target != null ? (
        <span>
          {fmtPrice(target)}
          {price ? <span className="text-muted"> ({signed(((target - price) / price) * 100, 0)}%{analysts ? `, ${analysts} analysts` : ''})</span> : null}
        </span>
      ) : null,
    },
    { label: 'INSIDER OWNERSHIP', value: num(ks.heldPercentInsiders) != null ? fmtPctFrac(ks.heldPercentInsiders) : null },
    { label: 'INSTITUTIONAL OWNERSHIP', value: num(ks.heldPercentInstitutions) != null ? fmtPctFrac(ks.heldPercentInstitutions) : null },
    { label: 'SHORT % OF FLOAT', value: num(ks.shortPercentOfFloat) != null ? fmtPctFrac(ks.shortPercentOfFloat) : null },
    {
      label: 'WEBSITE',
      value: website ? (
        <a href={website} target="_blank" rel="noopener noreferrer" className="break-all text-text-secondary underline underline-offset-2 hover:text-white">
          {website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
        </a>
      ) : null,
    },
  ]
  const facts = factsRaw.filter((f) => f.value != null && f.value !== '')

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

  const th = 'px-4 py-3 font-mono text-[11px] font-medium tracking-[0.08em] text-muted whitespace-nowrap'
  const td = 'px-4 py-[13px]'

  if (apiState === 'missing' && trades.length === 0) {
    return (
      <div className="bg-background pt-16">
        <main className="mx-auto flex max-w-[1400px] flex-col gap-4 px-4 py-24 md:px-8">
          <Link href="/events" className="self-start font-mono text-xs tracking-[0.08em] text-muted no-underline hover:text-white">← SCREENER</Link>
          <h1 className="m-0 font-mono text-4xl font-semibold text-heading">{symbol}</h1>
          <p className="m-0 text-text-secondary">We couldn&apos;t find market or insider data for this ticker.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="bg-background pt-16">
      <main className="mx-auto max-w-[1400px] px-4 pb-16 md:px-8">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-[18px] pb-5 pt-7">
          <Link href="/events" className="self-start font-mono text-xs tracking-[0.08em] text-muted no-underline hover:text-white">
            ← SCREENER
          </Link>

          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3.5">
                <h1 className="m-0 font-mono text-[34px] font-semibold leading-none tracking-[-0.01em] text-heading md:text-[44px]">{symbol}</h1>
                {sectorLabel && (
                  <span className="rounded-sm border border-border-strong px-2 py-[3px] text-xs text-text-secondary">{sectorLabel}</span>
                )}
              </div>
              <div className="text-base text-text-secondary">
                {name ?? (apiState === 'loading' ? <Skeleton className="h-4 w-48" /> : null)}
              </div>
            </div>

            <div className="flex flex-col gap-1 sm:items-end">
              <div className="font-mono text-[32px] font-medium leading-none text-heading md:text-[40px]">
                {price != null ? fmtPrice(price) : apiState === 'loading' ? <Skeleton className="h-9 w-40" /> : '—'}
              </div>
              <div className={`font-mono text-[15px] ${change ? (up ? 'text-opportunistic' : 'text-routine') : 'text-muted'}`}>
                {change ? (
                  <>
                    {signed(change.abs)} ({signed(change.pct, 1)}%)
                    <span className="text-muted"> · {rangeLabel}</span>
                  </>
                ) : (
                  <Skeleton className="h-4 w-36" />
                )}
              </div>
              <div className={labelMono}>
                {q?.marketState ? (q.marketState === 'REGULAR' ? 'MARKET OPEN' : 'MARKET CLOSED') : ' '}
              </div>
            </div>
          </div>

          {signal && <SignalStrip signal={signal} whyOpen={whyOpen} onWhy={() => setWhyOpen((v) => !v)} />}
          {signal && whyOpen && <BreakdownPanel rows={signal.breakdown} score={signal.score} />}
        </section>

        {/* ── Chart ──────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3.5 rounded-md border border-border px-3 pb-3.5 pt-4 md:px-5 md:pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto px-1" role="group" aria-label="Chart range">
              {RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => { setRange(r.value); setPopover(null) }}
                  aria-pressed={range === r.value}
                  className={`h-8 shrink-0 cursor-pointer rounded-sm border-0 px-2.5 font-mono text-xs md:px-3 ${
                    range === r.value ? 'bg-track text-heading' : 'bg-transparent text-muted hover:text-text-secondary'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${labelMono} hidden pr-1 sm:inline`}>SHOW ON CHART</span>
              {([
                { on: showBuys, set: setShowBuys, label: 'Insider buys', color: BUY_COLOR },
                { on: showSales, set: setShowSales, label: 'Insider sales', color: SALE_COLOR },
              ] as const).map((b) => (
                <button
                  key={b.label}
                  type="button"
                  aria-pressed={b.on}
                  onClick={() => b.set((v) => !v)}
                  className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-sm border px-3 font-sans text-[13px] ${b.on ? 'text-text' : 'border-border-strong bg-transparent text-muted'}`}
                  style={b.on ? { borderColor: `${b.color}66`, background: `${b.color}14` } : undefined}
                >
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: b.color, opacity: b.on ? 1 : 0.35 }} />
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div ref={chartBoxRef} className={`relative h-[260px] transition-opacity md:h-[360px] ${chartReady ? 'opacity-100' : 'opacity-50'}`}>
            {points.length > 1 ? (
              <PriceChart
                points={points}
                markers={markers}
                up={up}
                compact={box.w < 560}
                logScale={range === '5y' || range === 'max'}
                highlightKey={signal && showBuys ? signalKey : null}
                selectedKey={popoverLive ? openKey : null}
                onSelect={(m, pos) => setPopover({ marker: m, pos })}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted">
                {chartReady ? 'No price history available' : 'Loading chart…'}
              </div>
            )}
            {popover && popoverLive && (
              <TradePopover
                key={popover.marker.key}
                trades={popover.marker.tradeIds.map((id) => tradeById.get(id)!).filter(Boolean)}
                pos={popover.pos}
                box={box}
                onClose={() => setPopover(null)}
                onSeeInTable={seeInTable}
              />
            )}
          </div>
          <div className="text-xs text-muted">
            {markers.length > 0
              ? 'Hover for price. Click a dot for the trade.'
              : chartReady && points.length > 1
                ? `No insider ${showBuys && !showSales ? 'buys' : !showBuys && showSales ? 'sales' : 'trades'} in this range.`
                : ' '}
          </div>
        </section>

        {/* ── Stats row: only the change value is colored ────────────────── */}
        <section className="mt-4 grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4 lg:grid-cols-7">
          {stats.map((st) => (
            <div key={st.label} className="-mb-px -mr-px flex flex-col gap-1 border-b border-r border-border px-[18px] py-3.5">
              <span className={labelMono}>{st.label}</span>
              <span className={`font-mono text-[14px] ${st.tone === 'up' ? 'text-opportunistic' : st.tone === 'down' ? 'text-routine' : 'text-heading'}`}>
                {apiState === 'loading' ? <Skeleton className="h-4 w-16" /> : st.value}
              </span>
            </div>
          ))}
        </section>

        {/* ── Insider activity ───────────────────────────────────────────── */}
        <section id="insiders" className="flex scroll-mt-20 flex-col gap-4 pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <div className={labelMono}>INSIDER ACTIVITY</div>
              <h2 className={h2Cls}>Who&apos;s buying, who&apos;s selling</h2>
            </div>
            <div className="flex overflow-hidden rounded-sm border border-border-strong" role="group" aria-label="Trades shown">
              {(['buys', 'all'] as const).map((m, i) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => { setMode(m); setLimit(PAGE) }}
                  className={`h-[34px] cursor-pointer border-0 px-3.5 font-sans text-[13px] ${i ? 'border-l border-solid border-border-strong' : ''} ${
                    mode === m ? 'bg-track text-heading' : 'bg-transparent text-muted hover:text-text-secondary'
                  }`}
                >
                  {m === 'buys' ? `Buys (${buys.length})` : `All trades (${trades.length.toLocaleString('en-US')}${truncated ? '+' : ''})`}
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-md border border-border px-5 py-8 text-sm text-muted">
              {mode === 'buys' ? (
                <>
                  No open-market insider purchases on record for {symbol}.{' '}
                  {trades.length > 0 && (
                    <button type="button" onClick={() => setMode('all')} className={`${linkBtn} text-sm`}>Show all trades</button>
                  )}
                </>
              ) : (
                <>No insider trades on record for {symbol}.</>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface text-left">
                    <th className={th}>DATE</th>
                    <th className={th}>INSIDER</th>
                    {mode === 'all' && <th className={th}>TYPE</th>}
                    <th className={`${th} text-right`}>VALUE</th>
                    <th className={`${th} text-right`}>STAKE Δ</th>
                    <th className={th}>CLASS</th>
                    <th className={th}>SCORE</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, limit).map((t) => {
                    const c = t.cls ? CLS[t.cls] : null
                    const repId = t.ids[0]
                    const valueText = t.count > 1
                      ? `${t.count} ${t.isBuy ? 'buys' : 'sales'} · ${fmtMoneyRange(t.valueMin, t.valueMax)} each`
                      : fmtMoney(t.valueMax)
                    return (
                      <tr
                        key={repId}
                        id={`trade-${repId}`}
                        className={`scroll-mt-24 border-b border-row-border transition-colors duration-700 last:border-b-0 hover:bg-surface-hover ${
                          focusId === repId ? 'bg-[#13233A]' : ''
                        }`}
                      >
                        <td className={`${td} whitespace-nowrap font-mono`}>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-text">{fmtDate(t.date, true)}</span>
                            <span className="text-[11px] text-muted">filed {fmtDate(t.filed, true)}</span>
                          </div>
                        </td>
                        <td className={`${td} text-text`}>
                          {t.insider}
                          <span className="text-muted"> · {t.role}</span>
                        </td>
                        {mode === 'all' && (
                          <td className={td}>
                            <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: t.isBuy ? BUY_COLOR : SALE_COLOR }}>
                              <Dot color={t.isBuy ? BUY_COLOR : SALE_COLOR} />
                              {t.isBuy ? 'Buy' : 'Sale'}
                            </span>
                          </td>
                        )}
                        <td className={`${td} text-right font-mono text-text`}>{valueText}</td>
                        <td className={`${td} text-right font-mono text-text-secondary`}>{fmtStake(t.stake, t.isBuy)}</td>
                        <td className={td}>
                          {c ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: c.color }}>
                              <Dot color={c.color} />
                              {c.label}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className={`${td} font-mono font-semibold text-heading`}>{t.score ?? <span className="font-normal text-muted">—</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-muted">
            <span>
              Open-market purchases (P) and sales (S) from Form 4. Score is a percentile rank within each class; only purchases are scored.{' '}
              <Link href="/about" className="text-text-secondary underline underline-offset-2 hover:text-white">How scoring works</Link>
            </span>
            {rows.length > limit && (
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE * 2)}
                className="h-8 cursor-pointer rounded-sm border border-border-strong bg-transparent px-3 font-sans text-[13px] text-text-secondary hover:border-muted hover:text-white"
              >
                Show more ({(rows.length - limit).toLocaleString('en-US')} left)
              </button>
            )}
          </div>
        </section>

        {/* ── Company ────────────────────────────────────────────────────── */}
        <section className="mt-12 grid grid-cols-1 gap-10 border-t border-border pt-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
          <div className="flex flex-col gap-3.5">
            <div className={labelMono}>COMPANY</div>
            {apiState === 'loading' ? (
              <div className="flex flex-col gap-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-2/3" /></div>
            ) : summary ? (
              <>
                <p className={`m-0 text-[15px] leading-[1.65] text-text-secondary ${summaryOpen ? '' : 'line-clamp-6'}`}>{summary}</p>
                {summary.length > 420 && (
                  <button type="button" onClick={() => setSummaryOpen((v) => !v)} className={`${linkBtn} self-start text-[13px]`}>
                    {summaryOpen ? 'Show less' : 'Show more'}
                  </button>
                )}
              </>
            ) : (
              <p className="m-0 text-sm text-muted">No description available.</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {apiState === 'loading'
              ? Array.from({ length: 9 }).map((_, i) => (
                  <div key={i} className="flex flex-col gap-1.5 border-b border-row-border py-3"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-24" /></div>
                ))
              : facts.map((f) => (
                  <div key={f.label} className="flex min-w-0 flex-col gap-1 border-b border-row-border py-3">
                    <span className={labelMono}>{f.label}</span>
                    <span className="text-sm text-heading">{f.value}</span>
                  </div>
                ))}
          </div>
        </section>

        {/* ── News, split by sentiment ───────────────────────────────────── */}
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

        {/* ── You may also like ──────────────────────────────────────────── */}
        {similar.length > 0 && (
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
        )}
      </main>
    </div>
  )
}
