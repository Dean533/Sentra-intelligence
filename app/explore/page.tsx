'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

// ─── types ────────────────────────────────────────────────────────────────────

type Ticker = {
  id: string
  symbol: string
  name: string
  sector: string
  market_cap: number | null
  price: number | null
  day_change: number | null
  day_change_percent: number | null
}

type SortKey = 'market_cap' | 'alpha' | 'sector'

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Market Cap', value: 'market_cap' },
  { label: 'A → Z',      value: 'alpha' },
  { label: 'Sector',     value: 'sector' },
]

const SECTOR_OPTIONS = [
  'All Sectors',
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Financials',
  'Health Care',
  'Industrials',
  'Information Technology',
  'Materials',
  'Real Estate',
  'Utilities',
]

// ─── shared styles ────────────────────────────────────────────────────────────

const thBase = 'px-2 py-3 font-mono text-[11px] font-medium tracking-[0.08em] text-muted md:whitespace-nowrap md:px-4'
const th  = `${thBase} text-left`
const thR = `${thBase} text-right`
const td  = 'px-2 py-[13px] md:px-4'
const btnSecondary =
  'inline-flex h-10 cursor-pointer items-center justify-center rounded-sm border border-border-strong bg-transparent px-4 font-sans text-sm text-text-secondary transition-colors hover:border-muted hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

// #, Company and Sector columns are hidden on small screens (company moves under the ticker).
const hideMobile = 'hidden md:table-cell'
const MOBILE_HIDDEN_COLS = [0, 2, 3]

const COLS: { label: string; cls: string }[] = [
  { label: '#',          cls: `${th} ${hideMobile} w-12` },
  { label: 'TICKER',     cls: th },
  { label: 'COMPANY',    cls: `${th} ${hideMobile}` },
  { label: 'SECTOR',     cls: `${th} ${hideMobile}` },
  { label: 'PRICE',      cls: thR },
  { label: 'DAY CHANGE', cls: thR },
  { label: 'MARKET CAP', cls: thR },
]

// Labeled select, same as the screener's filter controls.
function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className="relative flex h-10 items-center gap-2 rounded-sm border border-border-strong bg-surface pl-3 pr-8">
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatMarketCap(num: number | null): string {
  if (num == null) return '—'
  if (num >= 1e12) return `$${(num / 1e12).toFixed(1)}T`
  if (num >= 1e9)  return `$${(num / 1e9).toFixed(1)}B`
  return `$${(num / 1e6).toFixed(1)}M`
}

// ─── component ────────────────────────────────────────────────────────────────

