// ══════════════════════════════════════════════════════════════════════════════
//  HINDSIGHT-BIASED FILTER SEARCH — FOR EDUCATION ONLY
//  ─────────────────────────────────────────────────────
//  Exhaustively grid-searches filter combinations over the OOS signal window
//  (2026-05-01 to today) to find combos with the highest raw return.
//
//  PURPOSE: Show how sample sizes collapse as filters tighten to chase returns.
//           The "best" combos are almost certainly overfitted to a lucky handful
//           of trades. This is explicitly demonstrated in the output.
//
//  DO NOT USE FOR LIVE TRADING.
//
//  npx tsx scripts/overfit-scan.ts
// ══════════════════════════════════════════════════════════════════════════════

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ── Env ───────────────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '..', '.env.local')
for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('='); if (eq < 0) continue
  const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  if (!process.env[k]) process.env[k] = v
}

const sb    = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)
const yf    = new YahooFinance()
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Config ────────────────────────────────────────────────────────────────────

const CUTOFF            = '2026-05-01'
const TODAY             = new Date().toISOString().split('T')[0]
const OUTLIER_THRESHOLD = 200  // |return| > this = excluded from averages (filing error)
const MIN_N             = 3    // skip combos with fewer than this many trades

// Grid axes
const SCORE_THRESHOLDS  = [60, 70, 80, 85, 90]
const CLASSIFICATIONS   = ['OPPORTUNISTIC', 'UNCLASSIFIABLE', 'BOTH'] as const
const MCAP_FILTERS      = ['mega', 'large', 'mid', 'small', 'micro', 'any'] as const
const ROLE_FILTERS      = ['CEO', 'CFO', '10%_OWNER', 'DIRECTOR', 'C-SUITE', 'any'] as const
const MATURITY_DAYS     = [30, 60, 90] as const

// Market cap band thresholds (current market cap from tickers table, not time-of-trade)
const MCAP_BANDS: { label: string; min: number; max: number }[] = [
  { label: 'mega',  min: 200e9,  max: Infinity },
  { label: 'large', min: 10e9,   max: 200e9    },
  { label: 'mid',   min: 2e9,    max: 10e9     },
  { label: 'small', min: 300e6,  max: 2e9      },
  { label: 'micro', min: 0,      max: 300e6    },
]

// ── Role classification ───────────────────────────────────────────────────────

function classifyRole(officerTitle: string | null, isDirector: boolean | null): string {
  const t = ((officerTitle ?? '') + ' ').toLowerCase()
  if (t.includes('chief executive') || / ceo[ ,]/.test(t) || t.startsWith('ceo ')) return 'CEO'
  if (t.includes('chief financial') || / cfo[ ,]/.test(t) || t.startsWith('cfo ')) return 'CFO'
  if (t.includes('10%') || t.includes('ten percent') || t.includes('10 percent'))   return '10%_OWNER'
  if (isDirector) return 'DIRECTOR'
  if (t.includes('chief')) return 'C-SUITE'
  return 'OTHER'
}

function getMcapBand(marketCap: number | null): string {
  if (marketCap == null) return 'unknown'
  for (const b of MCAP_BANDS) {
    if (marketCap >= b.min && marketCap < b.max) return b.label
  }
  return 'unknown'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}
function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null }
function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function pct(v: number | null, d = 1) { if (v == null) return 'N/A'; return (v >= 0 ? '+' : '') + v.toFixed(d) + '%' }
function pad(s: string | number, n: number) { return String(s).padStart(n) }
function padR(s: string | number, n: number) { return String(s).padEnd(n) }

// ── DB fetch ──────────────────────────────────────────────────────────────────

interface RawSignal {
  id: string; ticker: string; transaction_date: string; conviction_score: number
  classification: string; price_per_share: number | null; total_value: number | null
  officer_title: string | null; is_director: boolean | null; role: string | null
}

