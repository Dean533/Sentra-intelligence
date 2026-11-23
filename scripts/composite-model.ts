// Run with:  npx tsx scripts/composite-model.ts
//
// Builds a weighted IC z-score composite model SEPARATELY for each
// classification (OPPORTUNISTIC, UNCLASSIFIABLE, ROUTINE), buys only.
//
// For each classification independently:
//   1. Compute size-matched alpha per trade (IWM/MDY/SPY by PIT tier)
//   2. Encode 6 factors as numeric values within that classification:
//        F1 Track Record   — LOO SM alpha per insider (continuous)
//        F2 PIT Cap Tier   — LOO group-mean SM alpha by tier (categorical→numeric)
//        F3 Sector         — LOO group-mean SM alpha by sector (categorical→numeric)
//        F4 Role           — LOO group-mean SM alpha by role (categorical→numeric)
//        F5 log Trade Size — log10(total_value) (continuous)
//        F6 Stake Increase — log1p(shares/before * 100) (continuous)
//   3. Z-score each factor across ALL trades in that classification
//   4. IC_i = Pearson(factor_z_i, sm_alpha) within that classification
//   5. Composite raw = Σ IC_i × z_i
//   6. Map composite to 0–100 percentile rank within classification
//
// ⚠ Retroactive 2026 classification (lookahead bias) = optimistic ceiling.
//
// Output per classification:
//   A. Factor IC ranking table
//   B. Score decile validation (D1 = bottom 10% → D10 = top 10%)

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
    const eq = t.indexOf('='); if (eq === -1) continue
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

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(line: string): string[] {
  const f: string[] = []; let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++ } else inQ = !inQ }
    else if (ch === ',' && !inQ) { f.push(cur); cur = '' }
    else cur += ch
  }
  f.push(cur); return f
}

function pn(v: string): number | null { const n = parseFloat(v); return isNaN(n) ? null : n }

// ─── Price helpers ────────────────────────────────────────────────────────────

function buildPriceMap(quotes: any[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const q of quotes)
    if (q?.date != null && (q?.adjClose ?? q?.close) != null)
      m.set(new Date(q.date).toISOString().split('T')[0], q.adjClose ?? q.close)
  return m
}

function lookupP(m: Map<string, number>, d: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const dt = new Date(d); dt.setUTCDate(dt.getUTCDate() + i)
    const p = m.get(dt.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

function addD(s: string, n: number): string {
  const d = new Date(s); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

// ─── PIT helpers ─────────────────────────────────────────────────────────────

function pitTier(mc: number | null): string {
  if (mc == null)  return 'No data'
  if (mc < 300e6)  return 'Micro'
  if (mc < 2e9)    return 'Small'
  if (mc < 10e9)   return 'Mid'
  if (mc < 200e9)  return 'Large'
  return             'Mega'
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length; if (n < 3) return 0
  const mx = xs.reduce((a,b) => a+b,0)/n, my = ys.reduce((a,b) => a+b,0)/n
  let cov = 0, sx = 0, sy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]-mx, dy = ys[i]-my
    cov += dx*dy; sx += dx*dx; sy += dy*dy
  }
  const denom = Math.sqrt(sx*sy)
  return denom < 1e-12 ? 0 : cov/denom
}

function mean(xs: number[]): number { return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0 }
function std(xs: number[]): number {
  if (xs.length < 2) return 1
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a,b) => a+(b-m)**2, 0) / xs.length) || 1
}
function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a,b)=>a-b), m = Math.floor(s.length/2)
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2
}

// ─── LOO group mean (categorical factor encoding) ─────────────────────────────
// For each trade i in group g: value = (sum_g - alpha_i) / (n_g - 1)
// Avoids in-group contamination that inflates IC.

function looGroupMeans(
  groups: Map<string, number[]>,
  memberAlphas: number[]
): number[] {
  // groups: key → list of alpha values in group (in order of all-rows)
  // We need a flat mapping: for each row, what's its group's LOO mean?
  // This function is only called once; use index trick below instead.
  return memberAlphas
}

function buildLooGroupMap(
  rows: { key: string; alpha: number }[]
): number[] {
  const byKey = new Map<string, { sum: number; n: number; alphas: number[] }>()
  for (const { key, alpha } of rows) {
    if (!byKey.has(key)) byKey.set(key, { sum: 0, n: 0, alphas: [] })
    const g = byKey.get(key)!
    g.sum += alpha; g.n++; g.alphas.push(alpha)
  }

  const result: number[] = []
  const keyIdx = new Map<string, number>()  // per-key cursor
  for (const { key, alpha } of rows) {
    const g = byKey.get(key)!
    const j = keyIdx.get(key) ?? 0
    keyIdx.set(key, j+1)
    if (g.n === 1) { result.push(NaN); continue }
    const loo = (g.sum - alpha) / (g.n - 1)
    result.push(loo)
  }
  return result
}

