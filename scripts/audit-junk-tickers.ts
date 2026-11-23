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
  // Load all tickers (paginated)
  const PAGE = 1000
  let offset = 0
  const all: { symbol: string; name: string; sector: string | null; market_cap: number | null }[] = []
  while (true) {
    const { data, error } = await sb
      .from('tickers')
      .select('symbol, name, sector, market_cap')
      .range(offset, offset + PAGE - 1)
      .order('symbol')
    if (error) { console.error(error.message); process.exit(1) }
    if (!data || data.length === 0) break
    all.push(...data as any[])
    offset += data.length
    if (data.length < PAGE) break
  }
  console.log(`Total tickers: ${all.length}`)

  // Pattern matchers
  const warrants   = all.filter(r => /-WT[A-Z]?$/.test(r.symbol))
  const preferreds = all.filter(r => /-P[A-Z]$/.test(r.symbol))
  const bankrupt   = all.filter(r => /Q$/.test(r.symbol))  // OTC/bankruptcy Q suffix
  // Rights
  const rights     = all.filter(r => /-RT$|-R$/.test(r.symbol))
  // Units
  const units      = all.filter(r => /-U$|-UN$/.test(r.symbol))

  function printGroup(label: string, rows: typeof all) {
    console.log(`\n=== ${label} (${rows.length}) ===`)
    for (const r of rows.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
      const cap = r.market_cap == null ? 'null' :
        r.market_cap >= 1e9 ? `$${(r.market_cap/1e9).toFixed(1)}B` :
        `$${(r.market_cap/1e6).toFixed(1)}M`
      console.log(`  ${r.symbol.padEnd(12)} ${cap.padStart(10)}  ${r.name?.slice(0, 45) ?? ''}`)
    }
  }

  printGroup('Warrants (-WT, -WTA, etc.)', warrants)
  printGroup('Preferreds (-PA, -PB, -PC, etc.)', preferreds)
  printGroup('Bankrupt/OTC Q-suffix', bankrupt)
  printGroup('Rights (-RT, -R)', rights)
  printGroup('Units (-U, -UN)', units)

  // Combined unique set
  const junkSymbols = new Set([
    ...warrants, ...preferreds, ...bankrupt, ...rights, ...units
  ].map(r => r.symbol))
  console.log(`\n=== TOTAL DISTINCT "junk" by these patterns: ${junkSymbols.size} / ${all.length} ===`)
  console.log(`  Warrants:  ${warrants.length}`)
  console.log(`  Preferreds:${preferreds.length}`)
  console.log(`  Bankrupt Q:${bankrupt.length}`)
  console.log(`  Rights:    ${rights.length}`)
  console.log(`  Units:     ${units.length}`)
}
main().catch(e => { console.error(e); process.exit(1) })