async function fetchSignals(): Promise<RawSignal[]> {
  const PAGE = 1000, all: RawSignal[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('insider_transactions')
      .select('id, ticker, transaction_date, conviction_score, classification, price_per_share, total_value, officer_title, is_director, role')
      .eq('transaction_code', 'P')
      .gte('transaction_date', CUTOFF)
      .not('conviction_score', 'is', null)
      .in('classification', ['OPPORTUNISTIC', 'UNCLASSIFIABLE'])
      .order('transaction_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || !data.length) break
    for (const r of data) all.push(r as RawSignal)
    if (data.length < PAGE) break
  }
  return all
}

async function fetchMarketCaps(symbols: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>()
  const unique = [...new Set(symbols)]
  const PAGE = 500
  for (let from = 0; from < unique.length; from += PAGE) {
    const batch = unique.slice(from, from + PAGE)
    const { data, error } = await sb
      .from('tickers')
      .select('symbol, market_cap')
      .in('symbol', batch)
    if (error) { console.warn('  market_cap fetch error:', error.message); break }
    for (const row of data ?? []) map.set(row.symbol, row.market_cap ?? null)
  }
  return map
}

async function fetchCurrentPrices(symbols: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>()
  const unique = [...new Set(symbols)]
  const BATCH = 20
  let fetched = 0
  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH)
    try {
      const res = await yf.quote(batch as any, {}, { validateResult: false }) as any
      const quotes = Array.isArray(res) ? res : [res]
      for (let j = 0; j < batch.length; j++) {
        const q = quotes[j]; map.set(batch[j], q?.regularMarketPrice ?? null); fetched++
      }
    } catch { for (const s of batch) { map.set(s, null) } }
    if (i + BATCH < unique.length) await sleep(400)
    if ((i / BATCH + 1) % 10 === 0) process.stdout.write(`\r  Current prices: ${fetched}/${unique.length}`)
  }
  console.log(`\r  Current prices: ${fetched}/${unique.length} done`)
  return map
}

async function fetchSpyPrices(startDate: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const d0 = new Date(startDate); d0.setUTCDate(d0.getUTCDate() - 5)
  const d1 = new Date(); d1.setUTCDate(d1.getUTCDate() + 1)
  try {
    const ch: any = await yf.chart('SPY', { period1: d0, period2: d1, interval: '1d' })
    for (const q of ch?.quotes ?? []) {
      if (q?.date && (q.adjClose ?? q.close) != null)
        map.set(new Date(q.date).toISOString().split('T')[0], q.adjClose ?? q.close)
    }
  } catch (e: any) { console.warn('  SPY fetch failed:', e.message) }
  return map
}