// ─── Rank to 0–100 ───────────────────────────────────────────────────────────

function rankTo100(values: number[]): number[] {
  const n    = values.length
  const rank = values.map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v)
    .map((_, rank) => rank)

  const out = new Array<number>(n)
  const sorted = values.map((v, i) => ({ v, i })).sort((a,b) => a.v - b.v)
  for (let r = 0; r < n; r++) out[sorted[r].i] = Math.round((r / (n-1)) * 100)
  return out
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')

  // ── Load CSV ──────────────────────────────────────────────────────────────
  console.log('Reading CSV...')
  const lines   = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsv(lines[0])
  const idx     = (n: string) => headers.indexOf(n)

  const C = {
    insider_cik:        idx('insider_cik'),
    ticker:             idx('ticker'),
    classification:     idx('classification'),
    direction:          idx('direction'),
    transaction_date:   idx('transaction_date'),
    price_entry:        idx('price_entry'),
    total_value:        idx('total_value'),
    shares:             idx('shares'),
    shares_owned_after: idx('shares_owned_after'),
    return_180d:        idx('return_180d'),
    spy_return_180d:    idx('spy_return_180d'),
    role_classified:    idx('role_classified'),
    sector:             idx('sector'),
  }
  const missing = Object.entries(C).filter(([,v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing columns:', missing); process.exit(1) }

  type RawRow = {
    insider_cik: string; ticker: string; classification: string; direction: string
    transaction_date: string; price_entry: number | null; total_value: number | null
    shares: number | null; shares_owned_after: number | null
    return_180d: number | null; spy_return_180d: number | null
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

  const allBuys = rawRows.filter(r => r.direction === 'buy' && r.return_180d != null)
  console.log(`  ${rawRows.length.toLocaleString()} total rows → ${allBuys.length.toLocaleString()} buys with 180d data`)

  // ── Market caps ───────────────────────────────────────────────────────────
  console.log('Fetching market caps...')
  const mcMap = new Map<string, number | null>()
  const tickers = [...new Set(rawRows.map(r => r.ticker))]
  for (let i = 0; i < tickers.length; i += 500) {
    const { data } = await supabase.from('tickers').select('symbol,market_cap').in('symbol', tickers.slice(i, i+500))
    for (const r of data ?? []) mcMap.set((r as any).symbol, (r as any).market_cap ?? null)
  }

  const latestPrice = new Map<string, number>()
  for (const r of rawRows)
    if (r.price_entry != null) {
      const cur = latestPrice.get(r.ticker)
      if (!cur || r.price_entry > cur) latestPrice.set(r.ticker, r.price_entry)
    }

  // ── Fetch MDY + IWM ───────────────────────────────────────────────────────
  const allDates   = rawRows.map(r => r.transaction_date).filter(Boolean).sort()
  const fetchStart = new Date('2021-01-01')
  const fetchEnd   = new Date(addD(allDates[allDates.length-1], 195))

  console.log('Fetching MDY...')
  await slp(300)
  let mdyMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('MDY', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    mdyMap = buildPriceMap(Array.isArray(ch?.quotes) ? ch.quotes : [])
    console.log(`  ${mdyMap.size} MDY points`)
  } catch (e: any) { console.error('MDY failed:', e.message); process.exit(1) }

  await slp(300)
  console.log('Fetching IWM...')
  let iwmMap = new Map<string, number>()
  try {
    const ch: any = await yf.chart('IWM', { period1: fetchStart, period2: fetchEnd, interval: '1d' })
    iwmMap = buildPriceMap(Array.isArray(ch?.quotes) ? ch.quotes : [])
    console.log(`  ${iwmMap.size} IWM points`)
  } catch (e: any) { console.error('IWM failed:', e.message); process.exit(1) }

  // ── Enrich all buys ───────────────────────────────────────────────────────
  type EnrichedRow = RawRow & {
    pit_tier: string
    sm_alpha: number | null        // size-matched alpha 180d
    stake_pct: number | null       // shares / before * 100
    log_trade_size: number | null  // log10(total_value)
  }

  const enriched: EnrichedRow[] = []
  for (const r of allBuys) {
    // PIT market cap
    const mc_t = mcMap.get(r.ticker) ?? null
    const p_t  = latestPrice.get(r.ticker) ?? null
    let mc_pit: number | null = null
    if (mc_t != null && p_t != null && p_t > 0 && r.price_entry != null && r.price_entry > 0)
      mc_pit = (mc_t / p_t) * r.price_entry
    const tier = pitTier(mc_pit)

    // Size-matched benchmark return
    let bm_ret: number | null = null
    if (tier === 'Large' || tier === 'Mega') {
      bm_ret = r.spy_return_180d ?? null
    } else if (tier === 'Mid') {
      const p0 = lookupP(mdyMap, r.transaction_date), p1 = lookupP(mdyMap, addD(r.transaction_date, 180))
      bm_ret = (p0 && p1) ? Math.round(((p1-p0)/p0)*10000)/100 : null
    } else {
      const p0 = lookupP(iwmMap, r.transaction_date), p1 = lookupP(iwmMap, addD(r.transaction_date, 180))
      bm_ret = (p0 && p1) ? Math.round(((p1-p0)/p0)*10000)/100 : null
    }

    const sm_alpha = (r.return_180d != null && bm_ret != null)
      ? Math.round((r.return_180d - bm_ret) * 100) / 100
      : null

    // Stake pct
    let stake_pct: number | null = null
    if (r.shares != null && r.shares_owned_after != null && r.shares > 0) {
      const before = r.shares_owned_after - r.shares
      if (before > 0) stake_pct = (r.shares / before) * 100
    }

    const log_trade_size = (r.total_value != null && r.total_value > 0) ? Math.log10(r.total_value) : null

    enriched.push({ ...r, pit_tier: tier, sm_alpha, stake_pct, log_trade_size })
  }

  const complete = enriched.filter(r => r.sm_alpha != null)
  console.log(`\n  ${complete.length.toLocaleString()} buys with complete size-matched alpha`)

  // ─────────────────────────────────────────────────────────────────────────
  // PROCESS EACH CLASSIFICATION
  // ─────────────────────────────────────────────────────────────────────────

  const CLASSIFICATIONS = ['OPPORTUNISTIC', 'UNCLASSIFIABLE', 'ROUTINE'] as const
  const CLS_LABEL: Record<string, string> = {
    OPPORTUNISTIC:  'OPPORTUNISTIC  (green — product signal)',
    UNCLASSIFIABLE: 'UNCLASSIFIABLE  (yellow — product signal)',
    ROUTINE:        'ROUTINE  (red — product signal)',
  }

  console.log('\n' + '█'.repeat(116))
  console.log('  COMPOSITE IC Z-SCORE MODEL — SEPARATE PER CLASSIFICATION (buys only)')
  console.log('  Retroactive 2026 CMP classification — OPTIMISTIC CEILING, not live signal')
  console.log('█'.repeat(116))

  for (const CLS of CLASSIFICATIONS) {
    const rows = complete.filter(r => r.classification === CLS)
    if (rows.length < 50) { console.log(`\n${CLS}: only ${rows.length} rows — skipping`); continue }
    console.log(`\n\n${'═'.repeat(116)}`)
    console.log(`  ${CLS_LABEL[CLS]}   (n = ${rows.length.toLocaleString()} buys)`)
    console.log('═'.repeat(116))

    const alphas = rows.map(r => r.sm_alpha!)

    // ── F1: Track Record (LOO SM alpha per insider within this classification) ──
    // Group by insider_cik within this CLS×buy set
    const byCik = new Map<string, { idxs: number[]; alphas: number[] }>()
    for (let i = 0; i < rows.length; i++) {
      const cik = rows[i].insider_cik; if (!cik) continue
      if (!byCik.has(cik)) byCik.set(cik, { idxs: [], alphas: [] })
      byCik.get(cik)!.idxs.push(i); byCik.get(cik)!.alphas.push(rows[i].sm_alpha!)
    }
    const f1Raw = new Array<number | null>(rows.length).fill(null)
    for (const { idxs, alphas: ca } of byCik.values()) {
      const total = ca.reduce((a,b) => a+b, 0)
      for (let j = 0; j < idxs.length; j++) {
        const my = ca[j]
        f1Raw[idxs[j]] = ca.length > 1 ? (total - my) / (ca.length - 1) : null
      }
    }

    // ── F2: PIT tier (LOO group mean) ──────────────────────────────────────
    const f2Input = rows.map((r, i) => ({ key: r.pit_tier, alpha: alphas[i] }))
    const f2Raw   = buildLooGroupMap(f2Input)

    // ── F3: Sector (LOO group mean) ────────────────────────────────────────
    const f3Input = rows.map((r, i) => ({ key: r.sector || 'Unknown', alpha: alphas[i] }))
    const f3Raw   = buildLooGroupMap(f3Input)

    // ── F4: Role (LOO group mean) ──────────────────────────────────────────
    const f4Input = rows.map((r, i) => ({ key: r.role_classified || 'Other/EVP', alpha: alphas[i] }))
    const f4Raw   = buildLooGroupMap(f4Input)

    // ── F5: log Trade Size ─────────────────────────────────────────────────
    const f5Raw = rows.map(r => r.log_trade_size)

    // ── F6: Stake Increase (log1p of pct) ──────────────────────────────────
    const f6Raw = rows.map(r => r.stake_pct != null ? Math.log1p(Math.min(r.stake_pct, 1000)) : null)

    // ── Build aligned arrays (drop rows missing any factor) ────────────────
    const FACTOR_NAMES = ['TrackRecord','PITCapTier','Sector','Role','logTradeSize','StakeIncrease']
    const rawFactors   = [f1Raw, f2Raw, f3Raw, f4Raw, f5Raw, f6Raw]

    // For IC computation, for each factor independently pair valid rows
    // For composite, drop rows missing ANY factor (to keep them comparable)
    const validMask = rows.map((_, i) =>
      rawFactors.every(f => f[i] != null && isFinite(f[i] as number))
    )
    const nFull = validMask.filter(Boolean).length
    console.log(`  Rows with all 6 factors present: ${nFull.toLocaleString()} / ${rows.length.toLocaleString()}`)

    // ── Per-factor IC (computed on rows where THAT factor is valid) ────────
    console.log(`\n  ── A. FACTOR IC RANKING (Pearson IC with size-matched alpha) ──`)
    console.log(`  ${'Factor'.padEnd(20)}  ${'IC'.padStart(8)}  ${'n'.padStart(7)}  ${'|IC|'.padStart(8)}  note`)

    const factorICs: { name: string; ic: number; n: number }[] = []
    for (let fi = 0; fi < rawFactors.length; fi++) {
      const rf = rawFactors[fi]
      const pairs: [number, number][] = []
      for (let i = 0; i < rows.length; i++) {
        const fv = rf[i]
        if (fv != null && isFinite(fv) && alphas[i] != null) pairs.push([fv, alphas[i]])
      }
      const ic = pearson(pairs.map(p => p[0]), pairs.map(p => p[1]))
      factorICs.push({ name: FACTOR_NAMES[fi], ic, n: pairs.length })
    }
    factorICs.sort((a, b) => Math.abs(b.ic) - Math.abs(a.ic))

    for (const { name, ic, n } of factorICs) {
      const note = Math.abs(ic) > 0.1 ? '★ strong' : Math.abs(ic) > 0.05 ? '✓ moderate' : '· weak'
      console.log(`  ${name.padEnd(20)}  ${ic.toFixed(4).padStart(8)}  ${n.toLocaleString().padStart(7)}  ${Math.abs(ic).toFixed(4).padStart(8)}  ${note}`)
    }

    // ── Build composite for all-factor-valid rows ──────────────────────────
    // Retrieve ICs in original factor order
    const icByName = new Map(factorICs.map(f => [f.name, f.ic]))
    const orderedICs = FACTOR_NAMES.map(n => icByName.get(n)!)

    // Z-score each factor within the full-valid subset
    const validIdxs = rows.map((_, i) => i).filter(i => validMask[i])
    const subRows   = validIdxs.map(i => rows[i])
    const subAlphas = validIdxs.map(i => alphas[i])
    const subFactors = rawFactors.map(rf => validIdxs.map(i => rf[i] as number))

    const zFactors = subFactors.map(fvals => {
      const m = mean(fvals), s = std(fvals)
      return fvals.map(v => (v - m) / s)
    })

    // Composite = Σ IC_i × z_i
    const composites = subRows.map((_, si) =>
      orderedICs.reduce((sum, ic, fi) => sum + ic * zFactors[fi][si], 0)
    )

    // Map to 0–100 percentile within classification
    const scores = rankTo100(composites)

    // ── Decile validation ──────────────────────────────────────────────────
    console.log(`\n  ── B. SCORE DECILE VALIDATION (D1=bottom 10% → D10=top 10%) ──`)
    console.log(`  ${'Decile'.padEnd(10)}  ${'n'.padStart(6)}  ${'Win%'.padStart(7)}  ${'Med Ret'.padStart(9)}  ${'Med α(SM)'.padStart(11)}  ${'Mean α(SM)'.padStart(11)}  ${'Cum P&L $100ea'.padStart(16)}`)
    console.log('  ' + '─'.repeat(82))

    for (let d = 10; d >= 1; d--) {
      const lo = (d-1) * 10, hi = d * 10
      const decileIdxs = scores.map((s, i) => ({ s, i })).filter(({ s }) => {
        if (d === 1)  return s <= hi
        if (d === 10) return s >  lo
        return s > lo && s <= hi
      }).map(({ i }) => i)

      const decileAlphas = decileIdxs.map(i => subAlphas[i])
      const decileRets   = decileIdxs.map(i => subRows[i].return_180d!)
      const wins         = decileRets.filter(r => r > 0).length
      const wr           = decileIdxs.length ? wins / decileIdxs.length * 100 : 0
      const med_alpha    = median(decileAlphas)
      const mean_alpha   = mean(decileAlphas)
      const med_ret      = median(decileRets)
      const totalEnd     = decileRets.reduce((s, r) => s + 100*(1+r/100), 0)
      const totalIn      = decileIdxs.length * 100
      const pnl          = totalEnd - totalIn

      const s_da = (v: number | null, dp=2) => v == null ? '  N/A' : (v>=0?'+':'')+v.toFixed(dp)+'%'
      const sdol = (v: number) => (v>=0?'+$':'-$')+Math.abs(Math.round(v)).toLocaleString()

      console.log(
        `  D${String(d).padEnd(9)}  ${String(decileIdxs.length).padStart(6)}  ` +
        `${pct1(wr).padStart(7)}  ` +
        `${s_da(med_ret,1).padStart(9)}  ` +
        `${s_da(med_alpha).padStart(11)}  ` +
        `${s_da(mean_alpha).padStart(11)}  ` +
        `${sdol(pnl).padStart(16)}`
      )
    }

    // Monotonicity check: correlation of decile rank vs mean alpha
    const decileMeans: number[] = []
    for (let d = 1; d <= 10; d++) {
      const lo = (d-1)*10, hi = d*10
      const da = scores.map((s,i) => ({s,i}))
        .filter(({s}) => d===1?s<=hi:d===10?s>lo:s>lo&&s<=hi)
        .map(({i}) => subAlphas[i])
      decileMeans.push(mean(da))
    }
    const mono = pearson([1,2,3,4,5,6,7,8,9,10], decileMeans)
    console.log(`\n  Monotonicity: Pearson(decile_rank, mean_alpha) = ${mono.toFixed(3)}  ${
      Math.abs(mono) > 0.85 ? '★ strong monotonic' : Math.abs(mono) > 0.6 ? '✓ moderate' : '· weak — model not monotonic within this classification'
    }`)

    // Overall for this classification
    const allRets = subRows.map(r => r.return_180d!)
    const allEnd  = allRets.reduce((s, r) => s + 100*(1+r/100), 0)
    const allIn   = subRows.length * 100
    const allWin  = allRets.filter(r => r>0).length
    console.log(`\n  All ${CLS} buys (n=${subRows.length}): invested $${allIn.toLocaleString()}  end $${Math.round(allEnd).toLocaleString()}  P&L ${allEnd>=allIn?'+$':'-$'}${Math.abs(Math.round(allEnd-allIn)).toLocaleString()}  win ${(allWin/subRows.length*100).toFixed(1)}%`)

    // Top 20% summary
    const top20 = scores.map((s,i)=>({s,i})).filter(({s})=>s>80)
    const top20Rets   = top20.map(({i}) => subRows[i].return_180d!)
    const top20Alphas = top20.map(({i}) => subAlphas[i])
    const top20End    = top20Rets.reduce((s,r)=>s+100*(1+r/100),0)
    const top20In     = top20.length*100
    console.log(`  Top 20% (score 80–100, n=${top20.length}): invested $${top20In.toLocaleString()}  end $${Math.round(top20End).toLocaleString()}  P&L ${top20End>=top20In?'+$':'-$'}${Math.abs(Math.round(top20End-top20In)).toLocaleString()}  med α(SM) ${s_da_local(median(top20Alphas))}  win ${(top20Rets.filter(r=>r>0).length/top20.length*100).toFixed(1)}%`)

    function s_da_local(v: number | null, dp=2): string {
      return v == null ? 'N/A' : (v>=0?'+':'')+v.toFixed(dp)+'%'
    }
  }

  console.log('\n' + '█'.repeat(116) + '\n')
}

function pct1(v: number): string { return (v>=0?'+':'')+v.toFixed(1)+'%' }

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
