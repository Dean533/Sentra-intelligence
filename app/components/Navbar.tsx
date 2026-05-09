'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { getSupabase } from '@/lib/supabase-browser'
import type { User } from '@supabase/supabase-js'

const NAV_LINKS = [
  { label: 'Explore',   href: '/explore' },
  { label: 'Events',    href: '/events' },
  { label: 'Portfolio', href: '/watchlist' },
  { label: 'About',     href: '/about' },
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

  // Solid background on scroll
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

  const navBg = scrolled || mobileOpen ? 'rgba(10,13,18,0.97)' : 'transparent'
  const navBlur = scrolled || mobileOpen ? 'blur(12px)' : 'none'
  const navBorder = scrolled || mobileOpen ? '1px solid rgba(255,255,255,0.05)' : '1px solid transparent'

  return (
    <>
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 40px', height: '60px',
        background: navBg,
        backdropFilter: navBlur,
        borderBottom: navBorder,
        transition: 'background 0.3s, backdrop-filter 0.3s, border-color 0.3s',
      }}>
        {/* Logo — always visible */}
        <Link href="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: '16px', letterSpacing: '-0.3px', flexShrink: 0 }}>
          Sentra
        </Link>

        {/* Nav links — hidden on mobile via CSS */}
        <div className="nav-links-desktop" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {NAV_LINKS.map(({ label, href }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link key={href} href={href}
                style={{ color: active ? '#fff' : '#6b7280', textDecoration: 'none', fontSize: '14px', fontWeight: active ? 500 : 400, padding: '6px 14px', borderRadius: '6px', transition: 'color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#fff' }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#6b7280' }}>
                {label}
              </Link>
            )
          })}
        </div>

        {/* Right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>

          {/* Auth area — hidden on mobile via CSS */}
          <div className="nav-auth-desktop" style={{ position: 'relative' }} ref={menuRef}>
            {user ? (
              <>
                <button
                  onClick={() => setShowMenu((v) => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    background: 'none', border: '1px solid #1e2530',
                    borderRadius: '8px', padding: '5px 10px 5px 6px',
                    cursor: 'pointer', color: '#c9d1d9', fontSize: '13px',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" width={26} height={26}
                      style={{ borderRadius: '50%', display: 'block' }} />
                  ) : (
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#1a2d4a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#58a6ff' }}>
                      {initials}
                    </div>
                  )}
                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email}
                  </span>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                    <path d="M1 1l4 4 4-4" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>

                {showMenu && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                    background: '#0d1117', border: '1px solid #1e2530',
                    borderRadius: '10px', padding: '6px', minWidth: '180px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 200,
                  }}>
                    <div style={{ padding: '8px 12px 10px', borderBottom: '1px solid #1e2530', marginBottom: '4px' }}>
                      <div style={{ fontSize: '11px', color: '#4a5568', marginBottom: '2px', letterSpacing: '0.5px' }}>Signed in as</div>
                      <div style={{ fontSize: '13px', color: '#c9d1d9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
                    </div>
                    <button
                      onClick={signOut}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', borderRadius: '6px',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: '#f85149', fontSize: '13px', fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(248,81,73,0.08)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Link href="/login"
                style={{ fontSize: '13px', color: '#7b8498', textDecoration: 'none', padding: '6px 14px', border: '1px solid #1e2530', borderRadius: '8px', transition: 'color 0.15s, border-color 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#c9d1d9'; e.currentTarget.style.borderColor = '#3a4a5a' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#7b8498'; e.currentTarget.style.borderColor = '#1e2530' }}>
                Sign In →
              </Link>
            )}
          </div>

          {/* Hamburger — hidden on desktop via CSS, shown on mobile */}
          <button
            className="hamburger-btn"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            style={{
              display: 'none', alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#c9d1d9', padding: '4px',
            }}
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M3 3l14 14M17 3L3 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                <rect x="0" y="0"  width="20" height="2" rx="1" fill="currentColor"/>
                <rect x="0" y="7"  width="20" height="2" rx="1" fill="currentColor"/>
                <rect x="0" y="14" width="20" height="2" rx="1" fill="currentColor"/>
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile dropdown — rendered below the nav bar */}
      {mobileOpen && (
        <div style={{
          position: 'fixed', top: '60px', left: 0, right: 0, zIndex: 99,
          background: 'rgba(10,13,18,0.97)', backdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '12px 24px 20px',
        }}>
          {NAV_LINKS.map(({ label, href }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href))
            return (
              <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                style={{
                  display: 'block', padding: '13px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                  color: active ? '#fff' : '#9ca3af',
                  textDecoration: 'none', fontSize: '16px',
                  fontWeight: active ? 600 : 400,
                }}>
                {label}
              </Link>
            )
          })}

          {/* Auth row */}
          <div style={{ paddingTop: '16px' }}>
            {user ? (
              <div>
                <div style={{ fontSize: '12px', color: '#4a5568', marginBottom: '12px' }}>
                  Signed in as <span style={{ color: '#c9d1d9' }}>{email}</span>
                </div>
                <button onClick={signOut} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#f85149', fontSize: '15px', fontFamily: 'inherit', padding: 0,
                }}>
                  Sign Out
                </button>
              </div>
            ) : (
              <Link href="/login" onClick={() => setMobileOpen(false)}
                style={{
                  display: 'block', textAlign: 'center', padding: '12px',
                  borderRadius: '8px', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff', textDecoration: 'none', fontSize: '15px', fontWeight: 600,
                }}>
                Sign In
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}
