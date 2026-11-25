'use client'

// Screener (moved from /events). Data comes from the same endpoints as before:
// /api/insider/fetch (insider tab) and /api/signals (news tab).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { holdingsDeltaPct, convictionLabel } from '@/lib/insider/holdingsDelta'
import { displayRole, formatInsiderName, fmtMoney, fmtStake } from '@/lib/insider/format'
import { decodeEntities } from '@/lib/text'

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'insider' | 'news'

type EventItem = {
  id: string; ticker: string; event_type: 'news' | 'sec_filing'
  title: string; summary: string | null
  source_url: string | null; published_at: string; raw_text: string | null
}

type InsiderRow = {
  id: string
  ticker: string
  insider_name: string | null
  role: string | null
  officer_title: string | null
  transaction_date: string
  filed_date: string | null
  transaction_code: string | null
  shares: number | null
  price_per_share: number | null
  total_value: number | null
  shares_owned_after: number | null
  source_url: string | null
  classification: string | null
  conviction_score: number | null
  company?: string | null // from include=company
}

type TickerSuggestion = { symbol: string; name: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50
const NEWS_PAGE_SIZE = 30
const DEFAULT_WINDOW_DAYS = 30

// Date-range presets in More filters (trade date). null = all history.
const RANGES: { label: string; days: number | null }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
  { label: 'All', days: null },
]

// Column sorts. "signal" = class bucket, then score (the SCORE column).
type SortKey = 'signal' | 'filed' | 'value' | 'stake'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffH  = Math.floor(diffMs / 3600000)
  if (diffH < 1)  return `${Math.floor(diffMs / 60000)}m ago`
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

// Calendar date in UTC; year only when it isn't the current year.
function fmtDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'UTC' })
}

function parseMeta(raw: string | null): Record<string, string | undefined> {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

const CLS: Record<string, { label: string; color: string }> = {
  OPPORTUNISTIC:  { label: 'Opportunistic',  color: 'var(--color-opportunistic)' },
  UNCLASSIFIABLE: { label: 'Unclassifiable', color: 'var(--color-unclassifiable)' },
  ROUTINE:        { label: 'Routine',        color: 'var(--color-routine)' },
}

const SENTIMENT_COLOR: Record<string, string> = {
  bullish: 'var(--color-opportunistic)',
  bearish: 'var(--color-routine)',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const thBase = 'whitespace-nowrap px-4 py-3 font-mono text-[11px] font-medium tracking-[0.08em] text-muted'
const th  = `${thBase} text-left`
const thR = `${thBase} text-right`
const td  = 'px-4 py-[13px]'
const btnSecondary =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-transparent px-4 font-sans text-sm text-text-secondary transition-colors hover:border-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
}

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-16 rounded-[2px] bg-track">
      <div className="h-1 rounded-[2px] bg-text-secondary" style={{ width: `${pct}%` }} />
    </div>
  )
}

// Labeled select in the mockup's "Class [All ▾]" style.
function FilterSelect({ label, value, onChange, options, tone = 'surface' }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; tone?: 'surface' | 'plain'
}) {
  return (
    <label className={`relative flex h-10 items-center gap-2 rounded-sm border border-border-strong pl-3 pr-8 ${tone === 'surface' ? 'bg-surface' : 'bg-transparent'}`}>
      <span className="whitespace-nowrap text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer appearance-none border-none bg-transparent font-sans text-sm text-text outline-none [&>option]:bg-surface"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg className="pointer-events-none absolute right-3" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
        <path d="M1 1l4 4 4-4" stroke="#8B949E" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </label>
  )
}

function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-sm border border-border-strong px-3">
      <span className="text-xs text-muted">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-none bg-transparent font-mono text-[13px] text-text outline-none [color-scheme:dark]"
      />
    </label>
  )
}

