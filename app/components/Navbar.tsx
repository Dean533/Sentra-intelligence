'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { label: 'Explore', href: '/explore' },
  { label: 'Signals', href: '/signals' },
  { label: 'Narratives', href: '/narratives' },
  { label: 'Top 10', href: '/top' },
  { label: 'Sources', href: '/sources' },
]

export default function Navbar() {
  const pathname = usePathname()

  return (
    <nav
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '0 40px',
        height: '56px',
        borderBottom: '1px solid #1e2530',
        background: '#0a0e14',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      {/* logo */}
      <Link
        href="/"
        style={{
          color: 'white',
          textDecoration: 'none',
          fontWeight: 800,
          fontSize: '17px',
          letterSpacing: '-0.3px',
          marginRight: '16px',
        }}
      >
        Sentra
      </Link>

      {/* nav links */}
      {NAV_LINKS.map(({ label, href }) => {
        const active = pathname === href || (href !== '/' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            style={{
              color: active ? '#ffffff' : '#7b8498',
              textDecoration: 'none',
              fontSize: '14px',
              fontWeight: active ? 600 : 400,
              padding: '6px 12px',
              borderRadius: '6px',
              background: active ? 'rgba(255,255,255,0.07)' : 'transparent',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.color = '#c9d1d9'
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.color = '#7b8498'
            }}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
