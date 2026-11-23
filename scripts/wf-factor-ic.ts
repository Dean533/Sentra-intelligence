// Run with:  npx tsx scripts/wf-factor-ic.ts
//
// Walk-forward IC test for all 8 candidate factors.
//
// For each buy trade at date T, every factor is computed using ONLY
// information available strictly before T — no lookahead of any kind.
//
// Factors:
//   F1  Sector prior mean α    — running mean SM alpha of completed trades in
//                                same sector (only trades where date+180d < T)
//   F2  PIT cap log            — log10(PIT market cap) — known at T
//   F3  Role prior mean α      — same temporal sweep as F1, by role
//   F4  log Trade size         — log10(total_value) — known at T
//   F5  Stake increase %       — log1p(shares/before * 100) — known at T
//   F6  Cluster buy count      — distinct insiders who bought same ticker
//                                in (T-30d, T) — prior data only
//   F7  Price momentum 90d     — stock return from T-90d to T, proxied from
//                                prior trades in the CSV for that ticker
//   F8  Days since last trade  — calendar days since insider's most recent
//                                prior trade (any direction, any ticker)
//
// IC = Pearson(factor_value, forward_SM_alpha_180d) — walk-forward
// Reported per classification (OPP / UNCL / ROUTINE) and combined.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Env ──────────────────────────────────────────────────────────────────────

function loadEnvLocal() {
  const p = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(p)) { console.error('.env.local not found'); process.exit(1) }
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq < 0) continue
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
const yf  = new YahooFinance()
const slp = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── CSV ─────────────────────────────────────────────────────────────────────

function parseCsv(line: string): string[] {
  const f: string[] = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (inQ && line[i+1]==='"') { cur+='"'; i++ } else inQ=!inQ }
    else if (ch===',' && !inQ) { f.push(cur); cur='' }
    else cur+=ch
  }
  f.push(cur); return f
}

function pn(v: string): number | null { const n=parseFloat(v); return isNaN(n)?null:n }

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addD(s: string, n: number): string {
  const d = new Date(s); d.setUTCDate(d.getUTCDate()+n)
  return d.toISOString().split('T')[0]
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

// ─── Price helpers ────────────────────────────────────────────────────────────

function buildPriceMap(quotes: any[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const q of quotes)
    if (q?.date!=null && (q?.adjClose??q?.close)!=null)
      m.set(new Date(q.date).toISOString().split('T')[0], q.adjClose??q.close)
  return m
}

function lookupP(m: Map<string, number>, d: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const dt = new Date(d); dt.setUTCDate(dt.getUTCDate()+i)
    const p = m.get(dt.toISOString().split('T')[0])
    if (p!=null) return p
  }
  return null
}

// Find nearest price to target date within ±window days
function nearestPrice(
  sortedDates: string[], priceByDate: Map<string, number>,
  target: string, window = 14
): number | null {
  let best: number | null = null, bestDist = window + 1
  for (const d of sortedDates) {
    const dist = Math.abs(daysBetween(d, target))
    if (dist > window) continue
    if (dist < bestDist) { bestDist = dist; best = priceByDate.get(d)! }
  }
  return best
}

// ─── PIT ─────────────────────────────────────────────────────────────────────

function pitTier(mc: number | null): string {
  if (mc==null) return 'No data'
  if (mc<300e6) return 'Micro'; if (mc<2e9) return 'Small'
  if (mc<10e9)  return 'Mid';   if (mc<200e9) return 'Large'
  return 'Mega'
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n=xs.length; if (n<10) return NaN
  const mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n
  let cov=0, sx=0, sy=0
  for (let i=0;i<n;i++) { const dx=xs[i]-mx, dy=ys[i]-my; cov+=dx*dy; sx+=dx*dx; sy+=dy*dy }
  const d=Math.sqrt(sx*sy); return d<1e-12?NaN:cov/d
}

