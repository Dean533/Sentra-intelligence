// Run with:  npx tsx scripts/factor-analysis.ts
//
// Factor analysis on OPPORTUNISTIC BUYS from output/backtest-universe.csv.
// Joins market_cap from Supabase tickers table.
//
// Uses retroactive 2026 CMP classification (lookahead bias).
// Optimistic ceiling for research, not a live signal.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// ─── Env ──────────────────────────────────────────────────────────────────────

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

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (ch === ',' && !inQ) { fields.push(cur); cur = '' }
    else cur += ch
  }
  fields.push(cur)
  return fields
}

function parseNum(v: string): number | null {
  if (!v) return null
  const f = parseFloat(v)
  return isNaN(f) ? null : f
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = {
  insider_cik:        string
  insider_name:       string
  direction:          string
  classification:     string
  transaction_date:   string
  total_value:        number | null
  shares:             number | null
  shares_owned_after: number | null
  ticker:             string
  role_classified:    string
  size_bucket:        string
  return_180d:        number | null
  alpha_180d:         number | null
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function r2(v: number | null): number | null {
  return v == null ? null : Math.round(v * 100) / 100
}

const LOW_SAMPLE = 30

// ─── Bucket builder ───────────────────────────────────────────────────────────

type BucketStats = {
  label:     string
  n:         number
  winRate:   number | null
  meanRet:   number | null
  medRet:    number | null
  meanAlpha: number | null
  medAlpha:  number | null
  extra?:    string
}

function calcBucket(label: string, rows: Row[], extra?: string): BucketStats {
  const rets   = rows.map(r => r.return_180d).filter((v): v is number => v != null)
  const alphas = rows.map(r => r.alpha_180d).filter((v): v is number => v != null)
  return {
    label,
    n:         rows.length,
    winRate:   rets.length ? rets.filter(v => v > 0).length / rets.length : null,
    meanRet:   r2(mean(rets)),
    medRet:    r2(median(rets)),
    meanAlpha: r2(mean(alphas)),
    medAlpha:  r2(median(alphas)),
    extra,
  }
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fp(v: number | null, dp = 1): string {
  if (v == null) return 'N/A'
  return (v >= 0 ? '+' : '') + v.toFixed(dp) + '%'
}

function fw(v: number | null): string {
  return v == null ? 'N/A' : (v * 100).toFixed(1) + '%'
}

function printTable(title: string, buckets: BucketStats[], extraHeader?: string) {
  const EW  = extraHeader ? 14 : 0
  const LW  = 24
  const SEP = '─'.repeat(LW + 6 + 7 + 12 + 12 + 12 + 12 + EW + 4)

  console.log('\n── ' + title)
  console.log(SEP)
  console.log(
    '  ' + 'Bucket'.padEnd(LW) +
    'n'.padStart(5) + '  ' +
    'win%'.padStart(6) + '  ' +
    'ret mean'.padStart(10) + ' ret med'.padStart(9) + '  ' +
    'a mean'.padStart(8) + ' a med'.padStart(7) +
    (extraHeader ? '  ' + extraHeader.padStart(EW - 2) : '')
  )
  console.log(SEP)

  for (const b of buckets) {
    const flag = b.n < LOW_SAMPLE ? '*' : ' '
    console.log(
      flag + ' ' + b.label.slice(0, LW - 1).padEnd(LW) +
      String(b.n).padStart(5) + '  ' +
      fw(b.winRate).padStart(6) + '  ' +
      fp(b.meanRet).padStart(10) + fp(b.medRet).padStart(9) + '  ' +
      fp(b.meanAlpha).padStart(8) + fp(b.medAlpha).padStart(7) +
      (b.extra ? '  ' + b.extra.padStart(EW - 2) : '')
    )
  }

  if (buckets.some(b => b.n < LOW_SAMPLE))
    console.log('  * low sample (<' + LOW_SAMPLE + ' trades) — interpret with caution')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {

  // ── Load CSV ───────────────────────────────────────────────────────────────

  const csvPath = path.join(__dirname, '..', 'output', 'backtest-universe.csv')
  const lines   = fs.readFileSync(csvPath, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx     = (name: string) => headers.indexOf(name)

  const C = {
    insider_cik:        idx('insider_cik'),
    insider_name:       idx('insider_name'),
    direction:          idx('direction'),
    classification:     idx('classification'),
    transaction_date:   idx('transaction_date'),
    total_value:        idx('total_value'),
    shares:             idx('shares'),
    shares_owned_after: idx('shares_owned_after'),
    ticker:             idx('ticker'),
    role_classified:    idx('role_classified'),
    size_bucket:        idx('size_bucket'),
    return_180d:        idx('return_180d'),
    alpha_180d:         idx('alpha_180d'),
  }

  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing CSV columns:', missing); process.exit(1) }

  const allRows: Row[] = lines.slice(1).map(line => {
    const f = parseCsvLine(line)
    return {
      insider_cik:        f[C.insider_cik]        ?? '',
      insider_name:       f[C.insider_name]        ?? '',
      direction:          f[C.direction]           ?? '',
      classification:     f[C.classification]      ?? '',
      transaction_date:   f[C.transaction_date]    ?? '',
      total_value:        parseNum(f[C.total_value]),
      shares:             parseNum(f[C.shares]),
      shares_owned_after: parseNum(f[C.shares_owned_after]),
      ticker:             f[C.ticker]              ?? '',
      role_classified:    f[C.role_classified]     ?? '',
      size_bucket:        f[C.size_bucket]         ?? '',
      return_180d:        parseNum(f[C.return_180d]),
      alpha_180d:         parseNum(f[C.alpha_180d]),
    }
  })

  console.log('Loaded ' + allRows.length.toLocaleString() + ' rows from CSV')
  const oppBuys  = allRows.filter(r => r.classification === 'OPPORTUNISTIC' && r.direction === 'buy')
  const oppSells = allRows.filter(r => r.classification === 'OPPORTUNISTIC' && r.direction === 'sell')
  console.log('Opportunistic buys: ' + oppBuys.length + '  opp sells: ' + oppSells.length)

  // ── Fetch market caps ──────────────────────────────────────────────────────

  console.log('Fetching market caps from tickers...')
  const mcMap = new Map<string, number | null>()
  const tickerSyms = Array.from(new Set(oppBuys.map(r => r.ticker)))
  for (let i = 0; i < tickerSyms.length; i += 500) {
    const chunk = tickerSyms.slice(i, i + 500)
    const { data, error } = await supabase.from('tickers').select('symbol, market_cap').in('symbol', chunk)
    if (error) { console.error('DB error:', error.message); process.exit(1) }
    for (const r of data ?? []) mcMap.set((r as any).symbol, (r as any).market_cap ?? null)
  }
  console.log('Market cap data: ' + [...mcMap.values()].filter(v => v != null).length + ' / ' + tickerSyms.length + ' tickers')

  // ── Header ─────────────────────────────────────────────────────────────────

  console.log('\n' + '!'.repeat(80))
  console.log('!! RETROACTIVE 2026 CMP CLASSIFICATION — LOOKAHEAD BIAS')
  console.log('!! Optimistic ceiling. Not a live-signal guarantee.')
  console.log('!'.repeat(80))
  console.log('\n' + '='.repeat(80))
  console.log('FACTOR ANALYSIS — OPPORTUNISTIC BUYS (180d hold)')
  console.log(oppBuys.length + ' trades  ' + new Date().toISOString().split('T')[0])
  console.log('='.repeat(80))

  type SpreadEntry = { factor: string; buckets: BucketStats[] }
  const spreads: SpreadEntry[] = []

  // ── FACTOR 1: TRADE SIZE ───────────────────────────────────────────────────

  const SIZE_ORDER = ['<$50K','$50K-100K','$100K-250K','$250K-500K','$500K-1M','$1M-5M','$5M-25M','$25M+','Unknown']
  const f1 = SIZE_ORDER
    .map(sz => calcBucket(sz, oppBuys.filter(r => r.size_bucket === sz)))
    .filter(b => b.n > 0)
  printTable('FACTOR 1: TRADE SIZE  (total_value)', f1)
  spreads.push({ factor: 'Trade Size', buckets: f1 })

  // ── FACTOR 2: INSIDER ROLE ─────────────────────────────────────────────────

  const ROLE_ORDER = ['CEO','CFO','President','Director','10% Owner','Co-Founder/Partner','Insider (other)','Other/EVP']
  const f2 = ROLE_ORDER
    .map(role => calcBucket(role, oppBuys.filter(r => r.role_classified === role)))
    .filter(b => b.n > 0)
  printTable('FACTOR 2: INSIDER ROLE', f2)
  spreads.push({ factor: 'Insider Role', buckets: f2 })

  // ── FACTOR 3: MARKET CAP ──────────────────────────────────────────────────

  function mcBucket(mc: number | null): string {
    if (mc == null) return 'No data'
    if (mc > 200e9) return 'Mega (>$200B)'
    if (mc > 10e9)  return 'Large ($10-200B)'
    if (mc > 2e9)   return 'Mid ($2-10B)'
    return                  'Small (<$2B)'
  }

  const MC_ORDER = ['Mega (>$200B)','Large ($10-200B)','Mid ($2-10B)','Small (<$2B)','No data']
  const f3 = MC_ORDER
    .map(label => calcBucket(label, oppBuys.filter(r => mcBucket(mcMap.get(r.ticker) ?? null) === label)))
    .filter(b => b.n > 0)
  printTable('FACTOR 3: COMPANY MARKET CAP  (current)', f3)
  spreads.push({ factor: 'Market Cap', buckets: f3.filter(b => b.label !== 'No data') })

  // ── FACTOR 4: % STAKE INCREASE ────────────────────────────────────────────
  // shares_owned_after includes the purchased shares
  // position before purchase = shares_owned_after - shares
  // pct increase = shares / before * 100

  function holdBucket(shares: number | null, after: number | null): string | null {
    if (shares == null || after == null || shares <= 0) return null
    const before = after - shares
    if (before <= 0) return null
    const pct = (shares / before) * 100
    if (pct < 10)  return '<10%'
    if (pct < 25)  return '10-25%'
    if (pct < 50)  return '25-50%'
    if (pct < 100) return '50-100%'
    return '>100% (doubled+)'
  }

  const HOLD_ORDER = ['<10%','10-25%','25-50%','50-100%','>100% (doubled+)']
  const f4 = HOLD_ORDER
    .map(label => calcBucket(label, oppBuys.filter(r => holdBucket(r.shares, r.shares_owned_after) === label)))
    .filter(b => b.n > 0)
  const f4null = oppBuys.filter(r => holdBucket(r.shares, r.shares_owned_after) == null).length
  printTable('FACTOR 4: % STAKE INCREASE  (shares / prior position)', f4)
  console.log('  (' + f4null + ' trades excluded: first purchase, null after, or shares <= 0)')
  spreads.push({ factor: '% Stake Increase', buckets: f4 })

  // ── FACTOR 5: INSIDER TRACK RECORD (leave-one-out) ────────────────────────

  type TrackRow = Row & { looAvg: number | null; priorN: number }

  const byCik = new Map<string, Row[]>()
  for (const r of oppBuys) {
    if (!r.insider_cik) continue
    if (!byCik.has(r.insider_cik)) byCik.set(r.insider_cik, [])
    byCik.get(r.insider_cik)!.push(r)
  }

  const trackRows: TrackRow[] = []
  for (const [, trades] of byCik) {
    for (let ti = 0; ti < trades.length; ti++) {
      const t = trades[ti]
      const otherRets = trades
        .filter((_, oi) => oi !== ti)
        .map(o => o.return_180d)
        .filter((v): v is number => v != null)
      const looAvg = otherRets.length > 0
        ? r2(otherRets.reduce((a, b) => a + b, 0) / otherRets.length)
        : null
      trackRows.push({ ...t, looAvg, priorN: otherRets.length })
    }
  }

  function trackBucket(loo: number | null): string {
    if (loo == null) return 'No prior trades'
    if (loo < 0)     return 'Negative avg'
    if (loo < 10)    return 'Prior avg 0-10%'
    if (loo < 25)    return 'Prior avg 10-25%'
    return                   'Prior avg >25%'
  }

  const TRACK_ORDER = ['No prior trades','Negative avg','Prior avg 0-10%','Prior avg 10-25%','Prior avg >25%']
  const f5: BucketStats[] = TRACK_ORDER.map(label => {
    const sub = trackRows.filter(t => trackBucket(t.looAvg) === label)
    const avgPrior = sub.length
      ? r2(sub.reduce((a, t) => a + t.priorN, 0) / sub.length)
      : null
    return { ...calcBucket(label, sub), extra: avgPrior != null ? avgPrior.toFixed(1) : 'N/A' }
  }).filter(b => b.n > 0)
  printTable('FACTOR 5: INSIDER TRACK RECORD  (leave-one-out avg of other opp buys)', f5, 'avg prior n')
  spreads.push({ factor: 'Track Record', buckets: f5.filter(b => b.label !== 'No prior trades') })

  // ── FACTOR 6: DIRECTION SANITY ────────────────────────────────────────────

  printTable('FACTOR 6: DIRECTION  (opp buy vs opp sell sanity baseline)', [
    calcBucket('OPPORTUNISTIC buy',  oppBuys),
    calcBucket('OPPORTUNISTIC sell', oppSells),
  ])

  // ── RANKING ───────────────────────────────────────────────────────────────

  console.log('\n\n' + '='.repeat(80))
  console.log('FACTOR RANKING  (best bucket med ret - worst bucket med ret, >=' + LOW_SAMPLE + ' trades)')
  console.log('Bigger spread = more differentiation = more predictive.')
  console.log('='.repeat(80))

  type RankRow = { factor: string; spread: number; best: string; bestMed: number; worst: string; worstMed: number }
  const ranking: RankRow[] = []

  for (const { factor, buckets } of spreads) {
    const elig = buckets.filter(b => b.n >= LOW_SAMPLE && b.medRet != null)
    if (elig.length < 2) continue
    const sorted = [...elig].sort((a, b) => b.medRet! - a.medRet!)
    const best   = sorted[0]
    const worst  = sorted[sorted.length - 1]
    ranking.push({ factor, spread: r2(best.medRet! - worst.medRet!)!, best: best.label, bestMed: best.medRet!, worst: worst.label, worstMed: worst.medRet! })
  }
  ranking.sort((a, b) => b.spread - a.spread)

  const RL = 20, BL = 22
  console.log('\n  #  ' + 'Factor'.padEnd(RL) + 'Spread'.padStart(8) + '  ' + 'Best bucket'.padEnd(BL) + 'med'.padStart(8) + '  ' + 'Worst bucket'.padEnd(BL) + 'med'.padStart(8))
  console.log('  ' + '-'.repeat(3 + RL + 8 + 2 + BL + 8 + 2 + BL + 8))

  for (let i = 0; i < ranking.length; i++) {
    const r = ranking[i]
    console.log(
      '  ' + String(i + 1).padEnd(3) +
      r.factor.padEnd(RL) + fp(r.spread).padStart(8) + '  ' +
      r.best.slice(0, BL - 1).padEnd(BL)  + fp(r.bestMed).padStart(8) + '  ' +
      r.worst.slice(0, BL - 1).padEnd(BL) + fp(r.worstMed).padStart(8)
    )
  }

  console.log('\n' + '='.repeat(80) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
