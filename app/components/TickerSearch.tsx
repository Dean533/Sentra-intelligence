'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type SearchResult = { symbol: string; name: string }

/**
 * Compact ticker search for the navbar. Same /api/search autocomplete flow as the
 * old homepage HeroSearch, restyled small, with a "/" keyboard shortcut to focus.
 */
export default function TickerSearch({
  className = '',
  shortcut = true,
  onNavigate,
}: {
  className?: string
  shortcut?: boolean
  onNavigate?: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped whenever results become irrelevant (close/navigate/new query) so a
  // fetch that resolves late can't reopen the dropdown.
  const requestIdRef = useRef(0)

  function close() {
    requestIdRef.current++
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
    setOpen(false)
    setActive(-1)
  }

  // Close on any pointer-down outside the search (covers non-focusable areas)
  useEffect(() => {
    if (!open) return
    function onDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  // "/" focuses the search unless the user is already typing somewhere
  useEffect(() => {
    if (!shortcut) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shortcut])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function navigate(symbol: string) {
    close()
    setQuery('')
    setResults([])
    inputRef.current?.blur()
    onNavigate?.()
    router.push(`/t/${symbol}`)
  }

  function handleChange(val: string) {
    setQuery(val)
    close()
    if (val.trim().length < 2) { setResults([]); return }
    const id = requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val.trim())}`)
        const data = await res.json()
        if (id !== requestIdRef.current) return // stale: closed or superseded meanwhile
        const hits: SearchResult[] = data.results ?? []
        setResults(hits)
        // Only show results if the user is still in the box
        setOpen(hits.length > 0 && document.activeElement === inputRef.current)
      } catch {
        if (id !== requestIdRef.current) return
        setResults([])
        setOpen(false)
      }
    }, 200)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { close(); inputRef.current?.blur(); return }
    if (e.key === 'ArrowDown' && results.length) {
      e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % results.length); return
    }
    if (e.key === 'ArrowUp' && results.length) {
      e.preventDefault(); setActive((i) => (i <= 0 ? results.length - 1 : i - 1)); return
    }
    if (e.key !== 'Enter') return
    if (open && active >= 0 && results[active]) { navigate(results[active].symbol); return }
    const ticker = query.trim().toUpperCase()
    if (!ticker) return
    if (results.length === 1) { navigate(results[0].symbol); return }
    const exact = results.find((r) => r.symbol === ticker)
    navigate(exact ? exact.symbol : ticker)
  }

  return (
    <div
      ref={wrapperRef}
      className={`relative ${className}`}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) close() }}
    >
      <label className="flex h-9 items-center gap-2 rounded-sm border border-border-strong bg-surface px-2.5 focus-within:border-muted">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8B949E" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
        </svg>
        <span className="sr-only">Search a ticker</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setOpen(true)
            else if (query.trim().length >= 2) handleChange(query) // search was cancelled by a blur
          }}
          placeholder="Search a ticker"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls="ticker-search-results"
          className="min-w-0 flex-1 border-none bg-transparent font-mono text-[13px] text-text outline-none placeholder:text-muted"
        />
        {shortcut && (
          <span className="rounded-xs border border-border-strong px-[5px] py-px font-mono text-[11px] text-muted" aria-hidden="true">/</span>
        )}
      </label>

      {open && results.length > 0 && (
        <ul
          id="ticker-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[200] m-0 list-none overflow-hidden rounded-md border border-border-strong bg-surface p-0 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        >
          {results.map((r, i) => (
            <li key={r.symbol} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); navigate(r.symbol) }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full cursor-pointer items-baseline gap-3 border-0 border-b border-solid border-border px-3 py-2.5 text-left last:border-b-0 ${i === active ? 'bg-surface-hover' : 'bg-transparent'}`}
              >
                <span className="min-w-[52px] font-mono text-[13px] font-semibold text-heading">{r.symbol}</span>
                <span className="truncate text-[13px] text-muted">{r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
