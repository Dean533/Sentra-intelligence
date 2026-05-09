'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase-browser'

// ─── Shared input style ───────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: '#0d1117', border: '1px solid #1e2530',
  borderRadius: '8px', padding: '10px 14px',
  color: '#e6edf3', fontSize: '14px', outline: 'none',
  fontFamily: 'inherit',
}

// ─── Google icon ──────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0' }}>
      <div style={{ flex: 1, height: '1px', background: '#1e2530' }} />
      <span style={{ fontSize: '12px', color: '#3a4a60', whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ flex: 1, height: '1px', background: '#1e2530' }} />
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter()
  const [mode,     setMode]     = useState<'signin' | 'signup'>('signin')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [success,  setSuccess]  = useState(false)

  function reset() { setError(null); setSuccess(false) }

  function switchMode(m: 'signin' | 'signup') { setMode(m); setError(null); setSuccess(false) }

  async function handleEmailAuth() {
    if (!email.trim() || !password) return
    setLoading(true); setError(null); setSuccess(false)
    const supabase = getSupabase()
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (error) { setError(error.message); setLoading(false); return }
      router.replace('/portfolio')
    } else {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password })
      if (error) { setError(error.message); setLoading(false); return }
      setSuccess(true)
      setLoading(false)
    }
  }

  async function handleGoogle() {
    setLoading(true); setError(null)
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: 'https://www.sentraintelligence.com/auth/callback' },
    })
    if (error) { setError(error.message); setLoading(false) }
  }

  async function handleForgotPassword() {
    if (!email.trim()) { setError('Enter your email address first.'); return }
    setLoading(true); setError(null)
    const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'https://www.sentraintelligence.com/auth/callback',
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSuccess(true)
  }

  return (
    <div style={{ background: '#0a0d12', minHeight: '100vh', fontFamily: 'inherit' }}>
    <div style={{
      display: 'flex', minHeight: '100vh',
      maxWidth: '1400px', margin: '0 auto',
    }}>

      {/* ── Left: auth form ────────────────────────────────────────────────── */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(60px, 8vh, 80px) clamp(20px, 4vw, 48px)',
        minWidth: 0,
      }}>
        <div style={{ width: '100%', maxWidth: '360px' }}>

          {/* Heading */}
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', margin: '0 0 6px', letterSpacing: '-0.4px' }}>
            {mode === 'signin' ? 'Sign in to Sentra' : 'Create your account'}
          </h1>
          <p style={{ fontSize: '13px', color: '#4a5568', margin: '0 0 28px' }}>
            {mode === 'signin' ? 'Track insider signals and manage your portfolio.' : 'Start tracking insider signals for free.'}
          </p>

          {/* Error */}
          {error && (
            <div style={{ background: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#f85149' }}>
              {error}
            </div>
          )}

          {/* Email confirmation success */}
          {success && (
            <div style={{ background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.25)', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#3fb950' }}>
              {mode === 'signup'
                ? 'Check your email to confirm your account.'
                : 'Password reset email sent. Check your inbox.'}
            </div>
          )}

          {/* Email + password form */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); reset() }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleEmailAuth() }}
              style={inputStyle}
              autoComplete="email"
              autoFocus
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); reset() }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleEmailAuth() }}
              style={inputStyle}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </div>

          {/* Forgot password */}
          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginBottom: '16px' }}>
              <button onClick={handleForgotPassword}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4a5568', fontSize: '12px', fontFamily: 'inherit', padding: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#7b8498' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#4a5568' }}>
                Forgot password?
              </button>
            </div>
          )}

          {/* Primary button */}
          <button
            onClick={handleEmailAuth}
            disabled={loading || !email.trim() || !password}
            style={{
              width: '100%', padding: '11px', borderRadius: '8px',
              background: loading || !email.trim() || !password ? '#1a2435' : '#1a2d4a',
              border: '1px solid #2a4a70', color: '#58a6ff',
              fontSize: '14px', fontWeight: 600, cursor: loading || !email.trim() || !password ? 'not-allowed' : 'pointer',
              opacity: loading || !email.trim() || !password ? 0.5 : 1,
              fontFamily: 'inherit', transition: 'opacity 0.15s',
            }}
          >
            {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>

          <Divider label="Or continue with" />

          {/* Google button */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              width: '100%', padding: '10px', borderRadius: '8px',
              background: '#fff', border: '1px solid #e2e8f0',
              color: '#1a1a1a', fontSize: '14px', fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
              fontFamily: 'inherit', transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = '#f8fafc' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
          >
            <GoogleIcon />
            Continue with Google
          </button>

          {/* Mode toggle */}
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#4a5568', marginTop: '24px' }}>
            {mode === 'signin' ? (
              <>Don't have an account?{' '}
                <button onClick={() => switchMode('signup')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#58a6ff', fontSize: '13px', fontFamily: 'inherit', padding: 0 }}>
                  Sign up
                </button>
              </>
            ) : (
              <>Already have an account?{' '}
                <button onClick={() => switchMode('signin')}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#58a6ff', fontSize: '13px', fontFamily: 'inherit', padding: 0 }}>
                  Sign in
                </button>
              </>
            )}
          </p>

        </div>
      </div>

      {/* ── Right: brand panel ─────────────────────────────────────────────── */}
      <div className="login-panel-right" style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        borderLeft: '1px solid #111620',
        padding: '60px 48px',
        position: 'relative', overflow: 'hidden',
        background: '#060910',
      }}>

        {/* Grid pattern overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          backgroundImage: `
            linear-gradient(rgba(30,37,48,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(30,37,48,0.5) 1px, transparent 1px)
          `,
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 80% at 50% 50%, black 40%, transparent 100%)',
        }} />

        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse 60% 50% at 50% 40%, rgba(63,185,80,0.05) 0%, transparent 70%)',
        }} />

        {/* Content */}
        <div style={{ position: 'relative', width: '100%', maxWidth: '340px', display: 'flex', flexDirection: 'column', gap: '40px' }}>

          {/* Wordmark */}
          <div>
            <span style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', letterSpacing: '-0.4px' }}>
              Sentra
            </span>
            <span style={{
              marginLeft: '10px', fontSize: '10px', fontWeight: 600,
              color: '#3fb950', letterSpacing: '1.5px',
              background: 'rgba(63,185,80,0.08)', border: '1px solid rgba(63,185,80,0.2)',
              borderRadius: '4px', padding: '2px 7px', verticalAlign: 'middle',
            }}>
              INTELLIGENCE
            </span>
          </div>

          {/* Stat cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { value: '+18% avg alpha',  label: 'Opportunistic insider trades at 180 days' },
              { value: '74% hit rate',    label: 'High conviction signals scoring 70+' },
              { value: '2,800+ trades',   label: 'Backtested across S&P 500, 2015–2026' },
            ].map(({ value, label }) => (
              <div key={value} style={{
                background: 'rgba(13,17,23,0.7)',
                border: '1px solid #1a2333',
                borderRadius: '10px',
                padding: '18px 20px',
                display: 'flex', flexDirection: 'column', gap: '4px',
              }}>
                <span style={{ fontSize: '22px', fontWeight: 700, color: '#3fb950', letterSpacing: '-0.5px', lineHeight: 1 }}>
                  {value}
                </span>
                <span style={{ fontSize: '12px', color: '#4a5568', lineHeight: 1.4 }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Research attribution */}
          <p style={{ fontSize: '11px', color: '#2a3a50', margin: 0, lineHeight: 1.5 }}>
            Powered by Cohen, Malloy &amp; Pomorski (2012)<br />Harvard/MIT research
          </p>

        </div>
      </div>

    </div>
    </div>
  )
}
