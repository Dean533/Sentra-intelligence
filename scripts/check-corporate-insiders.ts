// npx tsx scripts/check-corporate-insiders.ts
//
// Finds insider_transactions where the insider_name looks like a corporate entity
// (e.g. "Equitable Holdings, Inc.") rather than an individual person.
// These are likely share buybacks or institutional transactions mis-tagged as insider buys.
// Reports count + examples only — does NOT modify any data.

import * as path from 'path'
import * as fs   from 'fs'
import { createClient } from '@supabase/supabase-js'

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

// ── Corporate entity detection ────────────────────────────────────────────────
//
// An insider name is "corporate" if it matches any of:
//   1. Ends with a legal entity suffix (Inc., Corp., LLC, Ltd., LP, L.P., etc.)
//   2. Contains ", Inc" or ", Corp" or ", LLC" mid-string (e.g. "Foo Holdings, Inc.")
//   3. Common fund/trust/entity keywords: Trust, Fund, Holdings, Partners, Group, Capital
//      (but only if no comma-first-name pattern, e.g. "Smith, John" is a person)
//   4. Name matches the ticker's own company name (issuer-is-insider)

const ENTITY_SUFFIX_RE = /\b(inc\.?|corp\.?|llc\.?|ltd\.?|l\.l\.c\.?|l\.p\.?|lp|plc\.?|s\.a\.?|n\.v\.?|b\.v\.?|a\.g\.?)\s*$/i
const ENTITY_KEYWORD_RE = /\b(trust|fund|holdings|partners|group|capital|ventures|equity|management|advisors|associates|investments|financial|securities|asset)\b/i

function looksLikeCorporate(name: string): boolean {
  const n = name.trim()
  if (!n) return false

  // "SMITH, JOHN" pattern → human (Last, First)
  const commaIdx = n.indexOf(',')
  if (commaIdx > 0 && commaIdx < n.length - 1) {
    const afterComma = n.slice(commaIdx + 1).trim()
    // If what follows the comma is a short word (first name), it's a person
    if (/^[A-Za-z]{1,20}(\s[A-Za-z\.]{1,20})?$/.test(afterComma)) {
      return false  // person
    }
  }

  if (ENTITY_SUFFIX_RE.test(n)) return true
  if (ENTITY_KEYWORD_RE.test(n)) return true

  return false
}

