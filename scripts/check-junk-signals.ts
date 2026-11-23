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

const SYMS = ['NE-WT', 'BC-PC', 'T-PC', 'TSEOQ']

async function main() {
  const { data: tx } = await sb
    .from('insider_transactions')
    .select('ticker, transaction_direction, transaction_code, insider_name')
    .in('ticker', SYMS)

  console.log(`insider_transactions: ${tx?.length ?? 0} rows`)
  for (const r of (tx ?? []) as any[])
    console.log(`  ${r.ticker}  ${r.transaction_code}  ${r.transaction_direction}  ${r.insider_name}`)

  const { data: sc, error: scErr } = await sb
    .from('insider_scores')
    .select('ticker, score, computed_at')
    .in('ticker', SYMS)

  if (scErr) {
    console.log(`insider_scores: table not found or error — ${scErr.message}`)
  } else {
    console.log(`\ninsider_scores: ${sc?.length ?? 0} rows`)
    for (const r of (sc ?? []) as any[])
      console.log(`  ${r.ticker}  score=${r.score}  at=${r.computed_at}`)
  }

  const { data: ev } = await sb
    .from('events')
    .select('ticker, event_type, title, event_date')
    .in('ticker', SYMS)
    .eq('event_type', 'insider')

  console.log(`\nevents (insider type): ${ev?.length ?? 0} rows`)
  for (const r of (ev ?? []) as any[])
    console.log(`  ${r.ticker}  ${r.event_date}  ${r.title?.slice(0, 60)}`)
}
main().catch(e => { console.error(e); process.exit(1) })