export default function ExplorePage() {
  const [tickers,        setTickers]        = useState<Ticker[]>([])
  const [loading,        setLoading]        = useState(true)
  const [total,          setTotal]          = useState(0)
  const [pages,          setPages]          = useState(1)
  const [page,           setPage]           = useState(1)
  const [sector,         setSector]         = useState('All Sectors')
  const [sortBy,         setSortBy]         = useState<SortKey>('market_cap')
  const [search,         setSearch]         = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const router   = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounce search input; reset page when it changes
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  // ── data fetching ──────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ sort: sortBy, page: String(page) })
    if (sector !== 'All Sectors') params.set('sector', sector)
    if (debouncedSearch)          params.set('search', debouncedSearch)

    fetch(`/api/tickers?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setTickers(d.tickers ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
        setLoading(false)
      })
  }, [sector, sortBy, page, debouncedSearch])

  // Reset to page 1 when filters change
  function changeSector(val: string) { setSector(val); setPage(1) }
  function changeSort(val: SortKey)  { setSortBy(val); setPage(1) }

  // ── search ─────────────────────────────────────────────────────────────────

  const searchVal = search.trim().toUpperCase()

  // Local filter for instant feedback while debounce is pending
  const filtered = search.trim()
    ? tickers.filter((t) => {
        const q = search.toLowerCase()
        return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
      })
    : tickers

  const showSearchFor = searchVal.length > 0 && !filtered.some((t) => t.symbol === searchVal)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !searchVal) return
    const exact = filtered.find((t) => t.symbol === searchVal)
    if (exact)               { router.push(`/t/${exact.symbol}`);     return }
    if (filtered.length === 1) { router.push(`/t/${filtered[0].symbol}`); return }
    router.push(`/t/${searchVal}`)
  }

  // ── pagination label ───────────────────────────────────────────────────────

  const pageStart = (page - 1) * 30 + 1
  const pageEnd   = Math.min(page * 30, total)

  // ─── render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background pt-16 text-text">
      <main className="mx-auto max-w-[1400px] px-4 pb-16 md:px-8">

        {/* TITLE */}
        <section className="flex flex-col gap-2.5 pb-6 pt-10">
          <div className="font-mono text-xs tracking-[0.08em] text-muted">TICKER EXPLORER</div>
          <h1 className="m-0 font-serif text-[34px] font-normal leading-[1.08] tracking-[-0.01em] text-heading md:text-[46px]">
            Ticker Explorer
          </h1>
          <p className="m-0 max-w-[640px] text-[15px] leading-relaxed text-text-secondary md:text-base">
            Search any stock to see Sentra&apos;s signal analysis, or browse our coverage universe below.
          </p>
        </section>

        {/* SEARCH */}
        <label className="flex h-12 items-center gap-3 rounded-sm border border-border-strong bg-surface px-4 focus-within:border-muted">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8B949E" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">Search by ticker or company name</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by ticker or company name… NVDA, Apple, Tesla"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-w-0 flex-1 border-none bg-transparent font-sans text-base text-text outline-none placeholder:text-muted"
          />
          {search && (
            <span className="pointer-events-none hidden font-mono text-[11px] tracking-[0.08em] text-muted sm:inline">ENTER ↵</span>
          )}
        </label>

        {/* CONTROLS: count left, selects right */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 pt-5">
          <span className="font-mono text-xs text-muted">
            {loading
              ? 'Loading…'
              : `Showing ${pageStart}–${pageEnd} of ${total.toLocaleString()} stocks`}
          </span>
          <div className="flex flex-wrap gap-2.5">
            <FilterSelect
              label="Sector"
              value={sector}
              onChange={changeSector}
              options={SECTOR_OPTIONS.map((s) => ({ value: s, label: s }))}
            />
            <FilterSelect label="Sort" value={sortBy} onChange={(v) => changeSort(v as SortKey)} options={SORT_OPTIONS} />
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse md:min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface">
                {COLS.map((c) => <th key={c.label} className={c.cls}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>

              {/* "Search for X" row — shown when query has no exact match in visible 30 */}
              {!loading && showSearchFor && (
                <tr
                  onClick={() => router.push(`/t/${searchVal}`)}
                  className="cursor-pointer border-b border-row-border transition-colors hover:bg-surface-hover"
                >
                  <td colSpan={7} className={td}>
                    <span className="mr-2.5 text-muted">↗</span>
                    <span className="text-muted">Press Enter to search </span>
                    <span className="font-mono font-semibold text-heading">{searchVal}</span>
                    <span className="text-muted"> directly</span>
                    <span className="ml-2 text-muted">→</span>
                  </td>
                </tr>
              )}

              {/* loading skeleton */}
              {loading && Array.from({ length: 10 }).map((_, i) => (
                <tr key={i} className="border-b border-row-border last:border-b-0">
                  {COLS.map((_, j) => (
                    <td key={j} className={`${td} ${MOBILE_HIDDEN_COLS.includes(j) ? hideMobile : ''}`}>
                      <div
                        className={`h-3.5 animate-pulse rounded-xs bg-track ${j >= 4 ? 'ml-auto' : ''}`}
                        style={{ width: j === 2 ? 140 : j === 0 ? 20 : 60 }}
                      />
                    </td>
                  ))}
                </tr>
              ))}

              {/* ticker rows */}
              {!loading && filtered.length === 0 && !showSearchFor ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-muted">
                    No tickers match your filters.
                  </td>
                </tr>
              ) : (
                !loading && filtered.map((t, i) => (
                  <tr
                    key={t.id}
                    onClick={() => router.push(`/t/${t.symbol}`)}
                    className="cursor-pointer border-b border-row-border transition-colors last:border-b-0 hover:bg-surface-hover"
                  >
                    <td className={`${td} ${hideMobile} font-mono text-muted`}>{(page - 1) * 30 + i + 1}</td>
                    <td className={td}>
                      <div className="font-mono font-semibold text-heading">{t.symbol}</div>
                      <div className="max-w-[110px] truncate text-xs text-muted md:hidden">{t.name}</div>
                    </td>
                    <td className={`${td} ${hideMobile} max-w-[320px] truncate text-text-secondary`}>{t.name}</td>
                    <td className={`${td} ${hideMobile} text-muted`}>{t.sector}</td>
                    <td className={`${td} text-right font-mono text-text`}>
                      {t.price ? `$${t.price.toFixed(2)}` : '—'}
                    </td>
                    <td
                      className={`${td} text-right font-mono ${
                        t.day_change_percent == null ? 'text-muted'
                          : t.day_change_percent >= 0 ? 'text-opportunistic' : 'text-routine'
                      }`}
                    >
                      {t.day_change_percent != null
                        ? `${t.day_change_percent >= 0 ? '+' : ''}${t.day_change_percent.toFixed(2)}%`
                        : '—'}
                    </td>
                    <td className={`${td} text-right font-mono text-text-secondary`}>
                      {formatMarketCap(t.market_cap)}
                    </td>
                  </tr>
                ))
              )}

            </tbody>
          </table>
        </div>

        {/* PAGINATION */}
        {!loading && pages > 1 && (
          <div className="flex items-center justify-center gap-4 pt-6">
            <button onClick={() => setPage((p) => p - 1)} disabled={page === 1} className={btnSecondary}>← Previous</button>
            <span className="font-mono text-xs text-muted">Page {page} of {pages}</span>
            <button onClick={() => setPage((p) => p + 1)} disabled={page === pages} className={btnSecondary}>Next →</button>
          </div>
        )}
      </main>
    </div>
  )
}
