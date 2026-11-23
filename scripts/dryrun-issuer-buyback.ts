// npx tsx scripts/dryrun-issuer-buyback.ts
//
// DRY RUN — shows every distinct entity the backfill rule would flag,
// grouped by insider_name, with ticker, tx count, and total $.
// Does NOT write anything to the database.
//
// Use this to verify the rule before running backfill-issuer-buyback.ts.

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

// ── Name normalization ────────────────────────────────────────────────────────

const ENTITY_TOKENS = new Set([
  'inc', 'corp', 'llc', 'ltd', 'lp', 'plc', 'sa', 'nv', 'bv', 'ag',
  'co', 'company', 'companies', 'holdings', 'holding', 'group', 'groups',
  'trust', 'fund', 'funds', 'limited', 'incorporated', 'corporation',
  'partners', 'partnership', 'ventures', 'venture',
])

function normalize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !ENTITY_TOKENS.has(w))
}

function namesMatch(a: string, b: string): boolean {
  const wa = normalize(a)
  const wb = normalize(b)
  if (wa.length === 0 || wb.length === 0) return false
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  const longerSet = new Set(longer)
  const matchCount = shorter.filter(w => longerSet.has(w)).length
  return matchCount === shorter.length && shorter.length >= 1
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Step 1: paginate the full tickers table to get all company names ──────────
  // PostgREST default row limit is 1000; the tickers table has ~1552+ rows.
  // Paginate so we don't silently truncate and miss EQH, ARES, H, UBER, TEM etc.
  console.log('Fetching all company names from tickers table (paginated)…')
  const nameMap = new Map<string, string>()
  {
    const PG = 1000
    let off = 0
    while (true) {
      const { data, error } = await supabase
        .from('tickers')
        .select('symbol, name')
        .range(off, off + PG - 1)
        .order('symbol')
      if (error) { console.error(error.message); process.exit(1) }
      if (!data || data.length === 0) break
      for (const r of data) {
        if ((r as any).name) nameMap.set((r as any).symbol, (r as any).name)
      }
      off += data.length
      if (data.length < PG) break
    }
  }
  console.log(`  ${nameMap.size} tickers with company names.`)

  // Only scan tickers that have a usable (non-entity-only) company name
  const candidateTickers = [...nameMap.keys()].filter(sym => normalize(nameMap.get(sym)!).length > 0)
  console.log(`Scanning ${candidateTickers.length} tickers for name matches…`)

  type Hit = {
    insider_name: string
    ticker: string
    company_name: string
    normalized_insider: string
    normalized_company: string
    tx_count: number
    total_value: number
    buy_count: number
  }
  const hitMap = new Map<string, Hit>()

  // Fetch one ticker at a time, paginated, to avoid PostgREST's 1000-row default
  // cap silently truncating active tickers (e.g. UBER has >1000 transactions).
  const PG2 = 1000
  let scanned = 0
  for (const sym of candidateTickers) {
    const companyName = nameMap.get(sym)!
    let off2 = 0
    while (true) {
      const { data, error } = await supabase
        .from('insider_transactions')
        .select('ticker, insider_name, transaction_direction, total_value')
        .eq('ticker', sym)
        .range(off2, off2 + PG2 - 1)
        .order('id')
      if (error) { console.error(`${sym}: ${error.message}`); process.exit(1) }
      if (!data || data.length === 0) break

      for (const tx of data) {
        const t = tx as { ticker: string; insider_name: string; transaction_direction: string | null; total_value: number | null }
        if (!t.insider_name) continue
        if (!namesMatch(t.insider_name, companyName)) continue

        const key = `${t.ticker}||${t.insider_name}`
        if (!hitMap.has(key)) {
          hitMap.set(key, {
            insider_name:       t.insider_name,
            ticker:             t.ticker,
            company_name:       companyName,
            normalized_insider: normalize(t.insider_name).join(' '),
            normalized_company: normalize(companyName).join(' '),
            tx_count:           0,
            total_value:        0,
            buy_count:          0,
          })
        }
        const h = hitMap.get(key)!
        h.tx_count++
        h.total_value += t.total_value ?? 0
        if (t.transaction_direction === 'buy') h.buy_count++
      }

      off2 += data.length
      if (data.length < PG2) break
    }

    scanned++
    if (scanned % 100 === 0) process.stdout.write(`\r  ${scanned} / ${candidateTickers.length} tickers…`)
  }
  console.log(`\n  Done. ${hitMap.size} distinct (ticker, insider_name) pairs matched.`)

  // Group by insider_name (across all tickers they appear on)
  type EntityRow = {
    insider_name: string
    tickers: string[]
    company_names: string[]
    normalized_insider: string
    normalized_company: string
    tx_count: number
    total_value: number
    buy_count: number
  }
  const entityMap = new Map<string, EntityRow>()
  for (const h of hitMap.values()) {
    if (!entityMap.has(h.insider_name)) {
      entityMap.set(h.insider_name, {
        insider_name:       h.insider_name,
        tickers:            [],
        company_names:      [],
        normalized_insider: h.normalized_insider,
        normalized_company: h.normalized_company,
        tx_count:           0,
        total_value:        0,
        buy_count:          0,
      })
    }
    const e = entityMap.get(h.insider_name)!
    e.tickers.push(h.ticker)
    e.company_names.push(h.company_name)
    e.tx_count    += h.tx_count
    e.total_value += h.total_value
    e.buy_count   += h.buy_count
  }

  const sorted = [...entityMap.values()].sort((a, b) => b.tx_count - a.tx_count)
  const totalTx = sorted.reduce((s, e) => s + e.tx_count, 0)

  const fmt$ = (v: number) =>
    v >= 1e9  ? `$${(v/1e9).toFixed(1)}B`  :
    v >= 1e6  ? `$${(v/1e6).toFixed(1)}M`  :
    v >= 1e3  ? `$${(v/1e3).toFixed(0)}K`  : `$${v.toFixed(0)}`

  console.log(`\n${'█'.repeat(110)}`)
  console.log(`  DRY RUN — ${sorted.length} distinct entities would be flagged (${totalTx.toLocaleString()} transactions total)`)
  console.log(`${'█'.repeat(110)}\n`)

  // Header
  const COL = {
    name:   42,
    ticker: 10,
    co:     32,
    norm_i: 28,
    norm_c: 28,
    txc:     5,
    buyc:    5,
    tv:     10,
  }
  const hdr =
    'Insider name'.padEnd(COL.name) +
    'Ticker'.padEnd(COL.ticker) +
    'Company name'.padEnd(COL.co) +
    'norm(insider)'.padEnd(COL.norm_i) +
    'norm(company)'.padEnd(COL.norm_c) +
    '#tx'.padStart(COL.txc) +
    '#buy'.padStart(COL.buyc) +
    'Total $'.padStart(COL.tv)
  console.log('  ' + hdr)
  console.log('  ' + '─'.repeat(hdr.length))

  for (const e of sorted) {
    // If entity appears on multiple tickers, show one row per ticker
    for (let i = 0; i < e.tickers.length; i++) {
      const name    = i === 0 ? e.insider_name : ''
      const ticker  = e.tickers[i]
      const co      = e.company_names[i] ?? ''
      // tx/buy/total are totals only on the first row; sub-rows show company details
      const txc     = i === 0 ? String(e.tx_count)   : ''
      const buyc    = i === 0 ? String(e.buy_count)   : ''
      const tv      = i === 0 ? fmt$(e.total_value) : ''
      const ni      = i === 0 ? e.normalized_insider : ''
      const nc      = i === 0 ? e.normalized_company  : ''

      console.log(
        '  ' +
        name.slice(0, COL.name).padEnd(COL.name) +
        ticker.padEnd(COL.ticker) +
        co.slice(0, COL.co).padEnd(COL.co) +
        ni.slice(0, COL.norm_i).padEnd(COL.norm_i) +
        nc.slice(0, COL.norm_c).padEnd(COL.norm_c) +
        txc.padStart(COL.txc) +
        buyc.padStart(COL.buyc) +
        tv.padStart(COL.tv)
      )
    }
    if (e.tickers.length > 1) console.log('')  // blank line between multi-ticker entities
  }

  console.log(`\n${'─'.repeat(110)}`)
  console.log(`  Total: ${sorted.length} entities, ${totalTx.toLocaleString()} transactions (${sorted.reduce((s,e)=>s+e.buy_count,0).toLocaleString()} buys)`)
  console.log()

  // ── Spot-check known 10% owners should NOT be in the list ─────────────────
  const known10pct = ['BERKSHIRE HATHAWAY', 'RA CAPITAL', 'VALUEACT', 'BAKER BROS', 'BROADWOOD', 'CASCADE INVESTMENT', 'SILVER LAKE', 'ARKOMA', 'MUDRICK']
  const falsePositives = sorted.filter(e =>
    known10pct.some(k => e.insider_name.toUpperCase().includes(k))
  )
  if (falsePositives.length > 0) {
    console.log('  ⚠️  RULE TOO BROAD — known 10% owners in the match list:')
    for (const fp of falsePositives) {
      console.log(`     → ${fp.insider_name}  (${fp.tickers.join(',')}) — ${fp.tx_count} tx`)
    }
  } else {
    console.log('  ✓  None of the known institutional 10% owners (Berkshire, RA Capital, ValueAct,')
    console.log('     Baker Bros, Broadwood, Cascade, Silver Lake, Arkoma, Mudrick) are in the match list.')
  }
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
