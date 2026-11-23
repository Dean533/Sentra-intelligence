// Temporary diagnostic: how many P-code rows have conviction_score, by month.
// Run: npx tsx scripts/probe-scoring-dates.ts
import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

const envPath = path.join(__dirname, '..', '.env.local')
for (const line of fs.readFileSync(envPath,'utf-8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#')) continue
  const eq=t.indexOf('='); if(eq<0) continue
  const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim().replace(/^["']|["']$/g,'')
  if(!process.env[k]) process.env[k]=v
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)

async function page<T>(query: any): Promise<T[]> {
  const PAGE = 1000
  const all: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query.range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const r of data) all.push(r as T)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  // Coverage by month for 2026
  const monthly = await page<any>(
    sb.from('insider_transactions')
      .select('transaction_date, conviction_score, classification')
      .eq('transaction_code', 'P')
      .gte('transaction_date', '2026-01-01')
      .order('transaction_date', { ascending: true })
  )

  const byMonth = new Map<string, {total: number, scored: number}>()
  for (const r of monthly) {
    const m = (r.transaction_date as string).slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, {total: 0, scored: 0})
    const e = byMonth.get(m)!
    e.total++
    if (r.conviction_score != null) e.scored++
  }

  console.log('\nMonth        | Total P-code | Scored | Coverage')
  console.log('-------------|--------------|--------|----------')
  for (const [m, {total, scored}] of [...byMonth.entries()].sort()) {
    console.log(`${m}      | ${String(total).padStart(12)} | ${String(scored).padStart(6)} | ${(scored/total*100).toFixed(0)}%`)
  }

  // Earliest scored
  const { data: first } = await sb
    .from('insider_transactions')
    .select('transaction_date, conviction_score, classification, ticker, insider_name')
    .eq('transaction_code', 'P')
    .not('conviction_score', 'is', null)
    .order('transaction_date', { ascending: true })
    .limit(5)
  console.log('\nEarliest 5 scored transactions:')
  for (const r of first ?? []) {
    console.log(`  ${r.transaction_date}  ${r.ticker.padEnd(6)}  score=${r.conviction_score}  cls=${r.classification}`)
  }

  // Most recent
  const { data: latest } = await sb
    .from('insider_transactions')
    .select('transaction_date, conviction_score, classification, ticker, insider_name')
    .eq('transaction_code', 'P')
    .order('transaction_date', { ascending: false })
    .limit(10)
  console.log('\nMost recent 10 transactions:')
  for (const r of latest ?? []) {
    const s = r.conviction_score != null ? String(r.conviction_score) : 'NULL'
    console.log(`  ${r.transaction_date}  ${r.ticker.padEnd(6)}  score=${s}  cls=${r.classification ?? 'null'}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
