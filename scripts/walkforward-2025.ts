// Run with:  npx tsx scripts/walkforward-2025.ts
//
// Clean walk-forward test with no lookahead bias:
//   Classification window : 2022 / 2023 / 2024  (3 full years, lookback only)
//   Evaluation window     : 2025-01-01 → last trade with complete 180d window
//
// Per-insider (CIK) CMP classification using ONLY pre-2025 trading history.
// Forward returns come from the existing backtest-universe.csv which already
// has return_180d and alpha_180d computed.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const BACKTEST_CSV   = path.join(__dirname, '..', 'output', 'backtest-universe.csv')
const EVAL_START     = '2025-01-01'
const LOOKBACK_YEARS = [2024, 2023, 2022]   // 3 full years before 2025
const FETCH_CHUNK    = 1000

// ─── CMP classification (lookback fixed at 2024/2023/2022) ───────────────────

function classifyInsider(trades: { transaction_date: string }[]): 'ROUTINE' | 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' {
  const monthsByYear = new Map<number, Set<number>>()
  for (const t of trades) {
    const d = new Date(t.transaction_date)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set())
    monthsByYear.get(y)!.add(m)
  }

  const coveredYears = LOOKBACK_YEARS.filter(y => (monthsByYear.get(y)?.size ?? 0) > 0)
  if (coveredYears.length < 3) return 'UNCLASSIFIABLE'

  const [y1, y2, y3] = LOOKBACK_YEARS
  for (let m = 1; m <= 12; m++) {
    if (monthsByYear.get(y1)!.has(m) && monthsByYear.get(y2)!.has(m) && monthsByYear.get(y3)!.has(m)) {
      return 'ROUTINE'
    }
  }
  return 'OPPORTUNISTIC'
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []; let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
    else cur += ch
  }
  fields.push(cur.trim()); return fields
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function fmt(n: number | null, dp = 1): string {
  if (n == null) return '  N/A'
  return (n >= 0 ? '+' : '') + n.toFixed(dp) + '%'
}

// ─── PIT market cap tier ──────────────────────────────────────────────────────

function mcTier(mc: number | null): string {
  if (mc == null)    return 'No data'
  if (mc < 300e6)    return 'Micro  <$300M'
  if (mc < 2e9)      return 'Small  $300M–2B'
  if (mc < 10e9)     return 'Mid    $2–10B'
  if (mc < 200e9)    return 'Large  $10–200B'
  return               'Mega   >$200B'
}