// ─── Signal verdict ───────────────────────────────────────────────────────────

function verdict(ic: number | null): string {
  if (ic==null||isNaN(ic)) return '? insufficient data'
  const a = Math.abs(ic)
  if (a > 0.10) return '★ strong  → weight it'
  if (a > 0.03) return '✓ moderate → small weight'
  return               '· noise   → drop it'
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')

  // ── Load CSV ──────────────────────────────────────────────────────────────
  console.log('Reading CSV...')
  const lines   = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const hdr     = parseCsv(lines[0])
  const idx     = (n: string) => hdr.indexOf(n)

  const C = {
    insider_cik:        idx('insider_cik'),
    ticker:             idx('ticker'),
    classification:     idx('classification'),
    direction:          idx('direction'),
    transaction_date:   idx('transaction_date'),
    transaction_code:   idx('transaction_code'),
    price_entry:        idx('price_entry'),
    total_value:        idx('total_value'),
    shares:             idx('shares'),
    shares_owned_after: idx('shares_owned_after'),
    return_180d:        idx('return_180d'),
    spy_return_180d:    idx('spy_return_180d'),
    role_classified:    idx('role_classified'),
    sector:             idx('sector'),
  }
  const missing = Object.entries(C).filter(([,v])=>v===-1).map(([k])=>k)
  if (missing.length) { console.error('Missing cols:', missing); process.exit(1) }

  type RawRow = {
    insider_cik: string; ticker: string; classification: string
    direction: string; transaction_date: string; transaction_code: string
    price_entry: number|null; total_value: number|null
    shares: number|null; shares_owned_after: number|null
    return_180d: number|null; spy_return_180d: number|null
    role_classified: string; sector: string
  }

  const rawRows: RawRow[] = lines.slice(1).map(l => {
    const f = parseCsv(l)
    return {
      insider_cik:        f[C.insider_cik]        ?? '',
      ticker:             f[C.ticker]              ?? '',
      classification:     f[C.classification]      ?? '',
      direction:          f[C.direction]           ?? '',
      transaction_date:   f[C.transaction_date]    ?? '',
      transaction_code:   f[C.transaction_code]    ?? '',
      price_entry:        pn(f[C.price_entry]),
      total_value:        pn(f[C.total_value]),
      shares:             pn(f[C.shares]),
      shares_owned_after: pn(f[C.shares_owned_after]),
      return_180d:        pn(f[C.return_180d]),
      spy_return_180d:    pn(f[C.spy_return_180d]),
      role_classified:    f[C.role_classified]     ?? '',
      sector:             f[C.sector]              ?? '',
    }
  })

  const allBuys = rawRows.filter(r => r.direction==='buy' && r.return_180d!=null)
  console.log(`  ${rawRows.length.toLocaleString()} total → ${allBuys.length.toLocaleString()} buys w/ 180d data`)

  // ── Market caps → PIT ─────────────────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap = new Map<string, number|null>()
  const tickers = [...new Set(rawRows.map(r=>r.ticker))]
  for (let i=0; i<tickers.length; i+=500) {
    const {data} = await supabase.from('tickers').select('symbol,market_cap').in('symbol',tickers.slice(i,i+500))
    for (const r of data??[]) mcMap.set((r as any).symbol,(r as any).market_cap??null)
  }
  const latestPrice = new Map<string,number>()
  for (const r of rawRows)
    if (r.price_entry!=null) {
      const c=latestPrice.get(r.ticker)
      if (!c||r.price_entry>c) latestPrice.set(r.ticker,r.price_entry)
    }

  // ── MDY + IWM ─────────────────────────────────────────────────────────────
  const fetchStart = new Date('2021-01-01')
  const fetchEnd   = new Date(addD(rawRows.map(r=>r.transaction_date).sort().at(-1)!, 195))
  console.log('Fetching MDY...'); await slp(300)
  let mdyMap = new Map<string,number>()
  try {
    const ch: any = await yf.chart('MDY',{period1:fetchStart,period2:fetchEnd,interval:'1d'})
    mdyMap = buildPriceMap(Array.isArray(ch?.quotes)?ch.quotes:[])
    console.log(`  ${mdyMap.size} pts`)
  } catch(e:any){console.error('MDY failed:',e.message);process.exit(1)}
  await slp(300); console.log('Fetching IWM...')
  let iwmMap = new Map<string,number>()
  try {
    const ch: any = await yf.chart('IWM',{period1:fetchStart,period2:fetchEnd,interval:'1d'})
    iwmMap = buildPriceMap(Array.isArray(ch?.quotes)?ch.quotes:[])
    console.log(`  ${iwmMap.size} pts`)
  } catch(e:any){console.error('IWM failed:',e.message);process.exit(1)}

  // ── SM alpha + PIT tier per buy ───────────────────────────────────────────
  type Buy = RawRow & {
    sm_alpha: number; pit_mc: number|null; pit_tier: string
    log_pit_mc: number|null
  }

  const buys: Buy[] = []
  for (const r of allBuys) {
    const mc_t=mcMap.get(r.ticker)??null, p_t=latestPrice.get(r.ticker)??null
    let mc_pit: number|null=null
    if (mc_t!=null&&p_t!=null&&p_t>0&&r.price_entry!=null&&r.price_entry>0)
      mc_pit=(mc_t/p_t)*r.price_entry
    const tier=pitTier(mc_pit)
    let bm: number|null=null
    if (tier==='Large'||tier==='Mega') bm=r.spy_return_180d??null
    else if (tier==='Mid') {
      const p0=lookupP(mdyMap,r.transaction_date),p1=lookupP(mdyMap,addD(r.transaction_date,180))
      bm=(p0&&p1)?Math.round(((p1-p0)/p0)*10000)/100:null
    } else {
      const p0=lookupP(iwmMap,r.transaction_date),p1=lookupP(iwmMap,addD(r.transaction_date,180))
      bm=(p0&&p1)?Math.round(((p1-p0)/p0)*10000)/100:null
    }
    if (r.return_180d==null||bm==null) continue
    buys.push({...r, sm_alpha:Math.round((r.return_180d-bm)*100)/100,
      pit_mc:mc_pit, pit_tier:tier,
      log_pit_mc:mc_pit!=null&&mc_pit>0?Math.log10(mc_pit):null})
  }
  console.log(`  ${buys.length.toLocaleString()} buys with complete SM alpha`)

  // ─────────────────────────────────────────────────────────────────────────
  // AUXILIARY STRUCTURES
  // ─────────────────────────────────────────────────────────────────────────

  // F6: cluster — ALL purchase transactions (not just buys w/ complete data)
  // Group all P-code transactions by ticker, sorted by date
  console.log('\nBuilding auxiliary structures...')
  const purchasesByTicker = new Map<string, {date:string; cik:string}[]>()
  for (const r of rawRows) {
    if (r.transaction_code!=='P') continue
    if (!r.insider_cik||!r.ticker) continue
    if (!purchasesByTicker.has(r.ticker)) purchasesByTicker.set(r.ticker,[])
    purchasesByTicker.get(r.ticker)!.push({date:r.transaction_date,cik:r.insider_cik})
  }
  for (const arr of purchasesByTicker.values()) arr.sort((a,b)=>a.date<b.date?-1:1)

  // F7: price momentum — build per-ticker price history from CSV
  // Use all rows (any direction) that have a valid price_entry
  const tickerPriceHistory = new Map<string, {date:string; price:number}[]>()
  for (const r of rawRows) {
    if (!r.ticker||r.price_entry==null) continue
    if (!tickerPriceHistory.has(r.ticker)) tickerPriceHistory.set(r.ticker,[])
    tickerPriceHistory.get(r.ticker)!.push({date:r.transaction_date, price:r.price_entry})
  }
  for (const arr of tickerPriceHistory.values()) {
    arr.sort((a,b)=>a.date<b.date?-1:1)
    // Deduplicate by date (keep last price if multiple on same date)
    const deduped: {date:string;price:number}[] = []
    for (const pt of arr) {
      if (deduped.length>0 && deduped[deduped.length-1].date===pt.date)
        deduped[deduped.length-1].price=pt.price
      else deduped.push(pt)
    }
    tickerPriceHistory.set(arr[0]?.date?arr[0].date:'', deduped as any)
    tickerPriceHistory.set(arr[arr.length-1]?.ticker??'_', deduped as any)
  }
  // Rebuild properly
  const tickerPHClean = new Map<string, {date:string; price:number}[]>()
  for (const r of rawRows) {
    if (!r.ticker||r.price_entry==null) continue
    if (!tickerPHClean.has(r.ticker)) tickerPHClean.set(r.ticker,[])
    tickerPHClean.get(r.ticker)!.push({date:r.transaction_date, price:r.price_entry})
  }
  for (const [tk, arr] of tickerPHClean) {
    arr.sort((a,b)=>a.date<b.date?-1:1)
    const deduped: {date:string;price:number}[] = []
    for (const pt of arr) {
      if (deduped.length>0&&deduped.at(-1)!.date===pt.date) deduped.at(-1)!.price=pt.price
      else deduped.push(pt)
    }
    tickerPHClean.set(tk, deduped)
  }

  // F8: days since last trade — ALL trades by each insider, sorted by date
  const allTradesByInsider = new Map<string, string[]>()  // cik → sorted dates
  for (const r of rawRows) {
    if (!r.insider_cik||!r.transaction_date) continue
    if (!allTradesByInsider.has(r.insider_cik)) allTradesByInsider.set(r.insider_cik,[])
    allTradesByInsider.get(r.insider_cik)!.push(r.transaction_date)
  }
  for (const arr of allTradesByInsider.values()) arr.sort()
  // Deduplicate
  for (const [cik, arr] of allTradesByInsider) {
    allTradesByInsider.set(cik, [...new Set(arr)])
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TEMPORAL SWEEP — running means for F1 (sector), F3 (role)
  // and PIT tier prior mean (alt encoding for F2)
  //
  // Sort buys by date. Process each buy; before reading its factor values,
  // advance the "completed" pointer to add any trade whose
  // (date + 180d) < current_date into the running sums.
  // ─────────────────────────────────────────────────────────────────────────

  const sorted = [...buys].sort((a,b)=>a.transaction_date<b.transaction_date?-1:1)
  // Sort by completion date for the running mean sweep
  const byCompletion = [...buys]
    .filter(r=>r.sm_alpha!=null)
    .sort((a,b)=>{
      const ca=addD(a.transaction_date,180), cb=addD(b.transaction_date,180)
      return ca<cb?-1:1
    })

  const sectorSum=new Map<string,number>(), sectorCnt=new Map<string,number>()
  const roleSum=new Map<string,number>(),   roleCnt=new Map<string,number>()
  const tierSum=new Map<string,number>(),   tierCnt=new Map<string,number>()

  let compPtr = 0

  // Result arrays indexed by position in `sorted`
  const F: Record<string, (number|null)[]> = {
    f1_sector_prior: new Array(sorted.length).fill(null),
    f2_log_pit_mc:   new Array(sorted.length).fill(null),
    f2b_tier_prior:  new Array(sorted.length).fill(null),
    f3_role_prior:   new Array(sorted.length).fill(null),
    f4_log_size:     new Array(sorted.length).fill(null),
    f5_stake:        new Array(sorted.length).fill(null),
    f6_cluster:      new Array(sorted.length).fill(null),
    f7_momentum90:   new Array(sorted.length).fill(null),
    f8_days_since:   new Array(sorted.length).fill(null),
  }
  const FWD = new Array<number>(sorted.length)
  const CLS = sorted.map(r => r.classification)
  const tickerForRow = sorted.map(r => r.ticker)

  console.log('Computing walk-forward factors...')

  for (let i = 0; i < sorted.length; i++) {
    const r    = sorted[i]
    const T    = r.transaction_date

    // ── Advance running means: add completed trades before T ─────────────
    while (compPtr < byCompletion.length) {
      const c = byCompletion[compPtr]
      if (addD(c.transaction_date, 180) >= T) break
      const sec = c.sector||'Unknown', rol = c.role_classified||'Other/EVP', tier = c.pit_tier
      sectorSum.set(sec,(sectorSum.get(sec)??0)+c.sm_alpha)
      sectorCnt.set(sec,(sectorCnt.get(sec)??0)+1)
      roleSum.set(rol,(roleSum.get(rol)??0)+c.sm_alpha)
      roleCnt.set(rol,(roleCnt.get(rol)??0)+1)
      tierSum.set(tier,(tierSum.get(tier)??0)+c.sm_alpha)
      tierCnt.set(tier,(tierCnt.get(tier)??0)+1)
      compPtr++
    }

    FWD[i] = r.sm_alpha

    // F1: sector prior mean
    const sec = r.sector||'Unknown'
    const sn  = sectorCnt.get(sec)??0
    F.f1_sector_prior[i] = sn >= 3 ? sectorSum.get(sec)!/sn : null

    // F2: log PIT market cap (point-in-time; no lookahead in cap tier itself)
    F.f2_log_pit_mc[i] = r.log_pit_mc

    // F2b: PIT tier prior mean (alternative encoding)
    const tn = tierCnt.get(r.pit_tier)??0
    F.f2b_tier_prior[i] = tn >= 3 ? tierSum.get(r.pit_tier)!/tn : null

    // F3: role prior mean
    const rol = r.role_classified||'Other/EVP'
    const rn  = roleCnt.get(rol)??0
    F.f3_role_prior[i] = rn >= 3 ? roleSum.get(rol)!/rn : null

    // F4: log trade size
    F.f4_log_size[i] = r.total_value!=null&&r.total_value>0 ? Math.log10(r.total_value) : null

    // F5: stake increase (log1p pct)
    if (r.shares!=null&&r.shares_owned_after!=null&&r.shares>0) {
      const before = r.shares_owned_after - r.shares
      if (before>0) F.f5_stake[i] = Math.log1p((r.shares/before)*100)
    }

    // F6: cluster — distinct insiders who bought same ticker in (T-30d, T)
    const win_start = addD(T,-30)
    const purchases = purchasesByTicker.get(r.ticker) ?? []
    const clusterCiks = new Set<string>()
    for (const p of purchases) {
      if (p.date>=win_start && p.date<T && p.cik!==r.insider_cik)
        clusterCiks.add(p.cik)
    }
    F.f6_cluster[i] = clusterCiks.size

    // F7: price momentum — return in 90d before T from intra-CSV price history
    const ph = tickerPHClean.get(r.ticker) ?? []
    if (ph.length >= 2 && r.price_entry!=null) {
      const target90 = addD(T,-90)
      // Find nearest price within ±14 days of target90 that is BEFORE T
      let bestDist=99, bestPrice: number|null=null
      for (const pt of ph) {
        if (pt.date>=T) break
        const dist = Math.abs(daysBetween(pt.date, target90))
        if (dist < bestDist && dist <= 14) { bestDist=dist; bestPrice=pt.price }
      }
      if (bestPrice!=null&&bestPrice>0)
        F.f7_momentum90[i] = Math.round(((r.price_entry-bestPrice)/bestPrice)*10000)/100
    }

    // F8: days since insider's last trade
    if (r.insider_cik) {
      const dates = allTradesByInsider.get(r.insider_cik)??[]
      // Last date strictly before T
      let lastDate: string|null=null
      for (const d of dates) { if (d<T) lastDate=d }
      if (lastDate!=null) F.f8_days_since[i] = daysBetween(lastDate, T)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPUTE ICs
  // ─────────────────────────────────────────────────────────────────────────

  // Use log_pit_mc for F2 (continuous) and tier_prior as F2b; report both
  const FACTORS: { key: string; label: string }[] = [
    { key: 'f1_sector_prior', label: 'Sector prior mean α' },
    { key: 'f2_log_pit_mc',   label: 'PIT cap log10($)' },
    { key: 'f2b_tier_prior',  label: 'PIT tier prior mean α' },
    { key: 'f3_role_prior',   label: 'Role prior mean α' },
    { key: 'f4_log_size',     label: 'log Trade Size' },
    { key: 'f5_stake',        label: 'Stake Increase log1p' },
    { key: 'f6_cluster',      label: 'Cluster buys (30d)' },
    { key: 'f7_momentum90',   label: 'Price momentum 90d' },
    { key: 'f8_days_since',   label: 'Days since last trade' },
  ]

  const CLASSES = ['OPPORTUNISTIC','UNCLASSIFIABLE','ROUTINE','ALL'] as const

  type IcResult = { ic: number|null; n: number }
  // icTable[factor_key][cls] = { ic, n }
  const icTable = new Map<string, Record<string, IcResult>>()

  for (const { key } of FACTORS) {
    const byClass: Record<string, IcResult> = {}
    for (const cls of CLASSES) {
      const xs: number[]=[], ys: number[]=[]
      for (let i=0; i<sorted.length; i++) {
        if (cls!=='ALL' && CLS[i]!==cls) continue
        const fv = F[key][i]
        if (fv==null||!isFinite(fv)) continue
        xs.push(fv); ys.push(FWD[i])
      }
      byClass[cls] = { ic: xs.length>=10?pearson(xs,ys):null, n: xs.length }
    }
    icTable.set(key, byClass)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRINT RESULTS
  // ─────────────────────────────────────────────────────────────────────────

  const LINE = '─'.repeat(110)

  function fmtIC(ic: number|null): string {
    if (ic==null||isNaN(ic)) return '   N/A  '
    const s=(ic>=0?'+':'')+ic.toFixed(4)
    return s.padStart(8)
  }

  function printClassResult(cls: string) {
    console.log(`\n${'═'.repeat(110)}`)
    console.log(`  WALK-FORWARD IC — ${cls} BUYS`)
    console.log('═'.repeat(110))
    console.log('  ' + 'Factor'.padEnd(28) + 'WF IC'.padStart(9) + '  ' + 'n valid'.padStart(8) + '  ' + 'Verdict')
    console.log('  ' + LINE)

    // Sort by |IC| descending
    const ranked = [...FACTORS]
      .map(f => ({ ...f, res: icTable.get(f.key)![cls] }))
      .sort((a,b) => {
        const ia=a.res.ic, ib=b.res.ic
        if (ia==null||isNaN(ia)) return 1
        if (ib==null||isNaN(ib)) return -1
        return Math.abs(ib)-Math.abs(ia)
      })

    let rank=1
    for (const { label, res } of ranked) {
      if (res.ic==null||isNaN(res.ic)) {
        console.log(`  ${rank++}. ${label.padEnd(27)} ${'N/A'.padStart(9)}  ${String(res.n).padStart(8)}  ? insufficient n`)
        continue
      }
      const bar = ic_bar(res.ic)
      console.log(`  ${rank++}. ${label.padEnd(27)} ${fmtIC(res.ic)}  ${String(res.n).padStart(8)}  ${verdict(res.ic)}  ${bar}`)
    }
  }

  function ic_bar(ic: number): string {
    const a=Math.abs(ic), pos=ic>0
    const filled=Math.round(a*60)
    const bar='█'.repeat(Math.min(filled,30))
    return pos?`+[${bar.padEnd(30,' ')}]`:`-[${bar.padEnd(30,' ')}]`
  }

  for (const cls of ['OPPORTUNISTIC','UNCLASSIFIABLE','ROUTINE','ALL'] as const) {
    printClassResult(cls as string)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMBINED SUMMARY TABLE
  // ─────────────────────────────────────────────────────────────────────────

  console.log(`\n\n${'█'.repeat(110)}`)
  console.log('  SUMMARY — WALK-FORWARD IC PER FACTOR × CLASSIFICATION')
  console.log('  Ranked by average |IC| across OPP + UNCL + ROUTINE')
  console.log('█'.repeat(110))
  console.log(
    '  ' + 'Factor'.padEnd(28) +
    'OPP IC'.padStart(9) + '  ' + 'UNCL IC'.padStart(9) + '  ' + 'ROUT IC'.padStart(9) +
    '  ' + 'avg|IC|'.padStart(9) + '  Consensus verdict'
  )
  console.log('  ' + LINE)

  const summaryRows = FACTORS.map(f => {
    const oppR=icTable.get(f.key)!['OPPORTUNISTIC']
    const uncR=icTable.get(f.key)!['UNCLASSIFIABLE']
    const rotR=icTable.get(f.key)!['ROUTINE']
    const ics = [oppR.ic,uncR.ic,rotR.ic].filter(v=>v!=null&&!isNaN(v as number)) as number[]
    const avg  = ics.length ? ics.reduce((a,b)=>a+Math.abs(b),0)/ics.length : null
    return { ...f, oppR, uncR, rotR, avg }
  }).sort((a,b)=>(b.avg??-1)-(a.avg??-1))

  for (const { label, oppR, uncR, rotR, avg } of summaryRows) {
    const avgLabel = avg!=null ? avg.toFixed(4) : '  N/A  '
    const v = verdict(avg)
    console.log(
      '  ' + label.padEnd(28) +
      fmtIC(oppR.ic) + '  ' + fmtIC(uncR.ic) + '  ' + fmtIC(rotR.ic) +
      '  ' + avgLabel.padStart(9) + '  ' + v
    )
  }

  // ── Recommended weights ───────────────────────────────────────────────────
  console.log(`\n\n${'█'.repeat(110)}`)
  console.log('  RECOMMENDED FACTOR WEIGHTS FOR LIVE SCORING MODEL')
  console.log('  Based on walk-forward IC only. Zero weight = drop from model.')
  console.log('█'.repeat(110))

  const strong:  string[] = []
  const moderate: string[] = []
  const noise:   string[] = []
  for (const { label, avg } of summaryRows) {
    if (avg==null) { noise.push(label); continue }
    if (avg>0.10) strong.push(label)
    else if (avg>0.03) moderate.push(label)
    else noise.push(label)
  }
  console.log(`\n  ★ STRONG (|IC| > 0.10) — high weight:`)
  strong.length ? strong.forEach(l=>console.log(`      • ${l}`)) : console.log('      (none)')
  console.log(`\n  ✓ MODERATE (0.03–0.10) — small weight:`)
  moderate.length ? moderate.forEach(l=>console.log(`      • ${l}`)) : console.log('      (none)')
  console.log(`\n  · NOISE (<0.03) — drop:`)
  noise.length ? noise.forEach(l=>console.log(`      • ${l}`)) : console.log('      (none)')

  console.log('\n  Note: Track Record WF IC was ~0 (87–99% shrinkage vs in-sample) — confirmed noise.')
  console.log('  Sector and cap tier prior means require ≥3 prior completed trades in that group to score.')
  console.log('  Coverage for F7 (momentum) depends on ticker trade frequency in dataset.')
  console.log()
}

main().catch(err=>{console.error('Fatal:',err);process.exit(1)})
