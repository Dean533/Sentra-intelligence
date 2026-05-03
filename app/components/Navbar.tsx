'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_LINKS = [
  { label: 'Explore', href: '/explore' },
  { label: 'Events', href: '/events' },
  { label: 'Top Signals', href: '/alerts' },
  { label: 'About', href: '/about' },
]

export default function Navbar() {
  const pathname = usePathname()

  return (
    <nav style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 100,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 40px',
      height: '60px',
      background: 'transparent',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <Link href="/" style={{
        color: '#fff',
        textDecoration: 'none',
        fontWeight: 700,
        fontSize: '16px',
        letterSpacing: '-0.3px',
      }}>
        Sentra
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {NAV_LINKS.map(({ label, href }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              style={{
                color: active ? '#fff' : '#6b7280',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: active ? 500 : 400,
                padding: '6px 14px',
                borderRadius: '6px',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff' }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#6b7280' }}
            >
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