const TIER_ORDER = ['Micro  <$300M','Small  $300M–2B','Mid    $2–10B','Large  $10–200B','Mega   >$200B','No data']

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Read backtest CSV, filter to 2025+ buys with complete 180d return ────
  console.log(`Reading ${BACKTEST_CSV}...`)
  const lines = fs.readFileSync(BACKTEST_CSV, 'utf-8').split('\n').filter(Boolean)
  const h  = parseCsvLine(lines[0])
  const gi = (n: string) => h.indexOf(n)

  const iDate   = gi('transaction_date'), iDir = gi('direction')
  const iCik    = gi('insider_cik'),      iTkr = gi('ticker')
  const iPe     = gi('price_entry')
  const iR180   = gi('return_180d'),      iA180 = gi('alpha_180d')
  const iSpy180 = gi('spy_return_180d')

  type FwdRow = {
    insider_cik: string; ticker: string; transaction_date: string
    price_entry: number | null
    return_180d: number | null; alpha_180d: number | null; spy_return_180d: number | null
  }

  const allFwd: FwdRow[] = []
  let totalBuys2025 = 0

  for (const l of lines.slice(1)) {
    const f = parseCsvLine(l)
    if (f[iDate] < EVAL_START) continue
    if (f[iDir]  !== 'buy')    continue
    totalBuys2025++
    const r180 = f[iR180] !== '' ? parseFloat(f[iR180]) : null
    if (r180 == null || isNaN(r180)) continue   // skip incomplete forward window
    allFwd.push({
      insider_cik:    f[iCik],
      ticker:         f[iTkr],
      transaction_date: f[iDate],
      price_entry:    f[iPe]   !== '' ? parseFloat(f[iPe])   : null,
      return_180d:    r180,
      alpha_180d:     f[iA180]  !== '' ? parseFloat(f[iA180])  : null,
      spy_return_180d: f[iSpy180] !== '' ? parseFloat(f[iSpy180]) : null,
    })
  }
  console.log(`2025+ buy trades in CSV : ${totalBuys2025}`)
  console.log(`  with complete 180d     : ${allFwd.length}`)

  // ── 2. Collect unique CIKs from 2025+ trades ──────────────────────────────
  const cikSet = new Set(allFwd.map(r => r.insider_cik).filter(Boolean))
  const cikList = [...cikSet]
  console.log(`Unique insiders in 2025+ buy trades: ${cikList.length}`)

  // ── 3. Full keyset scan — no filters, group client-side ──────────────────
  // Filtered queries (.in() + date range) hit Supabase's statement timeout.
  // One clean keyset scan by PK is consistently fast regardless of table size.
  console.log(`\nFull table keyset scan to build 2022–2024 history...`)

  const historyMap = new Map<string, { transaction_date: string }[]>()
  let lastId: string | null = null
  let totalScanned = 0, historyRows = 0

  while (true) {
    let q = supabase
      .from('insider_transactions')
      .select('id, insider_cik, transaction_date')
      .not('insider_cik', 'is', null)
      .order('id', { ascending: true })
      .limit(FETCH_CHUNK)
    if (lastId !== null) q = q.gt('id', lastId)

    const { data: chunk, error } = await q
    if (error) { console.error(`Scan error: ${error.message}`); process.exit(1) }
    if (!chunk || chunk.length === 0) break

    for (const r of chunk as any[]) {
      if (!r.insider_cik) continue
      // Only keep 2022–2024 rows for CIKs we actually need
      if (r.transaction_date < '2022-01-01' || r.transaction_date > '2024-12-31') continue
      if (!cikSet.has(r.insider_cik)) continue
      if (!historyMap.has(r.insider_cik)) historyMap.set(r.insider_cik, [])
      historyMap.get(r.insider_cik)!.push({ transaction_date: r.transaction_date })
      historyRows++
    }

    lastId       = (chunk[chunk.length - 1] as any).id as string
    totalScanned += chunk.length
    if (totalScanned % 50000 === 0)
      process.stdout.write(`  scanned ${totalScanned.toLocaleString()} rows, ${historyRows} history rows kept...\n`)
    if (chunk.length < FETCH_CHUNK) break
  }
  console.log(`Scan complete: ${totalScanned.toLocaleString()} rows scanned, ${historyRows} 2022–2024 rows kept for ${historyMap.size} insiders`)

  // ── 4. Classify each insider using 2022/2023/2024 lookback ────────────────
  const classMap = new Map<string, 'ROUTINE' | 'OPPORTUNISTIC' | 'UNCLASSIFIABLE'>()
  let nR = 0, nO = 0, nU = 0, nNoHistory = 0

  for (const cik of cikList) {
    const trades = historyMap.get(cik)
    if (!trades || trades.length === 0) { classMap.set(cik, 'UNCLASSIFIABLE'); nNoHistory++; nU++; continue }
    const cls = classifyInsider(trades)
    classMap.set(cik, cls)
    if (cls === 'ROUTINE')       nR++
    else if (cls === 'OPPORTUNISTIC') nO++
    else                         nU++
  }

  console.log(`\nWalk-forward classification (lookback 2022/2023/2024):`)
  console.log(`  Routine        : ${nR}`)
  console.log(`  Opportunistic  : ${nO}`)
  console.log(`  Unclassifiable : ${nU}  (incl. ${nNoHistory} with no 2022-2024 history)`)

  // ── 5. Join classification to 2025+ trades ────────────────────────────────
  const oppBuys = allFwd.filter(r => classMap.get(r.insider_cik) === 'OPPORTUNISTIC')
  const routBuys = allFwd.filter(r => classMap.get(r.insider_cik) === 'ROUTINE')
  const unclBuys = allFwd.filter(r => classMap.get(r.insider_cik) === 'UNCLASSIFIABLE')

  console.log(`\n2025+ buy trades by walk-forward classification:`)
  console.log(`  Opportunistic  : ${oppBuys.length}`)
  console.log(`  Routine        : ${routBuys.length}`)
  console.log(`  Unclassifiable : ${unclBuys.length}`)

  // ── 6. Fetch market caps + compute PIT tiers ──────────────────────────────
  const allTickers = [...new Set(oppBuys.map(r => r.ticker))]
  const mcMap = new Map<string, number>()
  for (let i = 0; i < allTickers.length; i += 500) {
    const { data } = await supabase.from('tickers')
      .select('symbol, market_cap').in('symbol', allTickers.slice(i, i + 500))
    for (const r of data ?? []) if ((r as any).market_cap) mcMap.set((r as any).symbol, (r as any).market_cap)
  }

  // Latest price_entry per ticker as proxy for current price
  const latestPrice = new Map<string, number>()
  for (const r of oppBuys) {
    if (r.price_entry != null) {
      const cur = latestPrice.get(r.ticker)
      if (!cur || r.price_entry > cur) latestPrice.set(r.ticker, r.price_entry)
    }
  }

  type TierBucket = { count: number; ret: number[]; alpha: number[]; spy: number[] }
  const buckets: Record<string, TierBucket> = {}
  for (const t of TIER_ORDER) buckets[t] = { count: 0, ret: [], alpha: [], spy: [] }

  for (const r of oppBuys) {
    const mc_today = mcMap.get(r.ticker) ?? null
    const p_today  = latestPrice.get(r.ticker) ?? null
    let mc_pit: number | null = null
    if (mc_today != null && p_today != null && p_today > 0 && r.price_entry != null && r.price_entry > 0) {
      mc_pit = (mc_today / p_today) * r.price_entry
    }
    const tier = mcTier(mc_pit)
    const b = buckets[tier]
    b.count++
    if (r.return_180d != null) b.ret.push(r.return_180d)
    if (r.alpha_180d  != null) b.alpha.push(r.alpha_180d)
    if (r.spy_return_180d != null) b.spy.push(r.spy_return_180d)
  }

  // ── 7. Print results ──────────────────────────────────────────────────────
  const SEP = '─'.repeat(76)

  console.log(`\n${'═'.repeat(76)}`)
  console.log(`  WALK-FORWARD TEST  ·  Classification: 2022/2023/2024  ·  Eval: 2025+`)
  console.log(`  No lookahead bias — all classification data predates all eval trades`)
  console.log(`${'═'.repeat(76)}`)

  // Overall opp buy vs SPY
  const allRet   = oppBuys.map(r => r.return_180d).filter((v): v is number => v != null)
  const allAlpha = oppBuys.map(r => r.alpha_180d).filter((v): v is number => v != null)
  const allSpy   = oppBuys.map(r => r.spy_return_180d).filter((v): v is number => v != null)
  const wins     = allRet.filter(r => r > 0).length

  console.log(`\n── OVERALL: Opportunistic Buys (2025+, complete 180d window)`)
  console.log(SEP)
  console.log(`  Trades             : ${oppBuys.length}`)
  console.log(`  Win rate           : ${allRet.length ? (wins/allRet.length*100).toFixed(1) : 'N/A'}%`)
  console.log(`  Median return 180d : ${fmt(median(allRet))}`)
  console.log(`  Mean return 180d   : ${fmt(mean(allRet))}`)
  console.log(`  Median SPY 180d    : ${fmt(median(allSpy))}`)
  console.log(`  Median alpha 180d  : ${fmt(median(allAlpha))}`)
  console.log(`  Mean alpha 180d    : ${fmt(mean(allAlpha))}`)

  // Vs routine
  const routRet = routBuys.map(r => r.return_180d).filter((v): v is number => v != null)
  const routAlp = routBuys.map(r => r.alpha_180d).filter((v): v is number => v != null)
  console.log(`\n── ROUTINE Buys (2025+) — for comparison`)
  console.log(`  Trades : ${routBuys.length}  | Win rate: ${routRet.length ? (routRet.filter(r=>r>0).length/routRet.length*100).toFixed(1) : 'N/A'}%`)
  console.log(`  Median return 180d : ${fmt(median(routRet))}  | Median alpha 180d : ${fmt(median(routAlp))}`)

  // PIT market cap tier table
  console.log(`\n── PIT MARKET CAP TIERS: Opportunistic Buys (2025+)`)
  console.log(SEP)
  console.log(
    '  Tier              ' +
    'Count'.padStart(6)   + '  ' +
    'Win%'.padStart(6)    + '  ' +
    'Med Ret 180d'.padStart(13) + '  ' +
    'Med Alpha 180d'.padStart(15) + '  ' +
    'Med SPY 180d'.padStart(13)
  )
  console.log('  ' + SEP)

  for (const tier of TIER_ORDER) {
    const b = buckets[tier]
    if (!b.count) continue
    const wr   = b.ret.length ? (b.ret.filter(r=>r>0).length / b.ret.length * 100).toFixed(1)+'%' : 'N/A'
    const flag = b.count < 30 ? ' ⚠ <30' : ''
    console.log(
      '  ' + tier.padEnd(18) +
      String(b.count).padStart(6) + '  ' +
      wr.padStart(6) + '  ' +
      fmt(median(b.ret)).padStart(13) + '  ' +
      fmt(median(b.alpha)).padStart(15) + '  ' +
      fmt(median(b.spy)).padStart(13) +
      flag
    )
  }
  console.log(`  ${SEP}`)
  console.log(`  ⚠  = fewer than 30 trades, treat with caution`)

  console.log(`\n── Sample size summary`)
  console.log(`  Total 2025+ buy trades in CSV : ${totalBuys2025}`)
  console.log(`  With complete 180d window     : ${allFwd.length}`)
  console.log(`  Walk-forward opp buys         : ${oppBuys.length}`)
  console.log(`  Pct of all 2025+ buys         : ${allFwd.length ? (oppBuys.length/allFwd.length*100).toFixed(1) : 'N/A'}%`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
