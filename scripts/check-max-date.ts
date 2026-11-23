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
  // Max transaction_date
  const { data: maxTx } = await sb
    .from('insider_transactions')
    .select('transaction_date')
    .order('transaction_date', { ascending: false })
    .limit(1)
  console.log('MAX transaction_date:', (maxTx as any[])?.[0]?.transaction_date)

  // Max filed_date (when SEC received it — different from transaction date)
  const { data: maxFiled } = await sb
    .from('insider_transactions')
    .select('filed_date')
    .order('filed_date', { ascending: false })
    .limit(1)
  console.log('MAX filed_date:', (maxFiled as any[])?.[0]?.filed_date)

  // Count of rows by filed_date for last 7 days (shows what each cron run ingested)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const { data: byDate } = await sb
    .from('insider_transactions')
    .select('filed_date')
    .gte('filed_date', cutoff)
    .order('filed_date', { ascending: false })

  const counts: Record<string, number> = {}
  for (const r of (byDate ?? []) as any[]) {
    const d = r.filed_date ?? '(null)'
    counts[d] = (counts[d] ?? 0) + 1
  }
  console.log('\nRows by filed_date (last 7 days):')
  for (const [d, c] of Object.entries(counts).sort().reverse())
    console.log(`  ${d}  ${c} rows`)
}
main().catch(e => { console.error(e); process.exit(1) })
