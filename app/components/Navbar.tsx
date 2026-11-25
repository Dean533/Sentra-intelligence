'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'
import TickerSearch from './TickerSearch'

const NAV_LINKS = [
  { label: 'Screener',    href: '/screener' },
  { label: 'Tickers',     href: '/explore' },
  { label: 'Watchlist',   href: '/watchlist' },
  { label: 'Methodology', href: '/about' },
]

export default function Navbar() {
  const pathname = usePathname()
  const router   = useRouter()

  const [user,       setUser]       = useState<User | null>(null)
  const [showMenu,   setShowMenu]   = useState(false)
  const [scrolled,   setScrolled]   = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Sync auth state
  useEffect(() => {
    getSupabase().auth.getUser().then(({ data: { user } }) => setUser(user))
    const { data: { subscription } } = getSupabase().auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Translucent + blurred background once scrolled
  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 10) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Close desktop dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
    }
    if (showMenu) document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [showMenu])

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false) }, [pathname])

  async function signOut() {
    await getSupabase().auth.signOut()
    setShowMenu(false)
    setMobileOpen(false)
    router.push('/login')
  }

  const avatarUrl: string | undefined = user?.user_metadata?.avatar_url
  const email = user?.email ?? ''
  const initials = email ? email[0].toUpperCase() : '?'

  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(href))

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-[100] border-b border-border transition-[background-color,backdrop-filter] duration-300 ${
          scrolled || mobileOpen ? 'bg-background/95 backdrop-blur-md' : 'bg-background'
        }`}
      >
        <nav className="mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-6 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-10">
            <Link
              href="/"
              className="shrink-0 font-mono text-[15px] font-semibold tracking-[0.12em] text-text no-underline hover:text-white"
            >
              SENTRA<span className="font-normal text-muted">/SIGNALS</span>
            </Link>

            <div className="hidden gap-7 text-sm md:flex">
              {NAV_LINKS.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className={`no-underline transition-colors hover:text-white ${isActive(href) ? 'text-heading' : 'text-text-secondary'}`}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <TickerSearch className="hidden w-[240px] md:block" />

            {/* Auth area — desktop */}
            <div className="relative hidden md:block" ref={menuRef}>
              {user ? (
                <>
                  <button
                    onClick={() => setShowMenu((v) => !v)}
                    aria-label="Account menu"
                    aria-expanded={showMenu}
                    className="flex h-9 cursor-pointer items-center gap-2 rounded-sm border border-border-strong bg-transparent pl-1.5 pr-2.5 text-[13px] text-text-secondary hover:border-muted"
                  >
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="" width={24} height={24} className="block rounded-full" />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-border-strong font-mono text-[11px] font-semibold text-text">
                        {initials}
                      </span>
                    )}
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
                      <path d="M1 1l4 4 4-4" stroke="#8B949E" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>

                  {showMenu && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-[200] min-w-[200px] rounded-md border border-border-strong bg-surface p-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
                      <div className="mb-1 border-b border-border px-3 pb-2.5 pt-2">
                        <div className="label-mono mb-0.5">SIGNED IN AS</div>
                        <div className="truncate text-[13px] text-text-secondary">{email}</div>
                      </div>
                      <button
                        onClick={signOut}
                        className="block w-full cursor-pointer rounded-sm border-none bg-transparent px-3 py-2 text-left font-sans text-[13px] text-routine hover:bg-routine/10"
                      >
                        Sign out
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <Link
                  href="/login"
                  className="flex h-9 items-center rounded-sm border border-border-strong px-3.5 text-[13px] text-text-secondary no-underline hover:border-muted hover:text-white"
                >
                  Sign in
                </Link>
              )}
            </div>

            {/* Hamburger — mobile only */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
              className="flex cursor-pointer items-center justify-center border-none bg-transparent p-1 text-text-secondary md:hidden"
            >
              {mobileOpen ? (
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 3l14 14M17 3L3 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true">
                  <rect x="0" y="0" width="20" height="2" rx="1" fill="currentColor" />
                  <rect x="0" y="7" width="20" height="2" rx="1" fill="currentColor" />
                  <rect x="0" y="14" width="20" height="2" rx="1" fill="currentColor" />
                </svg>
              )}
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="fixed inset-x-0 top-16 z-[99] border-b border-border bg-background/95 px-4 pb-5 pt-4 backdrop-blur-md md:hidden">
          <TickerSearch shortcut={false} onNavigate={() => setMobileOpen(false)} className="mb-2" />
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={`block border-b border-border py-3.5 text-base no-underline ${isActive(href) ? 'font-medium text-heading' : 'text-text-secondary'}`}
            >
              {label}
            </Link>
          ))}

          <div className="pt-4">
            {user ? (
              <div>
                <div className="mb-3 text-xs text-muted">
                  Signed in as <span className="text-text-secondary">{email}</span>
                </div>
                <button
                  onClick={signOut}
                  className="cursor-pointer border-none bg-transparent p-0 font-sans text-[15px] text-routine"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="block rounded-sm border border-border-strong py-3 text-center text-[15px] font-semibold text-text no-underline"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}
