'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabase } from '@/lib/supabase-browser'

export default function AuthCallbackPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code')
    if (!code) {
      router.replace('/watchlist')
      return
    }
    getSupabase().auth.exchangeCodeForSession(code)
      .then(({ error }) => {
        if (error) setError(error.message)
        else router.replace('/watchlist')
      })
  }, [router])

  if (error) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0d12', color: '#e6edf3',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: '12px', fontFamily: 'inherit',
      }}>
        <p style={{ color: '#f85149', fontSize: '14px' }}>Sign-in failed: {error}</p>
        <a href="/login" style={{ color: '#58a6ff', fontSize: '13px' }}>Try again</a>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0d12', color: '#4a5568',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '14px', fontFamily: 'inherit',
    }}>
      Completing sign in...
    </div>
  )
}