// Strip common suffixes and punctuation for name matching
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/,?\s*(inc\.?|corp\.?|llc\.?|ltd\.?|l\.l\.c\.?|l\.p\.?|lp|plc\.?|holdings?|group|company|co\.?)$/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameMatchesTicker(insiderName: string, companyName: string): boolean {
  const a = normalizeName(insiderName)
  const b = normalizeName(companyName)
  if (!a || !b) return false
  // Check if either contains the other (handles abbreviations)
  return a === b || a.includes(b) || b.includes(a)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching all P-purchase buys from insider_transactions…')

  // Fetch in pages — we only need insider_name, ticker, total_value, transaction_date, role
  const PAGE = 1000
  let offset = 0
  type TxRow = { ticker: string; insider_name: string; total_value: number | null; transaction_date: string; role: string | null; transaction_code: string }
  const rows: TxRow[] = []
  while (true) {
    const { data, error } = await supabase
      .from('insider_transactions')
      .select('ticker, insider_name, total_value, transaction_date, role, transaction_code')
      .eq('transaction_direction', 'buy')
      .range(offset, offset + PAGE - 1)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data || data.length === 0) break
    rows.push(...(data as TxRow[]))
    offset += data.length
    if (data.length < PAGE) break
  }
  console.log(`Loaded ${rows.length.toLocaleString()} buy transactions total.`)

  // ── Pass 1: keyword / suffix match ───────────────────────────────────────────
  const keywordHits = rows.filter(r => looksLikeCorporate(r.insider_name ?? ''))

  // ── Pass 2: issuer name match ─────────────────────────────────────────────────
  // Fetch company names for all distinct tickers
  const tickers = [...new Set(rows.map(r => r.ticker))]
  const nameMap = new Map<string, string>()  // symbol → company name
  for (let i = 0; i < tickers.length; i += 500) {
    const { data } = await supabase
      .from('tickers')
      .select('symbol, name')
      .in('symbol', tickers.slice(i, i + 500))
    for (const r of data ?? []) nameMap.set((r as any).symbol, (r as any).name ?? '')
  }
  console.log(`Fetched company names for ${nameMap.size} tickers.`)

  const issuerHits = rows.filter(r => {
    const companyName = nameMap.get(r.ticker) ?? ''
    return companyName && nameMatchesTicker(r.insider_name ?? '', companyName)
  })

  // ── Union of both sets ────────────────────────────────────────────────────────
  const allHitKeys = new Set([
    ...keywordHits.map((_, i) => rows.indexOf(keywordHits[i])),
    ...issuerHits.map((_, i) => rows.indexOf(issuerHits[i])),
  ])

  // To get a unique set by insider_name
  const byName = new Map<string, { count: number; tickers: Set<string>; latest: string; totalValue: number; example: TxRow }>()
  for (const r of keywordHits) {
    const k = (r.insider_name ?? '').trim()
    if (!byName.has(k)) byName.set(k, { count: 0, tickers: new Set(), latest: '', totalValue: 0, example: r })
    const e = byName.get(k)!
    e.count++
    e.tickers.add(r.ticker)
    e.totalValue += r.total_value ?? 0
    if (r.transaction_date > e.latest) e.latest = r.transaction_date
  }

  const byNameIssuer = new Map<string, { count: number; tickers: Set<string>; latest: string; totalValue: number; example: TxRow; companyName: string }>()
  for (const r of issuerHits) {
    const k = (r.insider_name ?? '').trim()
    if (!byNameIssuer.has(k)) byNameIssuer.set(k, { count: 0, tickers: new Set(), latest: '', totalValue: 0, example: r, companyName: nameMap.get(r.ticker) ?? '' })
    const e = byNameIssuer.get(k)!
    e.count++
    e.tickers.add(r.ticker)
    e.totalValue += r.total_value ?? 0
    if (r.transaction_date > e.latest) e.latest = r.transaction_date
  }

  const LINE = '─'.repeat(80)
  const fmt$ = (v: number) => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(0)}K` : `$${v.toFixed(0)}`

  // ── Report ────────────────────────────────────────────────────────────────────
  console.log('\n' + '█'.repeat(80))
  console.log('  PASS 1 — Names matching corporate entity keywords / suffixes')
  console.log('  (Inc., Corp., LLC, Holdings, Fund, Trust, Group, Capital, etc.)')
  console.log('█'.repeat(80))
  console.log(`\n  Total transactions: ${keywordHits.length.toLocaleString()}`)
  console.log(`  Distinct entity names: ${byName.size}`)

  const sorted = [...byName.entries()].sort((a, b) => b[1].count - a[1].count)
  console.log(`\n  Top 25 by transaction count:\n`)
  console.log(`  ${'Entity name'.padEnd(42)} ${'#tx'.padStart(5)} ${'Total $'.padStart(10)}  Tickers`)
  console.log(`  ${LINE}`)
  for (const [name, e] of sorted.slice(0, 25)) {
    const tkList = [...e.tickers].slice(0, 4).join(',') + (e.tickers.size > 4 ? `…+${e.tickers.size-4}` : '')
    console.log(`  ${name.slice(0,42).padEnd(42)} ${String(e.count).padStart(5)} ${fmt$(e.totalValue).padStart(10)}  ${tkList}`)
  }

  console.log('\n\n' + '█'.repeat(80))
  console.log('  PASS 2 — Insider name matches the issuer\'s own company name')
  console.log('  (company buying its own shares = buyback, not individual insider)')
  console.log('█'.repeat(80))
  console.log(`\n  Total transactions: ${issuerHits.length.toLocaleString()}`)
  console.log(`  Distinct entity names: ${byNameIssuer.size}`)

  const sortedIssuer = [...byNameIssuer.entries()].sort((a, b) => b[1].count - a[1].count)
  console.log(`\n  Top 25 by transaction count:\n`)
  console.log(`  ${'Insider name'.padEnd(35)} ${'Company name'.padEnd(25)} ${'#tx'.padStart(5)} ${'Total $'.padStart(10)}`)
  console.log(`  ${LINE}`)
  for (const [name, e] of sortedIssuer.slice(0, 25)) {
    console.log(`  ${name.slice(0,35).padEnd(35)} ${e.companyName.slice(0,25).padEnd(25)} ${String(e.count).padStart(5)} ${fmt$(e.totalValue).padStart(10)}`)
  }

  console.log('\n\n' + '█'.repeat(80))
  console.log('  SUMMARY')
  console.log('█'.repeat(80))
  const totalBuys = rows.length
  const p1Tx = keywordHits.length
  const p2Tx = issuerHits.length
  // Union (deduplicated)
  const unionSet = new Set([...keywordHits, ...issuerHits].map(r => `${r.ticker}|${r.insider_name}|${r.transaction_date}`))
  console.log(`
  Total buy transactions checked:      ${totalBuys.toLocaleString()}
  Pass 1 hits (entity keywords):       ${p1Tx.toLocaleString()} (${(100*p1Tx/totalBuys).toFixed(2)}%)
  Pass 2 hits (issuer name match):     ${p2Tx.toLocaleString()} (${(100*p2Tx/totalBuys).toFixed(2)}%)
  Union (either flag):                 ${unionSet.size.toLocaleString()} (${(100*unionSet.size/totalBuys).toFixed(2)}%)
  `)
}

main().catch(e => { console.error(e); process.exit(1) })
