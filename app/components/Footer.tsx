'use client'

import Link from 'next/link'

function SocialLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#7b8498', textDecoration: 'none', fontSize: '13px', transition: 'color 0.15s' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#c9d1d9')}
      onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}
    >
      {icon}
      {label}
    </a>
  )
}

function FooterLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{ color: '#7b8498', textDecoration: 'none', fontSize: '13px', transition: 'color 0.15s' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = '#c9d1d9')}
      onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}
    >
      {label}
    </Link>
  )
}

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
  </svg>
)

const LinkedInIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
  </svg>
)

const RadarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <circle cx="10" cy="10" r="2.5" fill="#9ecbff" />
    <circle cx="10" cy="10" r="5.5" stroke="#9ecbff" strokeOpacity="0.45" strokeWidth="1.5" />
    <circle cx="10" cy="10" r="9"   stroke="#9ecbff" strokeOpacity="0.18" strokeWidth="1.5" />
  </svg>
)

export default function Footer() {
  return (
    <footer style={{ background: '#060910', borderTop: '1px solid #1a2030', marginTop: '80px' }}>

      <style>{`
        .footer-grid {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr;
          gap: 48px;
          max-width: 1400px;
          margin: 0 auto;
          padding: 56px 40px 48px;
        }
        .footer-bottom {
          max-width: 1400px;
          margin: 0 auto;
          padding: 20px 40px 28px;
          border-top: 1px solid #1a2030;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (max-width: 680px) {
          .footer-grid {
            grid-template-columns: 1fr;
            gap: 36px;
            padding: 40px 24px 36px;
          }
          .footer-bottom {
            padding: 20px 24px 28px;
          }
        }
      `}</style>

      <div className="footer-grid">

        {/* Column 1: Brand */}
        <div>
          <Link
            href="/"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '9px', textDecoration: 'none', marginBottom: '14px' }}
          >
            <RadarIcon />
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#e6edf3', letterSpacing: '-0.2px' }}>
              Sentra Signals
            </span>
          </Link>
          <p style={{ fontSize: '13px', color: '#7b8498', lineHeight: 1.65, margin: 0, maxWidth: '360px' }}>
            Sentra Signals is an insider-activity radar. It tracks SEC Form 4 filings across the Russell 3000 and surfaces the trades that carry real signal.
          </p>
        </div>

        {/* Column 2: Community */}
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#3a4a60', fontWeight: 600, margin: '0 0 16px', textTransform: 'uppercase' }}>
            Community
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <SocialLink href="https://x.com/deangans_" icon={<XIcon />} label="X / Twitter" />
            <SocialLink href="https://www.linkedin.com/company/sentrasignals/" icon={<LinkedInIcon />} label="LinkedIn" />
          </div>
        </div>

        {/* Column 3: Legal links */}
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '1.5px', color: '#3a4a60', fontWeight: 600, margin: '0 0 16px', textTransform: 'uppercase' }}>
            Legal
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
            <FooterLink href="/privacy"     label="Privacy Policy" />
            <FooterLink href="/terms"       label="Terms of Service" />
            <a
              href="/sitemap.xml"
              style={{ color: '#7b8498', textDecoration: 'none', fontSize: '13px', transition: 'color 0.15s' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#c9d1d9')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#7b8498')}
            >
              Sitemap
            </a>
          </div>
        </div>

      </div>

      <div className="footer-bottom">
        <p style={{ fontSize: '12px', color: '#4a5568', margin: 0 }}>
          Sentra Signals 2026
        </p>
        <p style={{ fontSize: '11px', color: '#2e3c50', lineHeight: 1.65, margin: 0, maxWidth: '820px' }}>
          Sentra Signals provides informational data only and is not a registered investment advisor. Nothing on this site is investment advice. Insider trading data is sourced from public SEC filings. Do your own research before making any investment decision.
        </p>
      </div>

    </footer>
  )
}
