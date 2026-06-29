// npx tsx scripts/normalize-sectors.ts
//
// Remaps non-GICS sector values in the tickers table to their canonical GICS names.
// Shows before/after counts for every affected value so you can confirm the merge.
// Safe to re-run: after the first pass all values are already canonical so no rows change.

import * as path from 'path'
import * as fs   from 'fs'
import { createClient } from '@supabase/supabase-js'
import { GICS_SECTOR_MAP } from '../lib/gicsSector'

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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!,
)

async function getSectorCounts(): Promise<Record<string, number>> {
  const PAGE = 1000
  let offset = 0
  const counts: Record<string, number> = {}
  while (true) {
    const { data, error } = await supabase
      .from('tickers')
      .select('sector')
      .range(offset, offset + PAGE - 1)
      .order('symbol')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const r of data as any[]) {
      const s = r.sector ?? '(null)'
      counts[s] = (counts[s] ?? 0) + 1
    }
    offset += data.length
    if (data.length < PAGE) break
  }
  return counts
}

function printCounts(label: string, counts: Record<string, number>) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  const total  = sorted.reduce((s, [, c]) => s + c, 0)
  console.log(`\n${label}`)
  console.log('  ' + '─'.repeat(42))
  for (const [s, c] of sorted) console.log(`  ${String(c).padStart(5)}  ${s}`)
  console.log('  ' + '─'.repeat(42))
  console.log(`  ${String(total).padStart(5)}  TOTAL  (${sorted.length} distinct values)`)
}

async function main() {
  // ── Identify the 'Other' ticker ───────────────────────────────────────────
  const { data: otherRows } = await supabase
    .from('tickers')
    .select('symbol, name, sector')
    .eq('sector', 'Other')
  console.log('\n=== Ticker(s) with sector = "Other" ===')
  if (!otherRows || otherRows.length === 0) {
    console.log('  (none found)')
  } else {
    for (const r of otherRows as any[]) {
      console.log(`  ${r.symbol}  "${r.name}"  → sector: "${r.sector}"`)
    }
    console.log('\n  (not remapped — decide manually what GICS sector this belongs to)')
  }

  // ── Before counts ─────────────────────────────────────────────────────────
  console.log('\n=== Fetching BEFORE counts… ===')
  const before = await getSectorCounts()
  printCounts('BEFORE', before)

  // ── Remap non-GICS values ─────────────────────────────────────────────────
  // Only update rows where the current value differs from its GICS canonical.
  const remaps: Array<{ from: string; to: string }> = []
  for (const [raw, canonical] of Object.entries(GICS_SECTOR_MAP)) {
    if (raw !== canonical) remaps.push({ from: raw, to: canonical })
  }

  console.log('\n=== Applying remaps ===')
  for (const { from, to } of remaps) {
    const count = before[from] ?? 0
    if (count === 0) {
      console.log(`  skip  "${from}" → "${to}"  (0 rows)`)
      continue
    }

    const { error } = await supabase
      .from('tickers')
      .update({ sector: to })
      .eq('sector', from)

    if (error) {
      console.error(`  ERROR updating "${from}": ${error.message}`)
      process.exit(1)
    }
    console.log(`  OK    "${from}" → "${to}"  (${count} rows updated)`)
  }

  // ── After counts ──────────────────────────────────────────────────────────
  console.log('\n=== Fetching AFTER counts… ===')
  const after = await getSectorCounts()
  printCounts('AFTER', after)

  // ── Diff summary ──────────────────────────────────────────────────────────
  console.log('\n=== Net change per canonical sector ===')
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of [...allKeys].sort()) {
    const b = before[k] ?? 0
    const a = after[k]  ?? 0
    if (b !== a) {
      const diff = a - b
      console.log(`  ${k.padEnd(26)} ${String(b).padStart(4)} → ${String(a).padStart(4)}  (${diff > 0 ? '+' : ''}${diff})`)
    }
  }
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
