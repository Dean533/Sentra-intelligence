// Run with:  npx tsx scripts/walkforward-trackrecord.ts
//
// TRUE WALK-FORWARD validation of the track-record factor.
//
// For each buy trade at date T, the insider's "prior track record" is computed
// using ONLY trades whose 180-day return window FULLY CLOSED before T, i.e.:
//
//   prior_trade_date + 180d < T
//
// This is information that was genuinely available at T — no future data used.
//
// The "forward alpha" is the current trade's own size-matched alpha.
//
// The walk-forward IC = Pearson(prior_track_record, forward_alpha)
// compared against the in-sample IC (0.57–0.79) to measure lookahead inflation.
//
// Output:
//   1. Overall walk-forward bucket table (all buys, all classifications)
//   2. Same table split by classification (OPP / UNCL / ROUTINE)
//   3. IC comparison table: in-sample vs walk-forward

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

function addD(s: string, n: number): string {
  const d = new Date(s); d.setUTCDate(d.getUTCDate()+n)
  return d.toISOString().split('T')[0]
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n=xs.length; if (n<3) return NaN
  const mx=xs.reduce((a,b)=>a+b,0)/n, my=ys.reduce((a,b)=>a+b,0)/n
  let cov=0, sx=0, sy=0
  for (let i=0;i<n;i++) { const dx=xs[i]-mx, dy=ys[i]-my; cov+=dx*dy; sx+=dx*dx; sy+=dy*dy }
  const d=Math.sqrt(sx*sy); return d<1e-12?NaN:cov/d
}

function spearman(xs: number[], ys: number[]): number {
  const n=xs.length; if (n<3) return NaN
  const rank=(arr: number[]) => {
    const s=[...arr].map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v)
    const r=new Array(n)
    for (let i=0;i<n;i++) r[s[i].i]=i+1
    return r
  }
  return pearson(rank(xs), rank(ys))
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s=[...xs].sort((a,b)=>a-b), m=Math.floor(s.length/2)
  return s.length%2?s[m]:(s[m-1]+s[m])/2
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null
}

// ─── PIT ─────────────────────────────────────────────────────────────────────

function pitTier(mc: number | null): string {
  if (mc==null) return 'No data'
  if (mc<300e6) return 'Micro'; if (mc<2e9) return 'Small'
  if (mc<10e9)  return 'Mid';   if (mc<200e9) return 'Large'
  return 'Mega'
}

// ─── Track-record bucket ──────────────────────────────────────────────────────

function trackBucket(avg: number | null): string {
  if (avg==null)  return 'No prior history'
  if (avg < 0)    return 'Negative (<0%)'
  if (avg < 10)   return '0–10%'
  if (avg < 25)   return '10–25%'
  return             '>25%'
}

// ─── Printer ─────────────────────────────────────────────────────────────────

function fmt(v: number | null, dp=2): string {
  if (v==null) return '  N/A  '
  return (v>=0?'+':'')+v.toFixed(dp)+'%'
}

