// npx tsx scripts/audit-sectors.ts
import * as path from 'path'
import * as fs from 'fs'

function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}
loadEnv()

import { createClient } from '@supabase/supabase-js'
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // Paginate tickers to get all sector values
  const PAGE = 1000
  let offset = 0
  const allSectors: (string | null)[] = []
  while (true) {
    const { data, error } = await sb.from('tickers').select('sector').range(offset, offset + PAGE - 1).order('symbol')
    if (error) { console.error(error.message); process.exit(1) }
    if (!data || data.length === 0) break
    for (const r of data as any[]) allSectors.push(r.sector ?? null)
    offset += data.length
    if (data.length < PAGE) break
  }

  const counts: Record<string, number> = {}
  for (const s of allSectors) {
    const key = s ?? '(null)'
    counts[key] = (counts[key] ?? 0) + 1
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  console.log('\n=== tickers.sector — distinct values ===')
  for (const [s, c] of sorted) console.log(String(c).padStart(5) + '  ' + s)
  console.log('  ---')
  console.log(String(allSectors.length).padStart(5) + '  TOTAL rows')
  console.log(String(sorted.length).padStart(5) + '  distinct values')

  // Check insider_transactions for sector column
  const { data: itSample, error: e2 } = await sb
    .from('insider_transactions').select('sector').limit(1)
  if (e2) {
    console.log('\ninsider_transactions.sector: COLUMN DOES NOT EXIST')
    console.log('  (' + e2.message + ')')
  } else {
    console.log('\ninsider_transactions.sector: column EXISTS')
    console.log('  sample:', JSON.stringify(itSample))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
