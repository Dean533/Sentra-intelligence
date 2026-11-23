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
  // 1. Null vs non-null count
  const { count: nullCount } = await sb
    .from('tickers')
    .select('*', { count: 'exact', head: true })
    .is('market_cap', null)

  const { count: totalCount } = await sb
    .from('tickers')
    .select('*', { count: 'exact', head: true })

  console.log(`\n=== market_cap null audit ===`)
  console.log(`  Total tickers : ${totalCount}`)
  console.log(`  Has market_cap: ${(totalCount ?? 0) - (nullCount ?? 0)}`)
  console.log(`  NULL market_cap: ${nullCount}`)

  // 2. What does ORDER BY market_cap DESC look like for nulls — do they sort first or last?
  // Supabase/PostgreSQL: NULLs sort LAST on DESC by default, but let's verify by checking
  // what the first page actually returns (what the explore page sees)
  console.log(`\n=== First 30 rows as seen by explore page (sort=market_cap DESC) ===`)
  const { data: firstPage } = await sb
    .from('tickers')
    .select('symbol, name, market_cap')
    .order('market_cap', { ascending: false })
    .range(0, 29)

  let nullsOnPage = 0
  for (const r of (firstPage ?? []) as any[]) {
    const cap = r.market_cap
    const display = cap == null ? 'NULL' : cap >= 1e12 ? `$${(cap/1e12).toFixed(1)}T` : cap >= 1e9 ? `$${(cap/1e9).toFixed(1)}B` : `$${(cap/1e6).toFixed(1)}M`
    if (cap == null) nullsOnPage++
    console.log(`  ${r.symbol.padEnd(10)} ${display.padStart(10)}  ${r.name?.slice(0,40) ?? ''}`)
  }
  console.log(`  → ${nullsOnPage}/30 rows on first page have NULL market_cap`)

  // 3. Sample of null-cap tickers — are they all warrants/preferreds or normal stocks?
  console.log(`\n=== Sample of null market_cap tickers (first 40) ===`)
  const { data: nullTickers } = await sb
    .from('tickers')
    .select('symbol, name, sector')
    .is('market_cap', null)
    .order('symbol')
    .limit(40)

  for (const r of (nullTickers ?? []) as any[])
    console.log(`  ${r.symbol.padEnd(10)} ${(r.sector ?? '').padEnd(26)} ${r.name?.slice(0,40) ?? ''}`)

  // 4. Are nulls sorting first or last on DESC?
  console.log(`\n=== Postgres NULL sort behavior (DESC) ===`)
  const { data: nullCheck } = await sb
    .from('tickers')
    .select('symbol, market_cap')
    .order('market_cap', { ascending: false })
    .limit(3)
  console.log('  First 3 rows DESC:', (nullCheck as any[]).map(r => `${r.symbol}:${r.market_cap}`).join(', '))

  const { data: nullCheckAsc } = await sb
    .from('tickers')
    .select('symbol, market_cap')
    .order('market_cap', { ascending: false, nullsFirst: false })
    .limit(3)
  console.log('  First 3 rows DESC nullsFirst=false:', (nullCheckAsc as any[]).map(r => `${r.symbol}:${r.market_cap}`).join(', '))
}
main().catch(e => { console.error(e); process.exit(1) })