// Clickable column header: first click sorts descending, the next flips it.
function SortTh({ label, sortKey, sort, onSort, align = 'left', title }: {
  label: string; sortKey: SortKey; sort: SortState; onSort: (k: SortKey) => void
  align?: 'left' | 'right'; title?: string
}) {
  const active = sort.key === sortKey
  return (
    <th
      className={align === 'right' ? thR : th}
      aria-sort={active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        title={title}
        className={`group inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 font-mono text-[11px] font-medium tracking-[0.08em] transition-colors ${
          active ? 'text-heading' : 'text-muted hover:text-text-secondary'
        }`}
      >
        {label}
        <span className={`inline-block w-2.5 text-left ${active ? '' : 'opacity-0 group-hover:opacity-60'}`} aria-hidden="true">
          {active ? (sort.dir === 'desc' ? '↓' : '↑') : '↓'}
        </span>
      </button>
    </th>
  )
}

function Pagination({ page, pages, onPage, approx = false }: { page: number; pages: number; onPage: (p: number) => void; approx?: boolean }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-4 pt-6">
      <button onClick={() => onPage(page - 1)} disabled={page === 1} className={btnSecondary}>← Previous</button>
      <span className="font-mono text-xs text-muted">Page {page} of {approx ? '~' : ''}{pages.toLocaleString('en-US')}</span>
      <button onClick={() => onPage(page + 1)} disabled={page === pages} className={btnSecondary}>Next →</button>
    </div>
  )
}

// ─── Ticker search (same /api/tickers autocomplete as the old /events page) ──

