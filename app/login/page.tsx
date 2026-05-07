'use client'

import { getSupabase } from '@/lib/supabase-browser'

export default function LoginPage() {
  async function signInWithGoogle() {
    await getSupabase().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://www.sentraintelligence.com/auth/callback',
      },
    })
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0d12', color: '#e6edf3',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'inherit',
    }}>
      <div style={{ width: '100%', maxWidth: '380px', padding: '0 24px', textAlign: 'center' }}>

        {/* Logo */}
        <div style={{ marginBottom: '40px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.3px', color: '#e6edf3' }}>
            Sentra
          </span>
        </div>

        {/* Heading */}
        <h1 style={{
          fontSize: '24px', fontWeight: 700, margin: '0 0 12px',
          letterSpacing: '-0.5px', color: '#e6edf3',
        }}>
          Welcome to Sentra Intelligence
        </h1>
        <p style={{ fontSize: '14px', color: '#4a5568', margin: '0 0 40px', lineHeight: '1.6' }}>
          Sign in to save your portfolio and get insider alerts
        </p>

        {/* Google button */}
        <button
          onClick={signInWithGoogle}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
            width: '100%', padding: '12px 20px',
            background: '#fff', border: '1px solid #e2e8f0',
            borderRadius: '10px', cursor: 'pointer',
            fontSize: '15px', fontWeight: 600, color: '#1a1a1a',
            fontFamily: 'inherit', transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#fff' }}
        >
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <p style={{ fontSize: '12px', color: '#3a4a60', marginTop: '24px' }}>
          By signing in you agree to our terms of service.
        </p>
      </div>
    </div>
  )
}
