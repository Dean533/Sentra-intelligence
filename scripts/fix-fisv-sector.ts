import * as path from 'path'
import * as fs from 'fs'
function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { error } = await sb.from('tickers').update({ sector: 'Financials' }).eq('symbol', 'FISV')
  if (error) { console.error('UPDATE failed:', error.message); process.exit(1) }

  const { data: fisv } = await sb.from('tickers').select('symbol, name, sector').eq('symbol', 'FISV').single()
  console.log('FISV:', JSON.stringify(fisv))

  const PAGE = 1000; let off = 0
  const counts: Record<string, number> = {}
  while (true) {
    const { data } = await sb.from('tickers').select('sector').range(off, off + PAGE - 1).order('symbol')
    if (!data || data.length === 0) break
    for (const r of data as any[]) { const s = r.sector ?? '(null)'; counts[s] = (counts[s] ?? 0) + 1 }
    off += data.length; if (data.length < PAGE) break
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  console.log('\nDistinct sectors:')
  for (const [s, c] of sorted) console.log(String(c).padStart(5) + '  ' + s)
  console.log('  ---')
  console.log(String(sorted.length).padStart(5) + '  distinct values')
}
main().catch(e => { console.error(e); process.exit(1) })