function TickerFilter({ input, setInput, setFilter }: {
  input: string; setInput: (v: string) => void; setFilter: (v: string) => void
}) {
  const [suggestions,  setSuggestions]  = useState<TickerSuggestion[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  // Resolve input → filter: exact symbol match or single hit wins; otherwise
  // debounce and uppercase as-is for direct ticker entry.
  useEffect(() => {
    const raw = input.trim()
    if (!raw) { setFilter(''); setSuggestions([]); return }

    const t = setTimeout(async () => {
      const res = await fetch(`/api/tickers?search=${encodeURIComponent(raw)}&lite=1&page=1`)
      const data = await res.json()
      const hits: TickerSuggestion[] = (data.tickers ?? []).map((t: { symbol: string; name: string }) => ({ symbol: t.symbol, name: t.name }))
      setSuggestions(hits)
      setShowDropdown(hits.length > 0)

      const exactSymbol = hits.find((h) => h.symbol === raw.toUpperCase())
      if (exactSymbol)            setFilter(exactSymbol.symbol)
      else if (hits.length === 1) setFilter(hits[0].symbol)
      else                        setFilter(raw.toUpperCase())
    }, 300)
    return () => clearTimeout(t)
  }, [input, setFilter])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const open = showDropdown && suggestions.length > 0

  return (
    <div ref={boxRef} className="relative min-w-0 flex-[1_1_260px]">
      <label className={`flex h-10 items-center gap-2 border border-border-strong bg-surface px-3 focus-within:border-muted ${open ? 'rounded-t-sm' : 'rounded-sm'}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B949E" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="sr-only">Filter by ticker or company</span>
        <input
          type="text"
          placeholder="Filter by ticker or company"
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowDropdown(true) }}
          onFocus={() => { if (suggestions.length > 0) setShowDropdown(true) }}
          className="min-w-0 flex-1 border-none bg-transparent font-sans text-sm text-text outline-none placeholder:text-muted"
        />
        {input && (
          <button
            type="button"
            aria-label="Clear ticker filter"
            onClick={() => { setInput(''); setSuggestions([]); setShowDropdown(false) }}
            className="cursor-pointer border-none bg-transparent p-0 text-lg leading-none text-muted hover:text-white"
          >
            ×
          </button>
        )}
      </label>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 max-h-60 overflow-y-auto rounded-b-sm border border-t-0 border-border-strong bg-surface shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
          {suggestions.map((s) => (
            <button
              key={s.symbol}
              type="button"
              onMouseDown={() => {
                setInput(s.symbol)
                setFilter(s.symbol)
                setSuggestions([])
                setShowDropdown(false)
              }}
              className="flex w-full cursor-pointer items-center gap-3 border-0 border-b border-solid border-row-border bg-transparent px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-hover"
            >
              <span className="min-w-[52px] font-mono text-[13px] font-semibold text-heading">{s.symbol}</span>
              <span className="truncate text-[13px] text-muted">{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Insider activity ─────────────────────────────────────────────────────────

function InsiderActivity({ ticker, search }: { ticker?: string; search: React.ReactNode }) {
  const [rows,        setRows]        = useState<InsiderRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [fetchError,  setFetchError]  = useState<string | null>(null)
  const [page,        setPage]        = useState(1)
  const [total,       setTotal]       = useState(0)
  const [pages,       setPages]       = useState(1)
  const [totalEstimated, setTotalEstimated] = useState(false)
  const [includeSales, setIncludeSales] = useState(false)
  const [clsFilter,   setClsFilter]   = useState('all')
  const [roleFilter,  setRoleFilter]  = useState('all')
  const [valueFilter, setValueFilter] = useState('all')
  const [defaultStart] = useState(() => isoDaysAgo(DEFAULT_WINDOW_DAYS))
  const [startDate,   setStartDate]   = useState(defaultStart)
  const [endDate,     setEndDate]     = useState('')
  const [holdingsPct, setHoldingsPct] = useState('any')
  const [clusterMin,  setClusterMin]  = useState('none')
  const [scoreFilter, setScoreFilter] = useState('all')
  const [moreOpen,    setMoreOpen]    = useState(false)
  const router = useRouter()

  // Default: buys ranked by signal (class bucket, then score). Sales are unscored,
  // so signal order would bury them: toggling sales resets to that mode's default
  // (on → newest filed first, off → signal). Column headers re-sort from there.
  const dirFilter = includeSales ? 'all' : 'buys'
  const [sort, setSort] = useState<SortState>({ key: 'signal', dir: 'desc' })

  function toggleSales() {
    const next = !includeSales
    setIncludeSales(next)
    setSort({ key: next ? 'filed' : 'signal', dir: 'desc' })
  }

  function sortBy(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }

  function applyRange(days: number | null) {
    setStartDate(days == null ? '' : isoDaysAgo(days))
    setEndDate('')
  }
  const activeRange = endDate
    ? null
    : RANGES.find((r) => (r.days == null ? startDate === '' : startDate === isoDaysAgo(r.days)))?.label ?? null

  // Honor ?classification= deep links (e.g. homepage "Open full screener")
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('classification')?.toUpperCase()
    if (c === 'OPPORTUNISTIC' || c === 'ROUTINE' || c === 'UNCLASSIFIABLE') setClsFilter(c)
  }, [])

  useEffect(() => { setPage(1) }, [ticker, dirFilter, sort.key, sort.dir, clsFilter, roleFilter, valueFilter, startDate, endDate, clusterMin, holdingsPct, scoreFilter])

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), direction: dirFilter, include: 'company' })
    params.set('sort', sort.key)
    params.set('dir', sort.dir)
    if (ticker)                params.set('ticker', ticker)
    if (clsFilter  !== 'all')  params.set('classification', clsFilter)
    if (roleFilter !== 'all')  params.set('role', roleFilter)
    if (startDate)             params.set('start_date', startDate)
    if (endDate)               params.set('end_date', endDate)
    if (clusterMin !== 'none') params.set('cluster_min', clusterMin)
    if (holdingsPct !== 'any') params.set('holdings_min', holdingsPct)
    if (valueFilter !== 'all') params.set('min_value', valueFilter)
    if (scoreFilter !== 'all') params.set('min_score', scoreFilter)
    let cancelled = false
    fetch(`/api/insider/fetch?${params}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error ?? `HTTP ${r.status}`) })
        return r.json()
      })
      .then((d) => {
        if (cancelled) return
        setRows(d.rows ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
        setTotalEstimated(!!d.totalEstimated)
      })
      .catch((e: Error) => { if (!cancelled) setFetchError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticker, dirFilter, sort.key, sort.dir, clsFilter, roleFilter, valueFilter, startDate, endDate, clusterMin, holdingsPct, scoreFilter, page])

  // In cluster mode, group by ticker (sorted by each group's most recent trade) then flatten.
  const displayRows: InsiderRow[] = (() => {
    if (clusterMin === 'none') return rows
    const map = new Map<string, InsiderRow[]>()
    for (const row of rows) {
      if (!map.has(row.ticker)) map.set(row.ticker, [])
      map.get(row.ticker)!.push(row)
    }
    return [...map.entries()]
      .sort(([, a], [, b]) => (b[0]?.transaction_date ?? '').localeCompare(a[0]?.transaction_date ?? ''))
      .flatMap(([, rows]) => rows)
  })()

  const moreActive =
    (scoreFilter !== 'all' ? 1 : 0) + (holdingsPct !== 'any' ? 1 : 0) + (clusterMin !== 'none' ? 1 : 0) +
    (startDate !== defaultStart ? 1 : 0) + (endDate ? 1 : 0)

  const unit      = includeSales ? 'trades' : 'buys'
  const pageStart = (page - 1) * PAGE_SIZE + 1
  const pageEnd   = Math.min(page * PAGE_SIZE, total)
  const since     = startDate ? ` · traded since ${fmtDay(startDate)}` : ' · all time'
  const countText = loading
    ? 'Loading…'
    : fetchError
      ? 'Failed to load'
      : total === 0
        ? `No ${unit} found`
        : `Showing ${pageStart}–${pageEnd} of ${totalEstimated ? 'about ' : ''}${total.toLocaleString('en-US')} ${unit}${since}`

  return (
    <>
      {/* FILTER BAR */}
      <section className="flex flex-col gap-3 pb-4 pt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          {search}
          <FilterSelect label="Class" value={clsFilter} onChange={setClsFilter} options={[
            { value: 'all', label: 'All' },
            { value: 'OPPORTUNISTIC', label: 'Opportunistic' },
            { value: 'UNCLASSIFIABLE', label: 'Unclassifiable' },
            { value: 'ROUTINE', label: 'Routine' },
          ]} />
          <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter} options={[
            { value: 'all', label: 'All' },
            { value: 'ceo', label: 'CEO' },
            { value: 'cfo', label: 'CFO' },
            { value: 'director', label: 'Director' },
            { value: '10pct', label: '10% Owner' },
            { value: 'other', label: 'Other' },
          ]} />
          <FilterSelect label="Value" value={valueFilter} onChange={setValueFilter} options={[
            { value: 'all', label: 'Any' },
            { value: '100000', label: '$100K+' },
            { value: '500000', label: '$500K+' },
            { value: '1000000', label: '$1M+' },
            { value: '5000000', label: '$5M+' },
            { value: '10000000', label: '$10M+' },
          ]} />
          <button
            type="button"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className={`${btnSecondary} px-3.5`}
          >
            {moreOpen ? 'Fewer filters' : 'More filters'}
            {moreActive > 0 && <span className="ml-2 rounded-xs bg-track px-1.5 font-mono text-[11px] text-heading">{moreActive}</span>}
          </button>
        </div>

        {moreOpen && (
          <div className="flex flex-wrap items-center gap-2.5 rounded-md border border-border bg-surface p-3">
            <FilterSelect tone="plain" label="Min score" value={scoreFilter} onChange={setScoreFilter} options={[
              { value: 'all', label: 'Any' },
              { value: '50', label: '50+' },
              { value: '60', label: '60+' },
              { value: '70', label: '70+' },
              { value: '80', label: '80+' },
              { value: '90', label: '90+' },
            ]} />
            <FilterSelect tone="plain" label="Stake change" value={holdingsPct} onChange={setHoldingsPct} options={[
              { value: 'any', label: 'Any' },
              { value: '10', label: '+10%+' },
              { value: '25', label: '+25%+' },
              { value: '50', label: '+50%+' },
              { value: '100', label: '+100%+' },
            ]} />
            <FilterSelect tone="plain" label="Cluster" value={clusterMin} onChange={setClusterMin} options={[
              { value: 'none', label: 'Any' },
              { value: '2', label: '2+ insiders' },
              { value: '3', label: '3+ insiders' },
              { value: '4', label: '4+ insiders' },
            ]} />
            <div className="flex h-10 items-center gap-2 rounded-sm border border-border-strong pl-3 pr-1">
              <span className="text-xs text-muted">Period</span>
              <div className="flex gap-0.5" role="group" aria-label="Date range">
                {RANGES.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    aria-pressed={activeRange === r.label}
                    onClick={() => applyRange(r.days)}
                    className={`h-8 cursor-pointer rounded-sm border-0 px-2.5 font-mono text-xs ${
                      activeRange === r.label ? 'bg-track text-heading' : 'bg-transparent text-muted hover:text-text-secondary'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <FilterDate label="From" value={startDate} onChange={setStartDate} />
            <FilterDate label="To" value={endDate} onChange={setEndDate} />
            {moreActive > 0 && (
              <button
                type="button"
                onClick={() => { setScoreFilter('all'); setHoldingsPct('any'); setClusterMin('none'); setStartDate(defaultStart); setEndDate('') }}
                className="cursor-pointer border-none bg-transparent px-1 font-sans text-[13px] text-text-secondary underline underline-offset-2 hover:text-white"
              >
                Reset
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={includeSales}
              onClick={toggleSales}
              className="inline-flex h-9 cursor-pointer items-center gap-2.5 border-none bg-transparent px-1 font-sans text-sm text-text-secondary hover:text-white"
            >
              <span className={`relative inline-block h-5 w-[34px] rounded-[10px] transition-colors ${includeSales ? 'bg-opportunistic' : 'bg-border-strong'}`}>
                <span className={`absolute top-[3px] h-3.5 w-3.5 rounded-full bg-heading transition-[left] ${includeSales ? 'left-[17px]' : 'left-[3px]'}`} />
              </span>
              Include sales
            </button>
            <span className="text-xs text-muted">
              Sales are shown for context but not scored.
            </span>
          </div>
          <span className={`font-mono text-xs ${fetchError ? 'text-routine' : 'text-muted'}`}>{countText}</span>
        </div>
      </section>

      {/* TABLE */}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className={th}>TICKER</th>
              <th className={th}>INSIDER</th>
              <th className={th}>CLASS</th>
              <SortTh label="VALUE" sortKey="value" sort={sort} onSort={sortBy} align="right" title="Sort by trade value" />
              <SortTh label="STAKE Δ" sortKey="stake" sort={sort} onSort={sortBy} align="right" title="Sort by change in the insider's stake" />
              <SortTh label="SCORE" sortKey="signal" sort={sort} onSort={sortBy} title="Sort by signal: class first, then score" />
              <SortTh label="FILED" sortKey="filed" sort={sort} onSort={sortBy} align="right" title="Sort by filing date" />
            </tr>
          </thead>
          <tbody>
            {loading && Array.from({ length: 10 }).map((_, i) => (
              <tr key={i} className="border-b border-row-border last:border-b-0">
                {[48, 200, 96, 56, 48, 96, 52].map((w, j) => (
                  <td key={j} className={`${td} ${j === 3 || j === 4 || j === 6 ? 'text-right' : ''}`}>
                    <span className="inline-block h-3 animate-pulse rounded-sm bg-track" style={{ width: w }} />
                  </td>
                ))}
              </tr>
            ))}

            {!loading && fetchError && (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center">
                  <div className="mb-1.5 text-sm text-routine">Failed to load transactions</div>
                  <div className="font-mono text-xs text-muted">{fetchError}</div>
                </td>
              </tr>
            )}

            {!loading && !fetchError && displayRows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-14 text-center text-sm text-muted">No {unit} match these filters.</td>
              </tr>
            )}

            {!loading && !fetchError && displayRows.map((row) => {
              const isBuy  = row.transaction_code?.toUpperCase() === 'P'
              const cls    = CLS[row.classification ?? 'UNCLASSIFIABLE'] ?? CLS.UNCLASSIFIABLE
              const score  = isBuy ? row.conviction_score : null
              // Opens the ticker page scrolled to (and highlighting) this trade.
              const href   = `/t/${row.ticker}#trade-${row.id}`
              return (
                <tr
                  key={row.id}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey) window.open(href, '_blank')
                    else router.push(href)
                  }}
                  className={`cursor-pointer border-b border-row-border transition-colors last:border-b-0 hover:bg-surface-hover ${isBuy ? '' : 'opacity-75 hover:opacity-100'}`}
                >
                  <td className={`${td} max-w-[280px] truncate`}>
                    <Link
                      href={href}
                      onClick={(e) => e.stopPropagation()}
                      className="font-mono font-semibold text-heading no-underline hover:text-white hover:underline"
                    >
                      {row.ticker}
                    </Link>
                    {row.company && <span className="hidden pl-2.5 text-muted md:inline">{row.company}</span>}
                  </td>
                  <td className={`${td} max-w-[340px] truncate text-text`}>
                    {formatInsiderName(row.insider_name)}
                    <span className="text-muted"> · {displayRole(row)}</span>
                    {!isBuy && (
                      <span className="ml-2 rounded-xs border border-border-strong px-1.5 py-px font-mono text-[11px] text-muted">SALE</span>
                    )}
                  </td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" style={{ color: cls.color }}>
                      <Dot color={cls.color} />{cls.label}
                    </span>
                  </td>
                  <td className={`${td} text-right font-mono text-text`}>{fmtMoney(row.total_value)}</td>
                  <td className={`${td} text-right font-mono text-text-secondary`}>{fmtStake(holdingsDeltaPct(row), isBuy)}</td>
                  <td className={td}>
                    {score != null ? (
                      <div className="flex items-center gap-2.5" title={convictionLabel(row.classification, score)}>
                        <span className="min-w-[22px] font-mono font-semibold text-heading">{score}</span>
                        <Bar pct={score} />
                      </div>
                    ) : (
                      <span className="font-mono text-muted" title={isBuy ? 'Not scored yet' : 'Sales are not scored'}>—</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-right font-mono text-muted`}>{fmtDay(row.filed_date ?? row.transaction_date)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && <Pagination page={page} pages={pages} onPage={setPage} approx={totalEstimated} />}

      {/* LEGEND */}
      <div className="mt-4 flex flex-wrap justify-between gap-x-6 gap-y-3 rounded-md border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-[18px] text-[13px]">
          <span className="label-mono">CLASS</span>
          {Object.values(CLS).map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1.5" style={{ color: c.color }}>
              <Dot color={c.color} />{c.label}
            </span>
          ))}
        </div>
        <div className="text-[13px] text-muted">
          Class = is the insider trading out of habit. Score = percentile rank within that class.{' '}
          <Link href="/about" className="text-text-secondary underline underline-offset-2 hover:text-white">Methodology</Link>
        </div>
      </div>
    </>
  )
}

// ─── News ─────────────────────────────────────────────────────────────────────

function NewsFeed({ ticker, search }: { ticker?: string; search: React.ReactNode }) {
  const [events,     setEvents]     = useState<EventItem[]>([])
  const [loading,    setLoading]    = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [page,       setPage]       = useState(1)
  const [total,      setTotal]      = useState(0)
  const [pages,      setPages]      = useState(1)
  const [sentiment,  setSentiment]  = useState('all')
  const [source,     setSource]     = useState('all')
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [sources,    setSources]    = useState<string[]>([])

  useEffect(() => {
    fetch('/api/signals?distinct=source')
      .then((r) => r.json())
      .then((d) => setSources(d.sources ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => { setPage(1) }, [ticker, sentiment, source, startDate, endDate])

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    const params = new URLSearchParams({ type: 'news', page: String(page), limit: String(NEWS_PAGE_SIZE) })
    if (ticker)              params.set('ticker', ticker)
    if (sentiment !== 'all') params.set('sentiment', sentiment)
    if (source !== 'all')    params.set('source', source)
    if (startDate)           params.set('start_date', startDate)
    if (endDate)             params.set('end_date', endDate)
    let cancelled = false
    fetch(`/api/signals?${params}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error ?? `HTTP ${r.status}`) })
        return r.json()
      })
      .then((d) => {
        if (cancelled) return
        setEvents(d.events ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
      })
      .catch((e: Error) => { if (!cancelled) setFetchError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ticker, sentiment, source, startDate, endDate, page])

  const pageStart = (page - 1) * NEWS_PAGE_SIZE + 1
  const pageEnd   = Math.min(page * NEWS_PAGE_SIZE, total)
  const countText = loading ? 'Loading…' : fetchError ? 'Failed to load' : total === 0 ? 'No headlines found' : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString('en-US')} headlines`

  return (
    <section className="flex flex-col gap-3 py-5">
      <div className="flex flex-wrap items-center gap-2.5">
        {search}
        <FilterSelect label="Sentiment" value={sentiment} onChange={setSentiment} options={[
          { value: 'all', label: 'All' },
          { value: 'bullish', label: 'Positive' },
          { value: 'neutral', label: 'Neutral' },
          { value: 'bearish', label: 'Negative' },
        ]} />
        <FilterSelect label="Source" value={source} onChange={setSource} options={[
          { value: 'all', label: 'All' },
          ...sources.map((s) => ({ value: s, label: s })),
        ]} />
        <FilterDate label="From" value={startDate} onChange={setStartDate} />
        <FilterDate label="To" value={endDate} onChange={setEndDate} />
      </div>
      <div className="flex justify-end">
        <span className={`font-mono text-xs ${fetchError ? 'text-routine' : 'text-muted'}`}>{countText}</span>
      </div>

      <div className="rounded-md border border-border">
        {loading && Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-row-border px-[18px] py-[14px] last:border-b-0">
            <span className="h-3 w-12 animate-pulse rounded-sm bg-track" />
            <span className="h-3 flex-1 animate-pulse rounded-sm bg-track" />
          </div>
        ))}

        {!loading && fetchError && (
          <div className="px-6 py-12 text-center">
            <div className="mb-1.5 text-sm text-routine">Failed to load headlines</div>
            <div className="font-mono text-xs text-muted">{fetchError}</div>
          </div>
        )}

        {!loading && !fetchError && events.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-muted">No headlines match these filters.</div>
        )}

        {!loading && !fetchError && events.map((ev) => {
          const meta  = parseMeta(ev.raw_text)
          const color = SENTIMENT_COLOR[meta.sentiment ?? ''] ?? 'var(--color-muted)'
          const title = decodeEntities(ev.title)
          return (
            <div key={ev.id} className="flex flex-col gap-1.5 border-b border-row-border px-[18px] py-[14px] last:border-b-0 hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4">
              <div className="flex items-center gap-3 sm:contents">
                <Link href={`/t/${ev.ticker}`} className="min-w-[56px] font-mono text-xs font-semibold text-heading no-underline hover:text-white">
                  {ev.ticker}
                </Link>
                <span className="inline-block h-[7px] w-[7px] flex-none rounded-full" style={{ background: color }} title={meta.sentiment ?? 'neutral'} aria-label={`Sentiment: ${meta.sentiment ?? 'neutral'}`} />
              </div>
              {ev.source_url ? (
                <a href={ev.source_url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 text-sm leading-[1.45] text-text no-underline hover:text-white hover:underline">
                  {title}
                </a>
              ) : (
                <Link href={`/t/${ev.ticker}`} className="min-w-0 flex-1 text-sm leading-[1.45] text-text no-underline hover:text-white hover:underline">
                  {title}
                </Link>
              )}
              <span className="shrink-0 whitespace-nowrap text-xs text-muted">
                {[meta.source, relTime(ev.published_at)].filter(Boolean).join(' · ')}
              </span>
            </div>
          )
        })}
      </div>

      {!loading && <Pagination page={page} pages={pages} onPage={setPage} />}
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScreenerPage() {
  const [tab,          setTab]          = useState<Tab>('insider')
  const [tickerInput,  setTickerInput]  = useState('')
  const [tickerFilter, setTickerFilter] = useState('')

  const search = <TickerFilter input={tickerInput} setInput={setTickerInput} setFilter={setTickerFilter} />

  return (
    <div className="min-h-screen bg-background pt-16 text-text">
      <main className="mx-auto max-w-[1400px] px-4 pb-16 md:px-8">
        {/* TITLE */}
        <section className="flex flex-col gap-2.5 pb-6 pt-10">
          <div className="font-mono text-xs tracking-[0.08em] text-muted">INSIDER SCREENER</div>
          <h1 className="m-0 font-serif text-[34px] font-normal leading-[1.08] tracking-[-0.01em] text-heading md:text-[46px]">
            Every insider buy, sorted by signal
          </h1>
          <p className="m-0 max-w-[640px] text-[15px] leading-relaxed text-text-secondary md:text-base">
            Open-market purchases from SEC Form 4 filings across the Russell 3000, classified and scored. Filter down to what matters to you.
          </p>
        </section>

        {/* TABS */}
        <div role="tablist" className="flex gap-1 border-b border-border">
          {([['insider', 'Insider activity'], ['news', 'News']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-px h-11 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-4 font-sans text-sm font-medium ${
                tab === value ? 'border-heading text-heading' : 'border-transparent text-muted hover:text-text-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'insider' && <InsiderActivity ticker={tickerFilter || undefined} search={search} />}
        {tab === 'news'    && <NewsFeed        ticker={tickerFilter || undefined} search={search} />}
      </main>
    </div>
  )
}