function printBucketTable(
  title: string,
  data: Map<string, { fwd_alphas: number[]; fwd_rets: number[]; prior_avgs: number[] }>,
  order: string[]
) {
  const SEP = '─'.repeat(96)
  console.log(`\n── ${title}`)
  console.log(SEP)
  console.log(
    '  ' + 'Prior Track Record'.padEnd(22) +
    'n'.padStart(7) + '  ' +
    'Win%'.padStart(7) + '  ' +
    'Med Fwd Ret'.padStart(12) + '  ' +
    'Med Fwd α(SM)'.padStart(14) + '  ' +
    'Mean Fwd α(SM)'.padStart(15) + '  ' +
    'Bucket α avg'.padStart(13)
  )
  console.log('  ' + SEP)

  const priors: number[] = [], forwards: number[] = []

  for (const bucket of order) {
    const g = data.get(bucket)
    if (!g || !g.fwd_alphas.length) continue
    const n      = g.fwd_alphas.length
    const wins   = g.fwd_rets.filter(r=>r>0).length
    const wr     = wins/n*100
    const flag   = n < 30 ? ' ⚠' : '  '
    // for IC: need the prior_avg per row paired with fwd_alpha per row
    for (const v of g.prior_avgs) priors.push(v)
    for (const v of g.fwd_alphas) forwards.push(v)

    console.log(
      flag + bucket.slice(0,21).padEnd(22) +
      String(n).padStart(7) + '  ' +
      fmt(wr,1).padStart(7) + '  ' +
      fmt(median(g.fwd_rets),1).padStart(12) + '  ' +
      fmt(median(g.fwd_alphas)).padStart(14) + '  ' +
      fmt(mean(g.fwd_alphas)).padStart(15) + '  ' +
      fmt(mean(g.prior_avgs)).padStart(13)
    )
  }
  if ([...data.values()].some(g=>g.fwd_alphas.length<30))
    console.log('  ⚠ < 30 trades — low sample')

  const wf_ic_p   = pearson(priors, forwards)
  const wf_ic_s   = spearman(priors, forwards)
  const n_total   = priors.length
  console.log(`\n  n (with prior history): ${n_total.toLocaleString()}`)
  console.log(`  Walk-forward IC (Pearson):  ${wf_ic_p.toFixed(4)}`)
  console.log(`  Walk-forward IC (Spearman): ${wf_ic_s.toFixed(4)}`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')

  console.log('Reading CSV...')
  const lines   = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsv(lines[0])
  const idx     = (n: string) => headers.indexOf(n)

  const C = {
    insider_cik:      idx('insider_cik'),
    ticker:           idx('ticker'),
    classification:   idx('classification'),
    direction:        idx('direction'),
    transaction_date: idx('transaction_date'),
    price_entry:      idx('price_entry'),
    return_180d:      idx('return_180d'),
    spy_return_180d:  idx('spy_return_180d'),
  }
  const missing = Object.entries(C).filter(([,v])=>v===-1).map(([k])=>k)
  if (missing.length) { console.error('Missing cols:', missing); process.exit(1) }

  type RawRow = {
    insider_cik: string; ticker: string; classification: string; direction: string
    transaction_date: string; price_entry: number | null
    return_180d: number | null; spy_return_180d: number | null
  }

  const rawRows: RawRow[] = lines.slice(1).map(l => {
    const f = parseCsv(l)
    return {
      insider_cik:      f[C.insider_cik]      ?? '',
      ticker:           f[C.ticker]            ?? '',
      classification:   f[C.classification]    ?? '',
      direction:        f[C.direction]         ?? '',
      transaction_date: f[C.transaction_date]  ?? '',
      price_entry:      pn(f[C.price_entry]),
      return_180d:      pn(f[C.return_180d]),
      spy_return_180d:  pn(f[C.spy_return_180d]),
    }
  })

  // All buys with complete 180d return
  const allBuys = rawRows.filter(r => r.direction==='buy' && r.return_180d!=null)
  console.log(`  ${rawRows.length.toLocaleString()} total rows → ${allBuys.length.toLocaleString()} buys with 180d data`)

  // ── Market caps ───────────────────────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap = new Map<string, number | null>()
  const tickers = [...new Set(rawRows.map(r=>r.ticker))]
  for (let i=0; i<tickers.length; i+=500) {
    const { data } = await supabase.from('tickers').select('symbol,market_cap').in('symbol', tickers.slice(i,i+500))
    for (const r of data??[]) mcMap.set((r as any).symbol, (r as any).market_cap??null)
  }

  const latestPrice = new Map<string, number>()
  for (const r of rawRows)
    if (r.price_entry!=null) {
      const c = latestPrice.get(r.ticker)
      if (!c||r.price_entry>c) latestPrice.set(r.ticker, r.price_entry)
    }

  // ── MDY + IWM ─────────────────────────────────────────────────────────────
  const allDates   = rawRows.map(r=>r.transaction_date).filter(Boolean).sort()
  const fetchStart = new Date('2021-01-01')
  const fetchEnd   = new Date(addD(allDates[allDates.length-1], 195))

  console.log('Fetching MDY...')
  await slp(300)
  let mdyMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('MDY', { period1:fetchStart, period2:fetchEnd, interval:'1d' })
    mdyMap = buildPriceMap(Array.isArray(ch?.quotes)?ch.quotes:[])
    console.log(`  ${mdyMap.size} MDY pts`)
  } catch(e:any) { console.error('MDY failed:', e.message); process.exit(1) }

  await slp(300)
  console.log('Fetching IWM...')
  let iwmMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('IWM', { period1:fetchStart, period2:fetchEnd, interval:'1d' })
    iwmMap = buildPriceMap(Array.isArray(ch?.quotes)?ch.quotes:[])
    console.log(`  ${iwmMap.size} IWM pts`)
  } catch(e:any) { console.error('IWM failed:', e.message); process.exit(1) }

  // ── Compute size-matched alpha per buy ────────────────────────────────────
  type EnrichedBuy = RawRow & { sm_alpha: number | null; pit_tier: string }

  const enriched: EnrichedBuy[] = []
  for (const r of allBuys) {
    const mc_t = mcMap.get(r.ticker)??null
    const p_t  = latestPrice.get(r.ticker)??null
    let mc_pit: number|null = null
    if (mc_t!=null&&p_t!=null&&p_t>0&&r.price_entry!=null&&r.price_entry>0)
      mc_pit = (mc_t/p_t)*r.price_entry
    const tier = pitTier(mc_pit)

    let bm: number|null = null
    if (tier==='Large'||tier==='Mega') {
      bm = r.spy_return_180d??null
    } else if (tier==='Mid') {
      const p0=lookupP(mdyMap,r.transaction_date), p1=lookupP(mdyMap,addD(r.transaction_date,180))
      bm = (p0&&p1) ? Math.round(((p1-p0)/p0)*10000)/100 : null
    } else {
      const p0=lookupP(iwmMap,r.transaction_date), p1=lookupP(iwmMap,addD(r.transaction_date,180))
      bm = (p0&&p1) ? Math.round(((p1-p0)/p0)*10000)/100 : null
    }

    const sm_alpha = (r.return_180d!=null&&bm!=null)
      ? Math.round((r.return_180d-bm)*100)/100 : null

    enriched.push({ ...r, sm_alpha, pit_tier: tier })
  }

  const complete = enriched.filter(r => r.sm_alpha!=null)
  console.log(`  ${complete.length.toLocaleString()} buys with complete SM alpha`)

  // ── Walk-forward track record ─────────────────────────────────────────────
  // Key: for trade i at date T, "prior qualifying trades" = same insider,
  // same direction=buy, transaction_date_j + 180d < T (i.e., tj < T - 180d),
  // and sm_alpha_j != null.
  //
  // We sort by date and use that order. For each trade, we scan all trades
  // by the same insider that satisfy tj < T - 180d.
  //
  // Efficiency: group by insider_cik, sort each group by date.
  // For a query at date T: binary search for all entries < (T - 180d).

  console.log('\nComputing walk-forward track records...')

  // Group by insider_cik
  const byInsider = new Map<string, { date: string; sm_alpha: number; txIdx: number }[]>()
  for (let i=0; i<complete.length; i++) {
    const r = complete[i]
    if (!r.insider_cik) continue
    if (!byInsider.has(r.insider_cik)) byInsider.set(r.insider_cik, [])
    if (r.sm_alpha!=null)
      byInsider.get(r.insider_cik)!.push({ date: r.transaction_date, sm_alpha: r.sm_alpha, txIdx: i })
  }
  // Sort each insider's trades by date
  for (const arr of byInsider.values()) arr.sort((a,b)=>a.date<b.date?-1:1)

  // For each trade, find qualifying prior trades (closed before T)
  // prior_trade_date + 180d < current_date  =>  prior_date < current_date - 180d
  const wfPrior = new Array<number|null>(complete.length).fill(null)

  for (const [cik, trades] of byInsider) {
    for (let j=0; j<trades.length; j++) {
      const curr = trades[j]
      const cutoff = addD(curr.date, -180)   // prior trade must be before this date
      // Collect all prior trades (by date) that are strictly before cutoff
      const qualifying: number[] = []
      for (let k=0; k<j; k++) {
        if (trades[k].date < cutoff) qualifying.push(trades[k].sm_alpha)
      }
      // Also check trades after j in index but earlier in date that we may have missed
      // (shouldn't happen since we sorted, but defensively check)
      wfPrior[curr.txIdx] = qualifying.length > 0
        ? qualifying.reduce((a,b)=>a+b,0)/qualifying.length
        : null
    }
  }

  // Attach to complete rows
  type FinalRow = EnrichedBuy & { wf_prior: number|null; bucket: string }
  const final: FinalRow[] = complete.map((r, i) => ({
    ...r,
    wf_prior: wfPrior[i],
    bucket:   trackBucket(wfPrior[i]),
  }))

  const withPrior   = final.filter(r => r.wf_prior!=null)
  const noPrior     = final.filter(r => r.wf_prior==null)
  console.log(`  Trades with prior completed history: ${withPrior.length.toLocaleString()}`)
  console.log(`  Trades with NO prior history:        ${noPrior.length.toLocaleString()}`)
  console.log(`  Prior-history coverage:              ${(withPrior.length/final.length*100).toFixed(1)}%`)

  // ── Print by date range — how coverage grows over time ────────────────────
  console.log('\n  Prior-history coverage by year:')
  for (const yr of [2021,2022,2023,2024,2025]) {
    const yr_rows = final.filter(r=>r.transaction_date.startsWith(String(yr)))
    const yr_with = yr_rows.filter(r=>r.wf_prior!=null)
    console.log(`    ${yr}: ${yr_with.length}/${yr_rows.length} have prior history (${yr_rows.length?((yr_with.length/yr_rows.length)*100).toFixed(0):'—'}%)`)
  }

  // ── BUILD BUCKET TABLE HELPER ─────────────────────────────────────────────

  const BUCKET_ORDER = ['>25%','10–25%','0–10%','Negative (<0%)','No prior history']

  function buildBuckets(rows: FinalRow[]) {
    const data = new Map<string, { fwd_alphas: number[]; fwd_rets: number[]; prior_avgs: number[] }>()
    for (const b of BUCKET_ORDER) data.set(b, { fwd_alphas:[], fwd_rets:[], prior_avgs:[] })
    for (const r of rows) {
      const g = data.get(r.bucket)
      if (!g) continue
      g.fwd_alphas.push(r.sm_alpha!)
      g.fwd_rets.push(r.return_180d!)
      if (r.wf_prior!=null) g.prior_avgs.push(r.wf_prior)
    }
    return data
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 1: ALL BUYS COMBINED
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n\n' + '█'.repeat(96))
  console.log('  WALK-FORWARD TRACK RECORD VALIDATION  (all buys, all classifications)')
  console.log('  Prior track record = avg SM alpha of insider\'s COMPLETED prior buys (closed before T)')
  console.log('  Forward alpha      = SM alpha of the CURRENT trade at T')
  console.log('█'.repeat(96))

  const allBuckets = buildBuckets(final)
  printBucketTable('ALL BUYS — Walk-forward bucket results', allBuckets, BUCKET_ORDER)

  // IC for rows WITH prior (exclude no-prior since no numeric prior value)
  const icPairs = withPrior.filter(r=>r.sm_alpha!=null).map(r=>({ x:r.wf_prior!, y:r.sm_alpha! }))
  const wf_ic_p = pearson(icPairs.map(p=>p.x), icPairs.map(p=>p.y))
  const wf_ic_s = spearman(icPairs.map(p=>p.x), icPairs.map(p=>p.y))

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 2: BY CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n\n' + '█'.repeat(96))
  console.log('  WALK-FORWARD IC BY CLASSIFICATION')
  console.log('█'.repeat(96))

  const IN_SAMPLE_IC: Record<string, number> = {
    OPPORTUNISTIC: 0.5664, UNCLASSIFIABLE: 0.7948, ROUTINE: 0.6824,
  }

  const clsWfICs: { cls: string; wf_p: number; wf_s: number; n_prior: number; n_total: number }[] = []

  for (const cls of ['OPPORTUNISTIC','UNCLASSIFIABLE','ROUTINE']) {
    const clsRows    = final.filter(r => r.classification===cls)
    const clsBuckets = buildBuckets(clsRows)
    printBucketTable(`${cls} — Walk-forward buckets`, clsBuckets, BUCKET_ORDER)

    const pairs = clsRows.filter(r=>r.wf_prior!=null&&r.sm_alpha!=null)
    const wfp   = pearson(pairs.map(r=>r.wf_prior!), pairs.map(r=>r.sm_alpha!))
    const wfs   = spearman(pairs.map(r=>r.wf_prior!), pairs.map(r=>r.sm_alpha!))
    clsWfICs.push({ cls, wf_p: wfp, wf_s: wfs, n_prior: pairs.length, n_total: clsRows.length })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 3: IC COMPARISON TABLE
  // ─────────────────────────────────────────────────────────────────────────

  console.log('\n\n' + '█'.repeat(96))
  console.log('  IC COMPARISON: IN-SAMPLE vs WALK-FORWARD')
  console.log('  In-sample IC used LOO within same dataset (future trades by same insider excluded)')
  console.log('  Walk-forward IC uses ONLY past completed trades — no future information')
  console.log('█'.repeat(96))
  console.log(
    '\n  ' + 'Classification'.padEnd(18) +
    'IS IC'.padStart(9) + '  ' +
    'WF IC (Pearson)'.padStart(17) + '  ' +
    'WF IC (Spearman)'.padStart(18) + '  ' +
    'Shrinkage'.padStart(11) + '  ' +
    'n (with prior)'.padStart(16) + '  ' +
    'n total'.padStart(9)
  )
  console.log('  ' + '─'.repeat(96))

  // Overall
  const wf_all_p = wf_ic_p, wf_all_s = wf_ic_s
  console.log(
    '  ' + 'ALL (combined)'.padEnd(18) +
    'mixed'.padStart(9) + '  ' +
    wf_all_p.toFixed(4).padStart(17) + '  ' +
    wf_all_s.toFixed(4).padStart(18) + '  ' +
    '—'.padStart(11) + '  ' +
    icPairs.length.toLocaleString().padStart(16) + '  ' +
    final.length.toLocaleString().padStart(9)
  )

  for (const { cls, wf_p, wf_s, n_prior, n_total } of clsWfICs) {
    const is_ic  = IN_SAMPLE_IC[cls] ?? NaN
    const shrink = isNaN(is_ic)||isNaN(wf_p) ? '—' : ((1 - Math.abs(wf_p)/Math.abs(is_ic))*100).toFixed(0)+'%'
    const verdict = isNaN(wf_p) ? '—'
      : Math.abs(wf_p) > 0.3 ? '★ strong — signal is real'
      : Math.abs(wf_p) > 0.1 ? '✓ moderate — meaningful signal'
      : '· weak — mostly memorization'
    console.log(
      '  ' + cls.slice(0,17).padEnd(18) +
      is_ic.toFixed(4).padStart(9) + '  ' +
      wf_p.toFixed(4).padStart(17) + '  ' +
      wf_s.toFixed(4).padStart(18) + '  ' +
      shrink.padStart(11) + '  ' +
      n_prior.toLocaleString().padStart(16) + '  ' +
      n_total.toLocaleString().padStart(9) +
      '   ' + verdict
    )
  }

  // ── Interpretation notes ──────────────────────────────────────────────────
  console.log('\n  ── KEY QUESTIONS ────────────────────────────────────────────────────────')

  // Does >25% bucket still beat?
  const gt25 = withPrior.filter(r=>r.bucket==='>25%')
  const neg  = withPrior.filter(r=>r.bucket==='Negative (<0%)')
  const m25  = mean(gt25.map(r=>r.sm_alpha!))
  const mneg = mean(neg.map(r=>r.sm_alpha!))
  console.log(`\n  1. Does the >25% prior bucket still outperform FORWARD?`)
  console.log(`     >25% bucket  — n=${gt25.length}  mean fwd α = ${m25!=null?((m25>=0?'+':'')+m25.toFixed(2)+'%'):'N/A'}`)
  console.log(`     Negative bucket — n=${neg.length}  mean fwd α = ${mneg!=null?((mneg>=0?'+':'')+mneg.toFixed(2)+'%'):'N/A'}`)
  console.log(`     Spread: ${m25!=null&&mneg!=null ? ((m25-mneg)>=0?'+':'')+((m25-mneg!).toFixed(2))+'pp' : 'N/A'}`)

  console.log(`\n  2. IC shrinkage (IS → WF):`)
  for (const { cls, wf_p } of clsWfICs) {
    const is = IN_SAMPLE_IC[cls]??NaN
    if (!isNaN(wf_p) && !isNaN(is))
      console.log(`     ${cls.padEnd(18)} ${is.toFixed(3)} → ${wf_p.toFixed(3)}   (${((1-Math.abs(wf_p)/Math.abs(is))*100).toFixed(0)}% shrinkage)`)
  }

  console.log(`\n  3. Sample size impact: ${withPrior.length.toLocaleString()} / ${final.length.toLocaleString()} trades have prior history (${(withPrior.length/final.length*100).toFixed(1)}%)`)
  console.log(`     The ${noPrior.length.toLocaleString()} no-prior trades have mean fwd α = ${fmt(mean(noPrior.map(r=>r.sm_alpha!)))} (would be unscored on this factor)`)

  console.log('\n' + '█'.repeat(96) + '\n')
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
