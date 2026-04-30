'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Newspaper, FileText, TrendingUp, ChevronDown, Plus, Minus, Search } from 'lucide-react'
import { WebGLShader } from '@/components/ui/web-gl-shader'

// ─── animation helpers ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
}

function FadeUp({ children, delay = 0, className = '' }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ─── section 4 mock score card ────────────────────────────────────────────────

function ScoreCard() {
  const bars = [
    { label: 'Role (10% Owner)',        value: 20, max: 20 },
    { label: 'Trade Size ($5M–$25M)',   value: 15, max: 15 },
    { label: 'Sector (Comm. Services)', value: 12, max: 12 },
    { label: 'Cluster (3 insiders)',    value:  8, max:  8 },
  ]
  return (
    <div style={{
      background: '#18181b',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '16px',
      padding: '32px',
      maxWidth: '380px',
      width: '100%',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ fontSize: '13px', color: '#555', letterSpacing: '2px', marginBottom: '4px' }}>CONVICTION SCORE</div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#e6edf3' }}>APH</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '64px', fontWeight: 900, color: '#3fb950', lineHeight: 1, letterSpacing: '-2px' }}>92</div>
          <div style={{
            fontSize: '11px', fontWeight: 600, color: '#3fb950',
            border: '1px solid rgba(63,185,80,0.2)', background: 'rgba(63,185,80,0.08)',
            borderRadius: '999px', padding: '3px 12px', marginTop: '6px', display: 'inline-block',
          }}>
            HIGH CONVICTION
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '24px' }}>
        {bars.map(({ label, value, max }) => (
          <div key={label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: '#888' }}>{label}</span>
              <span style={{ fontSize: '12px', color: '#aaa' }}>{value}<span style={{ color: '#555' }}>/{max}</span></span>
            </div>
            <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)' }}>
              <div style={{
                height: '100%', borderRadius: '2px', background: 'rgba(63,185,80,0.6)',
                width: `${(value / max) * 100}%`,
                transition: 'width 1s ease',
              }} />
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}

// ─── faq item ─────────────────────────────────────────────────────────────────

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{
      marginBottom: '8px',
      background: open ? 'rgba(24,24,27,0.6)' : 'rgba(24,24,27,0.3)',
      border: `1px solid ${open ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
      borderRadius: '12px',
      transition: 'background 0.2s, border-color 0.2s',
    }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px', textAlign: 'left', gap: '16px',
        }}
      >
        <span style={{ fontSize: '16px', fontWeight: 600, color: '#e6edf3' }}>{q}</span>
        {open
          ? <Minus size={18} color="#9ca3af" style={{ flexShrink: 0 }} />
          : <Plus  size={18} color="#9ca3af" style={{ flexShrink: 0 }} />}
      </button>
      <div style={{
        overflow: 'hidden',
        maxHeight: open ? '200px' : '0',
        transition: 'max-height 0.3s ease',
      }}>
        <p style={{ fontSize: '15px', color: '#888', lineHeight: 1.7, margin: '0 0 20px', padding: '0 24px', paddingRight: '48px' }}>
          {a}
        </p>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

const FAQS = [
  {
    q: 'What is the Sentra Score?',
    a: "The conviction score is a 0-100 number that measures how strong an insider signal is. It weighs the insider's role, trade size, sector, and whether multiple insiders bought the same stock. Scores above 70 trigger a trade alert.",
  },
  {
    q: 'Where does the data come from?',
    a: 'All data comes from SEC EDGAR Form 4 filings — the mandatory disclosure form every corporate insider must file within 2 business days of trading their company\'s stock.',
  },
  {
    q: 'How often is data updated?',
    a: 'Signals are updated daily. New Form 4 filings are ingested every morning and scored automatically.',
  },
  {
    q: 'Is this financial advice?',
    a: 'No. Sentra is a signal intelligence tool, not a financial advisor. Always do your own research before making investment decisions.',
  },
  {
    q: 'What stocks does Sentra cover?',
    a: 'Sentra currently monitors all 500+ S&P 500 constituents with full signal coverage.',
  },
]

type SearchResult = { symbol: string; name: string }

function HeroSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useState<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useState<HTMLDivElement | null>(null)

  const navigate = (symbol: string) => {
    setOpen(false)
    setQuery('')
    router.push(`/t/${symbol}`)
  }

  const handleChange = (val: string) => {
    setQuery(val)
    if (debounceRef[0]) clearTimeout(debounceRef[0])
    if (val.length < 2) { setResults([]); setOpen(false); return }
    debounceRef[1](setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`)
      const data = await res.json()
      setResults(data.results ?? [])
      setOpen((data.results ?? []).length > 0)
    }, 200))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const ticker = query.trim().toUpperCase()
    if (!ticker) return
    if (results.length === 1) { navigate(results[0].symbol); return }
    const exact = results.find((r) => r.symbol === ticker)
    if (exact) { navigate(exact.symbol); return }
    navigate(ticker)
  }

  return (
    <div
      ref={(el) => { wrapperRef[1](el) }}
      style={{ position: 'relative', width: '100%', maxWidth: '680px', marginTop: '64px' }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}
    >
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.1)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '999px',
        padding: '0 28px',
        height: '72px',
      }}>
        <Search size={18} color="#9ca3af" style={{ flexShrink: 0, marginRight: '12px' }} />
        <input
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true) }}
          placeholder="Search a ticker or company... AAPL, Nvidia, Tesla"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#fff', fontSize: '20px',
          }}
        />
        {query && (
          <button
            onClick={() => navigate(query.trim().toUpperCase())}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
          >
            <Search size={16} color="#fff" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
          background: '#18181b',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '16px',
          overflow: 'hidden',
          zIndex: 50,
        }}>
          {results.map((r) => (
            <button
              key={r.symbol}
              tabIndex={0}
              onMouseDown={(e) => { e.preventDefault(); navigate(r.symbol) }}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                width: '100%', padding: '12px 20px', textAlign: 'left',
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px', minWidth: '56px' }}>{r.symbol}</span>
              <span style={{ color: '#9ca3af', fontSize: '14px' }}>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function HomePage() {
  return (
    <div style={{
      background: '#000',
      color: '#fff',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>

      {/* ── SECTION 1: HERO ─────────────────────────────────────────────────── */}
      <section style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', background: '#000' }}>
        {/* WebGL shader background */}
        <WebGLShader />

        {/* dark overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 10 }} />

        {/* content */}
        <div style={{
          position: 'relative', zIndex: 20,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', paddingTop: '120px', paddingLeft: '24px', paddingRight: '24px',
        }}>
          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 }}
            style={{
              fontSize: 'clamp(40px, 7vw, 96px)', fontWeight: 900,
              lineHeight: 1.0, letterSpacing: '-3px', whiteSpace: 'nowrap',
              margin: '0 0 20px', color: '#fff',
            }}
          >
            Sentra Intelligence
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.15 }}
            style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: '#aaa', fontWeight: 400, lineHeight: 1.4, maxWidth: '672px', margin: '0 0 40px', whiteSpace: 'nowrap' }}
          >
            We scan 500+ stocks for event mispricings so you don&apos;t have to.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.3 }}
            style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}
          >
            <Link href="/explore" style={{
              background: '#fff', color: '#000', padding: '16px 40px',
              borderRadius: '999px', textDecoration: 'none', fontWeight: 700, fontSize: '16px',
            }}>
              Explore Tickers
            </Link>
            <Link href="/top" style={{
              background: 'transparent', color: '#fff',
              border: '1px solid rgba(255,255,255,0.3)',
              padding: '16px 40px', borderRadius: '999px',
              textDecoration: 'none', fontWeight: 600, fontSize: '16px',
            }}>
              View Top Signals
            </Link>
          </motion.div>

          <HeroSearch />
        </div>

        {/* scroll indicator */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.2 }}
          style={{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 20 }}
        >
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronDown size={22} color="#555" />
          </motion.div>
        </motion.div>
      </section>

      {/* ── SECTION 2: STATS BAR ────────────────────────────────────────────── */}
      <section style={{ background: '#09090b', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{
          maxWidth: '1152px', margin: '0 auto', padding: '56px 24px',
          display: 'flex', justifyContent: 'center', gap: '0',
        }}>
          {[
            { value: '522', label: 'Stocks Monitored' },
            { value: '3',   label: 'Data Sources' },
            { value: 'Daily', label: 'Updated' },
          ].map(({ value, label }, i, arr) => (
            <FadeUp key={label} delay={i * 0.1} className="">
              <div style={{
                textAlign: 'center', padding: '0 64px',
                borderRight: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
              }}>
                <div style={{ fontSize: '52px', fontWeight: 900, letterSpacing: '-2px', marginBottom: '6px', color: '#fefce8' }}>
                  {value}
                </div>
                <div style={{ fontSize: '13px', color: '#555', letterSpacing: '0.5px' }}>{label}</div>
              </div>
            </FadeUp>
          ))}
        </div>
      </section>

      {/* ── SECTION 3: HOW IT WORKS ─────────────────────────────────────────── */}
      <section style={{ background: '#000', padding: '96px 24px', position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.02) 0%, transparent 70%)',
        }} />
        <div style={{ maxWidth: '1152px', margin: '0 auto', position: 'relative' }}>
          <FadeUp>
            <div style={{ textAlign: 'center', marginBottom: '64px' }}>
              <p style={{ fontSize: '11px', letterSpacing: '2.5px', color: '#555', margin: '0 0 14px' }}>HOW IT WORKS</p>
              <h2 style={{ fontSize: 'clamp(28px, 4vw, 48px)', fontWeight: 900, letterSpacing: '-1px', margin: '0 0 14px' }}>
                How Sentra Works
              </h2>
              <p style={{ fontSize: '17px', color: '#666', margin: 0 }}>Three signals. One score. Instant clarity.</p>
            </div>
          </FadeUp>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            {[
              {
                icon: <FileText size={22} color="#fff" />,
                title: 'SEC EDGAR Ingestion',
                body: 'Every Form 4 insider filing across 522 S&P 500 stocks is ingested daily, parsed, and stored with full metadata.',
                delay: 0,
              },
              {
                icon: <Newspaper size={22} color="#fff" />,
                title: 'Insider Classification',
                body: 'Each insider is classified as ROUTINE or OPPORTUNISTIC using a 3-year calendar pattern analysis based on Harvard and MIT research.',
                delay: 0.1,
              },
              {
                icon: <TrendingUp size={22} color="#fff" />,
                title: 'Conviction Scoring',
                body: 'Every opportunistic signal is scored 0-100 based on role seniority, trade size, sector alpha history, and insider clustering. Only scores above 70 trigger alerts.',
                delay: 0.2,
              },
            ].map(({ icon, title, body, delay }) => (
              <FadeUp key={title} delay={delay}>
                <div
                  style={{
                    background: 'rgba(24,24,27,0.5)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '16px', padding: '32px', height: '100%',
                    transition: 'border-color 0.3s, background 0.3s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
                    e.currentTarget.style.background = 'rgba(24,24,27,1)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                    e.currentTarget.style.background = 'rgba(24,24,27,0.5)'
                  }}
                >
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '12px', borderRadius: '12px',
                    background: 'rgba(255,255,255,0.05)',
                    marginBottom: '20px',
                  }}>
                    {icon}
                  </div>
                  <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 12px', color: '#fff' }}>{title}</h3>
                  <p style={{ fontSize: '14px', color: '#666', lineHeight: 1.7, margin: 0 }}>{body}</p>
                </div>
              </FadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4: SCORE EXPLAINER ──────────────────────────────────────── */}
      <section style={{ background: '#09090b', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '96px 24px' }}>
        <div style={{
          maxWidth: '1152px', margin: '0 auto',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '64px', alignItems: 'center',
        }}>
          {/* left */}
          <FadeUp>
            <div>
              <p style={{ fontSize: '11px', letterSpacing: '2.5px', color: '#555', margin: '0 0 14px' }}>THE CONVICTION SCORE</p>
              <h2 style={{ fontSize: 'clamp(26px, 3.5vw, 44px)', fontWeight: 900, letterSpacing: '-1px', margin: '0 0 20px', lineHeight: 1.1 }}>
                One number that tells you whether to act
              </h2>
              <p style={{ fontSize: '15px', color: '#666', lineHeight: 1.8, margin: '0 0 32px' }}>
                The conviction score weighs role seniority, trade size, sector performance, and insider
                clustering into a single number. Scores above 70 are actionable. Scores above 85 are high conviction.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0', marginBottom: '36px' }}>
                {[
                  { label: 'Role seniority',     pts: 'up to 20 pts' },
                  { label: 'Trade size',          pts: 'up to 15 pts' },
                  { label: 'Sector performance',  pts: 'up to 12 pts' },
                  { label: 'Insider clustering',  pts: 'up to 12 pts' },
                ].map(({ label, pts }, i, arr) => (
                  <div key={label} style={{
                    display: 'flex', justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  }}>
                    <span style={{ fontSize: '14px', color: '#aaa' }}>{label}</span>
                    <span style={{ fontSize: '13px', color: '#555' }}>{pts}</span>
                  </div>
                ))}
              </div>

              <Link href="/top" style={{
                display: 'inline-block',
                background: '#fff', color: '#000',
                padding: '12px 24px', borderRadius: '999px',
                textDecoration: 'none', fontWeight: 700, fontSize: '14px',
              }}>
                See Live Scores
              </Link>
            </div>
          </FadeUp>

          {/* right */}
          <FadeUp delay={0.15}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <ScoreCard />
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── SECTION 5: FAQ ──────────────────────────────────────────────────── */}
      <section style={{ background: '#000', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '96px 24px' }}>
        <div style={{ maxWidth: '720px', margin: '0 auto' }}>
          <FadeUp>
            <div style={{ textAlign: 'center', marginBottom: '56px' }}>
              <p style={{ fontSize: '11px', letterSpacing: '2.5px', color: '#555', margin: '0 0 14px' }}>FAQ</p>
              <h2 style={{ fontSize: 'clamp(26px, 4vw, 44px)', fontWeight: 900, letterSpacing: '-1px', margin: 0 }}>
                Frequently Asked Questions
              </h2>
            </div>
          </FadeUp>
          <FadeUp delay={0.1}>
            <div>
              {FAQS.map((item) => (
                <FAQItem key={item.q} q={item.q} a={item.a} />
              ))}
            </div>
          </FadeUp>
        </div>
      </section>

      {/* ── SECTION 6: CTA FOOTER ───────────────────────────────────────────── */}
      <section style={{ background: '#09090b', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '96px 24px' }}>
        <FadeUp>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
            <h2 style={{ fontSize: 'clamp(28px, 4vw, 52px)', fontWeight: 900, letterSpacing: '-1.5px', margin: '0 0 16px', lineHeight: 1.1 }}>
              See Today's Insider Signals
            </h2>
            <p style={{ fontSize: '17px', color: '#666', margin: '0 0 40px', lineHeight: 1.7 }}>
              522 S&P 500 stocks monitored daily. Only the strongest signals surface.
            </p>
            <Link
              href="/alerts"
              style={{
                display: 'inline-block',
                background: '#fff', color: '#000',
                padding: '16px 40px', borderRadius: '999px',
                textDecoration: 'none', fontWeight: 600, fontSize: '16px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f3f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#fff')}
            >
              View Alerts
            </Link>
          </div>
        </FadeUp>
      </section>

    </div>
  )
}
