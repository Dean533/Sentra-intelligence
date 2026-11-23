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
  const { data, error } = await sb
    .from('tickers')
    .select('symbol, name, market_cap')
    .in('symbol', ['ACCO', 'BC-PC', 'NVDA', 'NE-WT'])
  if (error) { console.error(error.message); process.exit(1) }
  console.log('\nspot-check market_cap values in DB:')
  for (const r of (data as any[])) {
    console.log(`  ${r.symbol.padEnd(8)}  market_cap = ${r.market_cap}  (type: ${typeof r.market_cap})`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
