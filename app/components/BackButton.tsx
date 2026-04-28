'use client'
import { useRouter } from 'next/navigation'

export default function BackButton({ label, href }: { label: string, href?: string }) {
  const router = useRouter()

  const handleClick = () => {
    if (href) {
      router.push(href)
    } else {
      window.history.back()
    }
  }

  return (
    <button onClick={handleClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7b8498', fontSize: '12px', letterSpacing: '1.5px', display: 'inline-flex', alignItems: 'center', gap: '4px', position: 'relative', zIndex: 9999, pointerEvents: 'auto' }}>
      ← {label}
    </button>
  )
}
