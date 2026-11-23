import * as path from 'path'; import * as fs from 'fs'
import { createClient } from '@supabase/supabase-js'
function loadEnv() {
  for (const line of fs.readFileSync(path.join(__dirname,'..', '.env.local'),'utf-8').split('\n')) {
    const t=line.trim(); if(!t||t.startsWith('#')) continue
    const eq=t.indexOf('='); if(eq<0) continue
    const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim().replace(/^["']|["']$/g,'')
    if(!process.env[k]) process.env[k]=v
  }
}
loadEnv()
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)

async function main() {
  const { data: tk } = await sb.from('tickers').select('symbol,name').in('symbol',['H','UBER','TEM','EQH','ARES','JHG'])
  console.log('TICKERS TABLE:')
  for (const r of tk??[]) console.log(' ', (r as any).symbol, '|', (r as any).name)

  const { data: tx } = await sb.from('insider_transactions')
    .select('ticker,insider_name,transaction_direction,total_value')
    .in('ticker',['H','UBER','TEM'])
  console.log('\nINSIDER_TRANSACTIONS for H / UBER / TEM:')
  const byT: Record<string, Set<string>> = {}
  for (const r of tx??[]) {
    const rr = r as any
    if (!byT[rr.ticker]) byT[rr.ticker] = new Set()
    byT[rr.ticker].add(rr.insider_name)
  }
  for (const [t, names] of Object.entries(byT)) {
    console.log(` ${t}:  ${[...names].slice(0,8).join(' | ')}`)
  }
  if (Object.keys(byT).length === 0) console.log('  (no rows found — these tickers may not exist in insider_transactions)')
}
main().catch(e=>{console.error(e);process.exit(1)})