// Forward lookup — entry date: find first trading day on or after date
function lookupSpyPrice(spyMap: Map<string, number>, date: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(date); d.setUTCDate(d.getUTCDate() + i)
    const p = spyMap.get(d.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

// Backward lookup — "today": find last trading day on or before date
function lookupSpyPriceBack(spyMap: Map<string, number>, date: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(date); d.setUTCDate(d.getUTCDate() - i)
    const p = spyMap.get(d.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

// ── Enriched signal ───────────────────────────────────────────────────────────

interface Signal {
  ticker: string; date: string; score: number; classification: string
  roleLabel: string; mcapBand: string; marketCap: number | null
  daysElapsed: number; rawReturn: number | null; spyReturn: number | null
  alpha: number | null; outlier: boolean; missingPrice: boolean
}

// ── Grid search ───────────────────────────────────────────────────────────────

interface ComboResult {
  scoreMin: number; cls: string; mcap: string; role: string; maturity: number
  n: number; avgRaw: number; medRaw: number; avgAlpha: number; medAlpha: number
  beatPct: number   // % that beat SPY
}

function gridSearch(signals: Signal[]): ComboResult[] {
  const results: ComboResult[] = []

  for (const scoreMin of SCORE_THRESHOLDS) {
    for (const cls of CLASSIFICATIONS) {
      for (const mcap of MCAP_FILTERS) {
        for (const role of ROLE_FILTERS) {
          for (const maturity of MATURITY_DAYS) {

            const subset = signals.filter(s =>
              s.score >= scoreMin &&
              (cls === 'BOTH' || s.classification === cls) &&
              (mcap === 'any' || s.mcapBand === mcap) &&
              (role === 'any' || s.roleLabel === role) &&
              s.daysElapsed >= maturity &&
              !s.missingPrice &&
              s.rawReturn != null &&
              !s.outlier &&
              s.alpha != null
            )

            if (subset.length < MIN_N) continue

            const raws   = subset.map(s => s.rawReturn!)
            const alphas = subset.map(s => s.alpha!)
            const beaten = subset.filter(s => s.alpha! > 0).length

            results.push({
              scoreMin, cls, mcap, role, maturity,
              n:         subset.length,
              avgRaw:    avg(raws)!,
              medRaw:    median(raws)!,
              avgAlpha:  avg(alphas)!,
              medAlpha:  median(alphas)!,
              beatPct:   (beaten / subset.length) * 100,
            })
          }
        }
      }
    }
  }

  return results
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtCombo(c: ComboResult): string {
  const cls  = c.cls === 'BOTH' ? 'OPP+UNCL' : (c.cls === 'OPPORTUNISTIC' ? 'OPP     ' : 'UNCL    ')
  const mcap = padR(c.mcap, 6)
  const role = padR(c.role, 10)
  const held = `≥${c.maturity}d`
  return `score≥${pad(c.scoreMin,2)}  ${cls}  mcap=${mcap}  role=${padR(role,10)}  held=${held}`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║  ⚠  HINDSIGHT-BIASED FILTER SEARCH — FOR EDUCATION ONLY  ⚠     ║')
  console.log('║  Every number below was optimised after seeing the outcomes.    ║')
  console.log('║  High returns almost always come from tiny, lucky samples.      ║')
  console.log('║  DO NOT use these filters for live trading.                     ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')
  console.log()
  console.log(`  Window: ${CUTOFF} → ${TODAY}`)
  console.log()

  // 1. Fetch raw signals
  process.stdout.write('  Fetching signals from DB...')
  const raw = await fetchSignals()
  console.log(` ${raw.length} signals`)

  const tickers = [...new Set(raw.map(r => r.ticker))]
  console.log(`  ${tickers.length} unique tickers`)

  // 2. Market caps
  process.stdout.write('  Fetching market caps...')
  const mcapMap = await fetchMarketCaps(tickers)
  const mcapCoverage = [...mcapMap.values()].filter(v => v != null).length
  console.log(` ${mcapCoverage}/${tickers.length} tickers have market cap`)

  // 3. Current prices
  console.log('  Fetching current prices...')
  const priceMap = await fetchCurrentPrices(tickers)

  // 4. SPY prices
  process.stdout.write('  Fetching SPY history...')
  const spyMap = await fetchSpyPrices(CUTOFF)
  const spyToday = lookupSpyPriceBack(spyMap, TODAY)
  console.log(` ${spyMap.size} trading days. SPY today≈${spyToday?.toFixed(2)}`)

  // 5. Enrich
  const signals: Signal[] = []
  for (const r of raw) {
    const daysElapsed   = daysBetween(r.transaction_date, TODAY)
    const entryPrice    = r.price_per_share
    const currentPrice  = priceMap.get(r.ticker) ?? null
    const missingPrice  = entryPrice == null || currentPrice == null || entryPrice <= 0
    const rawReturn     = missingPrice ? null : (currentPrice! - entryPrice!) / entryPrice! * 100
    const outlier       = rawReturn != null && Math.abs(rawReturn) > OUTLIER_THRESHOLD
    const spyEntry      = lookupSpyPrice(spyMap, r.transaction_date)
    const spyReturn     = (spyEntry != null && spyToday != null)
                          ? (spyToday - spyEntry) / spyEntry * 100 : null
    const alpha         = (rawReturn != null && spyReturn != null) ? rawReturn - spyReturn : null
    const marketCap     = mcapMap.get(r.ticker) ?? null

    signals.push({
      ticker:         r.ticker,
      date:           r.transaction_date,
      score:          r.conviction_score,
      classification: r.classification,
      roleLabel:      classifyRole(r.officer_title, r.is_director),
      mcapBand:       getMcapBand(marketCap),
      marketCap,
      daysElapsed,
      rawReturn,
      spyReturn,
      alpha,
      outlier,
      missingPrice,
    })
  }

  // Summary stats
  const mature = signals.filter(s => s.daysElapsed >= 30 && !s.missingPrice && !s.outlier)
  console.log()
  console.log(`  ${signals.length} total signals enriched`)
  console.log(`  ${mature.length} mature (≥30d, non-outlier) used in grid search`)
  console.log(`  ${signals.filter(s => s.outlier).length} outliers excluded (|return| > ${OUTLIER_THRESHOLD}%)`)
  console.log(`  ${signals.filter(s => s.missingPrice).length} missing entry/current price`)

  // Role distribution
  const roleCount = new Map<string, number>()
  for (const s of mature) roleCount.set(s.roleLabel, (roleCount.get(s.roleLabel) ?? 0) + 1)
  console.log()
  console.log('  Role distribution (mature trades):')
  for (const [role, n] of [...roleCount.entries()].sort((a,b) => b[1]-a[1]))
    console.log(`    ${padR(role, 12)} ${n}`)

  // Market cap distribution
  const mcapCount = new Map<string, number>()
  for (const s of mature) mcapCount.set(s.mcapBand, (mcapCount.get(s.mcapBand) ?? 0) + 1)
  console.log()
  console.log('  Market cap distribution (mature trades):')
  for (const band of [...MCAP_BANDS.map(b=>b.label), 'unknown'])
    if (mcapCount.has(band)) console.log(`    ${padR(band, 12)} ${mcapCount.get(band)}`)

  // ── Baseline: score-only (no other filters) ──────────────────────────────
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('  BASELINE — score threshold only, no other filters (≥30d maturity)')
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log()
  console.log(`  ${'Score'.padEnd(8)} ${'N'.padStart(5)}  ${'avg_raw'.padStart(8)}  ${'med_raw'.padStart(8)}  ${'avg_α'.padStart(8)}  ${'med_α'.padStart(8)}  ${'beat%'.padStart(6)}`)
  console.log(`  ${'-'.repeat(62)}`)
  for (const scoreMin of SCORE_THRESHOLDS) {
    const sub = mature.filter(s => s.score >= scoreMin && s.alpha != null)
    if (!sub.length) continue
    const raws   = sub.map(s => s.rawReturn!)
    const alphas = sub.map(s => s.alpha!)
    const beaten = sub.filter(s => s.alpha! > 0).length
    console.log(`  ${padR('≥'+scoreMin,8)} ${pad(sub.length,5)}  ${pad(pct(avg(raws)),8)}  ${pad(pct(median(raws)),8)}  ${pad(pct(avg(alphas)),8)}  ${pad(pct(median(alphas)),8)}  ${pad((beaten/sub.length*100).toFixed(0)+'%',6)}`)
  }
  for (const cls of ['OPPORTUNISTIC','UNCLASSIFIABLE'] as const) {
    console.log()
    console.log(`  ── ${cls} only ──`)
    console.log(`  ${'Score'.padEnd(8)} ${'N'.padStart(5)}  ${'avg_raw'.padStart(8)}  ${'med_raw'.padStart(8)}  ${'avg_α'.padStart(8)}  ${'med_α'.padStart(8)}  ${'beat%'.padStart(6)}`)
    console.log(`  ${'-'.repeat(62)}`)
    for (const scoreMin of SCORE_THRESHOLDS) {
      const sub = mature.filter(s => s.score >= scoreMin && s.classification === cls && s.alpha != null)
      if (!sub.length) continue
      const raws   = sub.map(s => s.rawReturn!)
      const alphas = sub.map(s => s.alpha!)
      const beaten = sub.filter(s => s.alpha! > 0).length
      console.log(`  ${padR('≥'+scoreMin,8)} ${pad(sub.length,5)}  ${pad(pct(avg(raws)),8)}  ${pad(pct(median(raws)),8)}  ${pad(pct(avg(alphas)),8)}  ${pad(pct(median(alphas)),8)}  ${pad((beaten/sub.length*100).toFixed(0)+'%',6)}`)
    }
  }

  // ── Full grid search ──────────────────────────────────────────────────────
  console.log()
  console.log('  Running grid search...')
  const all = gridSearch(signals)
  console.log(`  ${all.length} valid combinations (n ≥ ${MIN_N})`)

  // Sort by avg raw return
  const byAvgRaw   = [...all].sort((a, b) => b.avgRaw   - a.avgRaw)
  const byMedRaw   = [...all].sort((a, b) => b.medRaw   - a.medRaw)
  const byAvgAlpha = [...all].sort((a, b) => b.avgAlpha - a.avgAlpha)
  const byBeatPct  = [...all].sort((a, b) => b.beatPct  - a.beatPct)

  // ── Top by avg raw return ────────────────────────────────────────────────
  const SHOW = 35
  const hdr = `  ${'Rank'.padEnd(5)} ${'N'.padStart(4)}  ${'avg_raw'.padStart(8)}  ${'med_raw'.padStart(8)}  ${'avg_α'.padStart(8)}  ${'beat%'.padStart(6)}  ${'Filters'}`
  const sep = `  ${'-'.repeat(100)}`

  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log(`  ⚠  TOP ${SHOW} BY AVERAGE RAW RETURN  ⚠`)
  console.log('  Watch the N column. High returns almost always = tiny lucky sample.')
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log(hdr); console.log(sep)
  for (let i = 0; i < Math.min(SHOW, byAvgRaw.length); i++) {
    const c = byAvgRaw[i]
    const nFlag = c.n < 10 ? '⚠' : c.n < 20 ? '~' : ' '
    console.log(`  ${padR(i+1+'.',5)} ${pad(c.n,3)}${nFlag} ${pad(pct(c.avgRaw),8)}  ${pad(pct(c.medRaw),8)}  ${pad(pct(c.avgAlpha),8)}  ${pad(c.beatPct.toFixed(0)+'%',6)}  ${fmtCombo(c)}`)
  }

  // ── Top by median raw return (more robust) ───────────────────────────────
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log(`  TOP ${SHOW} BY MEDIAN RAW RETURN (more robust than average)`)
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log(hdr); console.log(sep)
  for (let i = 0; i < Math.min(SHOW, byMedRaw.length); i++) {
    const c = byMedRaw[i]
    const nFlag = c.n < 10 ? '⚠' : c.n < 20 ? '~' : ' '
    console.log(`  ${padR(i+1+'.',5)} ${pad(c.n,3)}${nFlag} ${pad(pct(c.avgRaw),8)}  ${pad(pct(c.medRaw),8)}  ${pad(pct(c.avgAlpha),8)}  ${pad(c.beatPct.toFixed(0)+'%',6)}  ${fmtCombo(c)}`)
  }

  // ── Top by market-adjusted alpha (avg) ────────────────────────────────────
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log(`  TOP ${SHOW} BY MARKET-ADJUSTED ALPHA (avg)`)
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log(hdr); console.log(sep)
  for (let i = 0; i < Math.min(SHOW, byAvgAlpha.length); i++) {
    const c = byAvgAlpha[i]
    const nFlag = c.n < 10 ? '⚠' : c.n < 20 ? '~' : ' '
    console.log(`  ${padR(i+1+'.',5)} ${pad(c.n,3)}${nFlag} ${pad(pct(c.avgRaw),8)}  ${pad(pct(c.medRaw),8)}  ${pad(pct(c.avgAlpha),8)}  ${pad(c.beatPct.toFixed(0)+'%',6)}  ${fmtCombo(c)}`)
  }

  // ── Hitting ~40% raw return: what does the sample look like? ─────────────
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('  TARGETING ≥40% AVERAGE RAW RETURN — how many trades are in each?')
  console.log('═══════════════════════════════════════════════════════════════════════')
  const hit40 = byAvgRaw.filter(c => c.avgRaw >= 40)
  if (!hit40.length) {
    console.log('  No combination with n ≥ 3 reaches 40% avg raw return.')
    const closest = byAvgRaw.slice(0, 10)
    console.log(`  Closest (top 10 by avg raw):`)
    console.log(hdr); console.log(sep)
    for (let i = 0; i < closest.length; i++) {
      const c = closest[i]
      const nFlag = c.n < 10 ? '⚠' : c.n < 20 ? '~' : ' '
      console.log(`  ${padR(i+1+'.',5)} ${pad(c.n,3)}${nFlag} ${pad(pct(c.avgRaw),8)}  ${pad(pct(c.medRaw),8)}  ${pad(pct(c.avgAlpha),8)}  ${pad(c.beatPct.toFixed(0)+'%',6)}  ${fmtCombo(c)}`)
    }
  } else {
    console.log(`  ${hit40.length} combinations reach ≥40% avg raw return:`)
    console.log(hdr); console.log(sep)
    for (let i = 0; i < hit40.length; i++) {
      const c = hit40[i]
      const nFlag = c.n < 10 ? '⚠' : c.n < 20 ? '~' : ' '
      console.log(`  ${padR(i+1+'.',5)} ${pad(c.n,3)}${nFlag} ${pad(pct(c.avgRaw),8)}  ${pad(pct(c.medRaw),8)}  ${pad(pct(c.avgAlpha),8)}  ${pad(c.beatPct.toFixed(0)+'%',6)}  ${fmtCombo(c)}`)
    }
  }

  // ── N collapse: show how sample shrinks as avg_raw rises ─────────────────
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('  OVERFITTING IN ACTION — return vs. sample size')
  console.log('  (all combos grouped into avg_raw buckets, showing median N per bucket)')
  console.log('═══════════════════════════════════════════════════════════════════════')
  const returnBuckets = [
    { label: '≥40%',  min: 40,  max: Infinity },
    { label: '30-40%',min: 30,  max: 40 },
    { label: '20-30%',min: 20,  max: 30 },
    { label: '15-20%',min: 15,  max: 20 },
    { label: '10-15%',min: 10,  max: 15 },
    { label: '5-10%', min: 5,   max: 10 },
    { label: '<5%',   min: -Infinity, max: 5 },
  ]
  console.log(`  ${'Return range'.padEnd(12)} ${'# combos'.padStart(9)}  ${'median N'.padStart(9)}  ${'min N'.padStart(6)}  ${'max N'.padStart(6)}`)
  console.log(`  ${'-'.repeat(55)}`)
  for (const rb of returnBuckets) {
    const group = all.filter(c => c.avgRaw >= rb.min && c.avgRaw < rb.max)
    if (!group.length) continue
    const ns = group.map(c => c.n).sort((a,b) => a-b)
    const medN = ns[Math.floor(ns.length/2)]
    const minN = ns[0], maxN = ns[ns.length-1]
    console.log(`  ${padR(rb.label,12)} ${pad(group.length,9)}  ${pad(medN,9)}  ${pad(minN,6)}  ${pad(maxN,6)}`)
  }

  // ── Best combo breakdown: which specific trades are in it? ────────────────
  const best = byAvgRaw[0]
  console.log()
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('  BEST COMBO DRILL-DOWN (by avg raw return)')
  console.log(`  Filters: ${fmtCombo(best)}`)
  console.log(`  avg_raw=${pct(best.avgRaw)}  med_raw=${pct(best.medRaw)}  avg_α=${pct(best.avgAlpha)}  N=${best.n}`)
  console.log('═══════════════════════════════════════════════════════════════════════')
  const bestTrades = signals.filter(s =>
    s.score >= best.scoreMin &&
    (best.cls === 'BOTH' || s.classification === best.cls) &&
    (best.mcap === 'any' || s.mcapBand === best.mcap) &&
    (best.role === 'any' || s.roleLabel === best.role) &&
    s.daysElapsed >= best.maturity &&
    !s.missingPrice && s.rawReturn != null && !s.outlier && s.alpha != null
  ).sort((a, b) => b.rawReturn! - a.rawReturn!)
  console.log(`  ${'Ticker'.padEnd(8)} ${'Date'.padEnd(12)} ${'Score'.padStart(5)} ${'Class'.padEnd(6)} ${'Role'.padEnd(12)} ${'MCap'.padEnd(8)} ${'Days'.padStart(5)} ${'raw_ret'.padStart(8)} ${'alpha'.padStart(8)}`)
  console.log(`  ${'-'.repeat(85)}`)
  for (const s of bestTrades) {
    const mc = s.marketCap ? (s.marketCap >= 1e9 ? (s.marketCap/1e9).toFixed(1)+'B' : (s.marketCap/1e6).toFixed(0)+'M') : 'N/A'
    console.log(`  ${padR(s.ticker,8)} ${s.date.padEnd(12)} ${pad(s.score,5)} ${padR(s.classification.slice(0,4),6)} ${padR(s.roleLabel,12)} ${padR(mc,8)} ${pad(s.daysElapsed,5)} ${pad(pct(s.rawReturn),8)} ${pad(pct(s.alpha),8)}`)
  }

  // ── Best combo among N ≥ 20 (more honest) ────────────────────────────────
  const decent = all.filter(c => c.n >= 20).sort((a, b) => b.avgRaw - a.avgRaw)
  if (decent.length) {
    const d = decent[0]
    console.log()
    console.log('═══════════════════════════════════════════════════════════════════════')
    console.log('  BEST COMBO REQUIRING N ≥ 20 (less cherry-picked)')
    console.log(`  Filters: ${fmtCombo(d)}`)
    console.log(`  avg_raw=${pct(d.avgRaw)}  med_raw=${pct(d.medRaw)}  avg_α=${pct(d.avgAlpha)}  beat%=${d.beatPct.toFixed(0)}%  N=${d.n}`)
    console.log('═══════════════════════════════════════════════════════════════════════')
    const dTrades = signals.filter(s =>
      s.score >= d.scoreMin &&
      (d.cls === 'BOTH' || s.classification === d.cls) &&
      (d.mcap === 'any' || s.mcapBand === d.mcap) &&
      (d.role === 'any' || s.roleLabel === d.role) &&
      s.daysElapsed >= d.maturity &&
      !s.missingPrice && s.rawReturn != null && !s.outlier && s.alpha != null
    ).sort((a, b) => b.rawReturn! - a.rawReturn!)
    console.log(`  ${'Ticker'.padEnd(8)} ${'Date'.padEnd(12)} ${'Score'.padStart(5)} ${'Class'.padEnd(6)} ${'Days'.padStart(5)} ${'raw_ret'.padStart(8)} ${'alpha'.padStart(8)}`)
    console.log(`  ${'-'.repeat(65)}`)
    for (const s of dTrades.slice(0, 30)) {
      console.log(`  ${padR(s.ticker,8)} ${s.date.padEnd(12)} ${pad(s.score,5)} ${padR(s.classification.slice(0,4),6)} ${pad(s.daysElapsed,5)} ${pad(pct(s.rawReturn),8)} ${pad(pct(s.alpha),8)}`)
    }
    if (dTrades.length > 30) console.log(`  ... and ${dTrades.length - 30} more`)
  }

  console.log()
  console.log('════════════════════════════════════════════════════════════════════════')
  console.log('  REMINDER: ALL NUMBERS ABOVE ARE HINDSIGHT-BIASED.')
  console.log('  Filters were chosen AFTER seeing returns. Real forward performance')
  console.log('  of any of these combos is unknown and likely much lower.')
  console.log('════════════════════════════════════════════════════════════════════════')
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
