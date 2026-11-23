// Out-of-sample return analysis for Sentra conviction scores.
// npx tsx scripts/oos-returns.ts
//
// Design decisions:
//   Start date: 2026-06-16 (the scoring system as it exists today was last
//     materially changed on 2026-07-30; before that, conviction_score/route
//     has run daily since ~2026-05-01; we use June 16 as a conservative
//     midpoint that gives ~60 days of data while staying post-algorithm-stabilisation).
//     THE SCRIPT WILL REPORT THE EXACT COUNTS FOR MULTIPLE CUT-OFFS.
//
//   Holding period: uses days-elapsed-since-entry, not a fixed target.
//     A 180-day return on a trade entered Aug 14 won't mature until Feb 2027.
//     We compute returns for whatever has actually elapsed and flag
//     "immature" trades (<30d) separately.
//
//   Market adjustment: SPY daily return over the same [entry, today] window.
//     Size-matched benchmarks (IWM/MDY) require knowing market cap at time of
//     trade. SPY is transparent, reproducible, and what a retail investor would
//     compare against. We note the caveat.
//
//   Entry price: insider_transactions.price_per_share (filed in Form 4).
//     If null, the trade is excluded with a count reported.
//
//   Current price: Yahoo Finance quote() at script run time.

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ── Env ───────────────────────────────────────────────────────────────────────

const envPath = path.join(__dirname, '..', '.env.local')
for (const line of fs.readFileSync(envPath,'utf-8').split('\n')) {
  const t=line.trim(); if(!t||t.startsWith('#')) continue
  const eq=t.indexOf('='); if(eq<0) continue
  const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim().replace(/^["']|["']$/g,'')
  if(!process.env[k]) process.env[k]=v
}

const sb  = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)
const yf  = new YahooFinance()
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Config ────────────────────────────────────────────────────────────────────

// Last major system change: 2026-07-30 (CMP-only classification, no inference).
// Second milestone: 2026-05-01 (scoring algorithm finalised from 2021-25 backtest data).
// We show both cut-offs so the reader can see the effect of sample size.
const CUTOFF_A = '2026-05-01'  // broader window: algo finalized, more data
const CUTOFF_B = '2026-07-30'  // conservative: last system change
const TODAY    = new Date().toISOString().split('T')[0]

const CLASSES  = ['OPPORTUNISTIC', 'UNCLASSIFIABLE'] as const
const BUCKETS  = [
  { label: '80–100', min: 80, max: 100 },
  { label: '70–79',  min: 70, max: 79  },
  { label: '60–69',  min: 60, max: 69  },
] as const

const MIN_DAYS_MATURE = 30   // trades with <30d elapsed flagged as immature

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2
}

function avg(arr: number[]): number | null {
  return arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null
}

function fmt1(v: number | null): string {
  if (v == null) return 'N/A'
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%'
}

function fmt0(v: number | null): string {
  if (v == null) return 'N/A'
  return (v >= 0 ? '+' : '') + v.toFixed(0) + '%'
}

// ── DB fetch ──────────────────────────────────────────────────────────────────

async function fetchSignals(since: string) {
  const PAGE = 1000
  const all: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('insider_transactions')
      .select('id, ticker, transaction_date, conviction_score, classification, price_per_share, total_value, shares, insider_name, role')
      .eq('transaction_code', 'P')
      .gte('transaction_date', since)
      .not('conviction_score', 'is', null)
      .in('classification', ['OPPORTUNISTIC', 'UNCLASSIFIABLE'])
      .order('transaction_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    for (const r of data) all.push(r)
    if (data.length < PAGE) break
  }
  return all
}

// ── Yahoo price fetch ─────────────────────────────────────────────────────────

// Fetch current price for a batch of symbols.
// Returns map ticker → current price.
async function fetchCurrentPrices(symbols: string[]): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>()
  const BATCH = 20
  for (let i = 0; i < symbols.length; i += BATCH) {
    const batch = symbols.slice(i, i + BATCH)
    try {
      const res = await yf.quote(batch as any, {}, { validateResult: false }) as any
      const quotes = Array.isArray(res) ? res : [res]
      for (let j = 0; j < batch.length; j++) {
        const q = quotes[j]
        map.set(batch[j], q?.regularMarketPrice ?? null)
      }
    } catch {
      for (const s of batch) map.set(s, null)
    }
    if (i + BATCH < symbols.length) await sleep(400)
  }
  return map
}

// Fetch SPY historical prices for a date range.
async function fetchSpyPrices(startDate: string, endDate: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const d0 = new Date(startDate); d0.setUTCDate(d0.getUTCDate() - 5)
  const d1 = new Date(endDate);   d1.setUTCDate(d1.getUTCDate() + 5)
  try {
    const ch: any = await yf.chart('SPY', { period1: d0, period2: d1, interval: '1d' })
    const quotes: any[] = Array.isArray(ch?.quotes) ? ch.quotes : []
    for (const q of quotes) {
      if (q?.date && (q.adjClose ?? q.close) != null) {
        map.set(new Date(q.date).toISOString().split('T')[0], q.adjClose ?? q.close)
      }
    }
  } catch (e: any) {
    console.warn(`  SPY fetch failed: ${e.message}`)
  }
  return map
}

function lookupPrice(priceMap: Map<string, number>, date: string): number | null {
  for (let i = 0; i <= 7; i++) {
    const d = new Date(date); d.setUTCDate(d.getUTCDate() + i)
    const p = priceMap.get(d.toISOString().split('T')[0])
    if (p != null) return p
  }
  return null
}

// ── Analysis ──────────────────────────────────────────────────────────────────

// Form 4 price_per_share filings can be badly wrong (e.g., warrants at exercise
// price, options, split-adjusted oddities). A stock returning ±300% in <120 days
// is almost certainly a filing error. We Winsorize at ±200% for AVERAGE calculations
// but always report medians (robust) and explicitly count how many are excluded.
const RETURN_OUTLIER_THRESHOLD = 200  // %

interface EnrichedSignal {
  ticker:         string
  date:           string
  score:          number
  classification: string
  daysElapsed:    number
  rawReturn:      number | null      // % gain/loss since entry (unwinsorized)
  spyReturn:      number | null      // SPY % over same window
  alpha:          number | null      // rawReturn - spyReturn (unwinsorized)
  beatMarket:     boolean | null
  mature:         boolean            // true if ≥ MIN_DAYS_MATURE
  missingPrice:   boolean
  outlier:        boolean            // |rawReturn| > RETURN_OUTLIER_THRESHOLD
}

type BucketKey = `${string}::${string}`

function bucketKey(cls: string, label: string): BucketKey {
  return `${cls}::${label}` as BucketKey
}

function bucketStats(signals: EnrichedSignal[]) {
  const mature    = signals.filter(s => s.mature && !s.missingPrice && s.rawReturn != null)
  const clean     = mature.filter(s => !s.outlier)  // exclude obvious price-data errors
  const outliers  = mature.filter(s => s.outlier)
  const raws      = clean.map(s => s.rawReturn!)
  const rawsAll   = mature.map(s => s.rawReturn!)    // for median (robust to outliers)
  const alphasClean = clean.map(s => s.alpha!).filter(a => a != null) as number[]
  const alphasAll   = mature.map(s => s.alpha).filter(a => a != null) as number[]
  const beats       = clean.filter(s => s.beatMarket === true)

  return {
    n_total:    signals.length,
    n_mature:   mature.length,
    n_clean:    clean.length,
    n_outlier:  outliers.length,
    n_immature: signals.filter(s => !s.mature).length,
    n_missing:  signals.filter(s => s.missingPrice).length,
    avg_days:   clean.length ? Math.round(avg(clean.map(s => s.daysElapsed))!) : null,
    avg_raw:    avg(raws),           // winsorized (outliers excluded)
    med_raw:    median(rawsAll),     // robust median includes all mature
    avg_alpha:  avg(alphasClean),    // winsorized
    med_alpha:  median(alphasAll),   // robust median
    win_rate:   clean.length ? beats.length / clean.length : null,  // beat market (clean)
    win_abs:    clean.length ? clean.filter(s => s.rawReturn! > 0).length / clean.length : null,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run(since: string, label: string) {
  console.log(`\n${'═'.repeat(72)}`)
  console.log(`  OUT-OF-SAMPLE ANALYSIS — since ${since} (${label})`)
  console.log(`  Run date: ${TODAY}`)
  console.log(`${'═'.repeat(72)}`)

  const signals = await fetchSignals(since)
  console.log(`\n  ${signals.length} qualifying P-code signals (OPP + UNCL, with conviction_score)`)

  if (signals.length === 0) {
    console.log('  No signals to analyse.')
    return
  }

  // Breakdown by month
  const byMonth = new Map<string, number>()
  for (const s of signals) {
    const m = (s.transaction_date as string).slice(0,7)
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1)
  }
  console.log('\n  Signals by month:')
  for (const [m, n] of [...byMonth.entries()].sort()) {
    console.log(`    ${m}: ${n}`)
  }

  // Entry price availability
  const withPrice    = signals.filter(s => s.price_per_share != null)
  const withoutPrice = signals.filter(s => s.price_per_share == null)
  console.log(`\n  Entry price (price_per_share from Form 4):`)
  console.log(`    Available: ${withPrice.length} / ${signals.length}`)
  console.log(`    Missing:   ${withoutPrice.length} — these are excluded from return calculations`)

  // Fetch SPY prices
  const minDate = signals[0].transaction_date as string
  console.log(`\n  Fetching SPY prices ${minDate} → today...`)
  const spyPrices = await fetchSpyPrices(minDate, TODAY)
  console.log(`  ${spyPrices.size} SPY trading days loaded`)

  // Get current SPY price (proxy: last entry in spyPrices)
  const spySorted = [...spyPrices.entries()].sort()
  const spyNow    = spySorted.length ? spySorted[spySorted.length-1][1] : null
  const spyNowDate= spySorted.length ? spySorted[spySorted.length-1][0] : TODAY

  // Fetch current prices for all tickers
  const tickers = [...new Set(withPrice.map(s => s.ticker as string))]
  console.log(`\n  Fetching current prices for ${tickers.length} tickers...`)
  const currentPrices = await fetchCurrentPrices(tickers)
  const gotPrice = [...currentPrices.values()].filter(p => p != null).length
  console.log(`  Got current price for ${gotPrice}/${tickers.length} tickers`)

  // Enrich signals
  const enriched: EnrichedSignal[] = []
  for (const s of signals) {
    const entryPrice = s.price_per_share as number | null
    const curPrice   = entryPrice ? (currentPrices.get(s.ticker) ?? null) : null
    const missingPrice = entryPrice == null || curPrice == null

    const daysElapsed  = daysBetween(s.transaction_date, TODAY)
    const mature       = daysElapsed >= MIN_DAYS_MATURE

    let rawReturn: number | null = null
    let spyReturn: number | null = null
    let alpha:     number | null = null
    let beatMarket: boolean | null = null

    if (!missingPrice && mature) {
      rawReturn = (curPrice! / entryPrice! - 1) * 100

      // SPY from entry date to today
      const spyEntry = lookupPrice(spyPrices, s.transaction_date)
      spyReturn = (spyEntry && spyNow) ? (spyNow / spyEntry - 1) * 100 : null

      if (spyReturn != null) {
        alpha     = rawReturn - spyReturn
        beatMarket = rawReturn > spyReturn
      }
    }

    const outlier = rawReturn != null && Math.abs(rawReturn) > RETURN_OUTLIER_THRESHOLD

    enriched.push({
      ticker:         s.ticker,
      date:           s.transaction_date,
      score:          s.conviction_score as number,
      classification: s.classification as string,
      daysElapsed,
      rawReturn,
      spyReturn,
      alpha,
      beatMarket,
      mature,
      missingPrice,
      outlier,
    })
  }

  // ── Per-bucket stats ───────────────────────────────────────────────────────

  console.log(`\n  SPY reference price: ${spyNow?.toFixed(2) ?? 'N/A'} (as of ${spyNowDate})`)
  console.log(`\n  Maturity threshold: ≥${MIN_DAYS_MATURE} days elapsed`)
  console.log(`  As of ${TODAY}, the oldest signals (entered ${since}) have been held ~${daysBetween(since, TODAY)}d`)

  // Count total outliers for header note
  const totalOutliers = enriched.filter(s => s.mature && s.outlier)
  if (totalOutliers.length > 0) {
    console.log(`\n  ⚠ DATA QUALITY: ${totalOutliers.length} mature trades have |return| > ${RETURN_OUTLIER_THRESHOLD}% —`)
    console.log(`    likely Form 4 price_per_share filing errors (entry price ≠ market price).`)
    console.log(`    AVERAGES below EXCLUDE these. MEDIANS include all (robust to outliers).`)
    for (const s of [...totalOutliers].sort((a,b)=>(b.rawReturn??0)-(a.rawReturn??0)).slice(0, 8)) {
      console.log(`    ${s.ticker.padEnd(6)} ${s.date}  score=${s.score}  cls=${s.classification.slice(0,4)}  raw=${fmt0(s.rawReturn)}`)
    }
    if (totalOutliers.length > 8) console.log(`    ... and ${totalOutliers.length - 8} more`)
  }

  const lines: string[] = []

  for (const cls of CLASSES) {
    lines.push(`\n  ── ${cls} ──`)
    lines.push(`  avg_raw/med_raw = stock return. avg_α/med_α = stock minus SPY same period.`)
    lines.push(`  beat% = clean trades that outperformed SPY. Averages exclude |ret|>${RETURN_OUTLIER_THRESHOLD}% outliers.`)
    lines.push(`  `)
    lines.push(`  ${'Bucket'.padEnd(8)} ${'n_tot'.padStart(6)} ${'mature'.padStart(7)} ${'clean'.padStart(6)} ${'outlier'.padStart(8)} ${'avg_raw'.padStart(9)} ${'med_raw'.padStart(9)} ${'avg_α'.padStart(8)} ${'med_α'.padStart(8)} ${'beat%'.padStart(7)} ${'abs_win'.padStart(8)} ${'avg_d'.padStart(7)}`)
    lines.push(`  ${'─'.repeat(110)}`)

    for (const b of BUCKETS) {
      const sigs = enriched.filter(s =>
        s.classification === cls &&
        s.score >= b.min &&
        s.score <= b.max
      )
      const st = bucketStats(sigs)
      const flagSmall = st.n_clean < 15 ? ' ⚠ SMALL SAMPLE' : ''
      const flagEmpty = st.n_clean === 0 ? ' ⚠ NO MATURE TRADES YET' : ''

      lines.push(
        `  ${b.label.padEnd(8)}` +
        ` ${String(st.n_total).padStart(6)}` +
        ` ${String(st.n_mature).padStart(7)}` +
        ` ${String(st.n_clean).padStart(6)}` +
        ` ${String(st.n_outlier).padStart(8)}` +
        ` ${fmt1(st.avg_raw).padStart(9)}` +
        ` ${fmt1(st.med_raw).padStart(9)}` +
        ` ${fmt1(st.avg_alpha).padStart(8)}` +
        ` ${fmt1(st.med_alpha).padStart(8)}` +
        ` ${st.win_rate != null ? (st.win_rate*100).toFixed(0)+'%' : 'N/A'}`.padStart(7) +
        ` ${st.win_abs != null ? (st.win_abs*100).toFixed(0)+'%' : 'N/A'}`.padStart(8) +
        ` ${st.avg_days != null ? st.avg_days+'d' : 'N/A'}`.padStart(7) +
        flagSmall + flagEmpty
      )
    }

    const allSt = bucketStats(enriched.filter(s => s.classification === cls))
    lines.push(`  ${'─'.repeat(110)}`)
    lines.push(
      `  ${'ALL'.padEnd(8)}` +
      ` ${String(allSt.n_total).padStart(6)}` +
      ` ${String(allSt.n_mature).padStart(7)}` +
      ` ${String(allSt.n_clean).padStart(6)}` +
      ` ${String(allSt.n_outlier).padStart(8)}` +
      ` ${fmt1(allSt.avg_raw).padStart(9)}` +
      ` ${fmt1(allSt.med_raw).padStart(9)}` +
      ` ${fmt1(allSt.avg_alpha).padStart(8)}` +
      ` ${fmt1(allSt.med_alpha).padStart(8)}` +
      ` ${allSt.win_rate != null ? (allSt.win_rate*100).toFixed(0)+'%' : 'N/A'}`.padStart(7) +
      ` ${allSt.win_abs != null ? (allSt.win_abs*100).toFixed(0)+'%' : 'N/A'}`.padStart(8) +
      ` ${allSt.avg_days != null ? allSt.avg_days+'d' : 'N/A'}`.padStart(7)
    )
  }

  for (const l of lines) console.log(l)

  // ── Coverage summary ───────────────────────────────────────────────────────

  const totalMature   = enriched.filter(s => s.mature && !s.missingPrice && s.rawReturn != null)
  const totalImmature = enriched.filter(s => !s.mature)
  const totalMissing  = enriched.filter(s => s.missingPrice)
  console.log(`\n  ── Coverage summary ──`)
  console.log(`  Total signals:               ${enriched.length}`)
  console.log(`  Mature (≥${MIN_DAYS_MATURE}d, have price):  ${totalMature.length} — these drive the numbers above`)
  console.log(`  Immature (<${MIN_DAYS_MATURE}d):            ${totalImmature.length} — not yet included in stats`)
  console.log(`  Missing entry/current price: ${totalMissing.length}`)

  // ── Score distribution ─────────────────────────────────────────────────────

  console.log(`\n  ── Score distribution (all signals, not just mature) ──`)
  for (const cls of CLASSES) {
    const group = enriched.filter(s => s.classification === cls)
    const b80   = group.filter(s => s.score >= 80).length
    const b7079 = group.filter(s => s.score >= 70 && s.score <= 79).length
    const b6069 = group.filter(s => s.score >= 60 && s.score <= 69).length
    const below = group.filter(s => s.score < 60).length
    console.log(`  ${cls}: total=${group.length}  80+=${b80}  70-79=${b7079}  60-69=${b6069}  <60=${below}`)
  }

  // ── Top performers ────────────────────────────────────────────────────────

  const topByAlpha = totalMature
    .filter(s => s.alpha != null)
    .sort((a,b) => (b.alpha ?? -Infinity) - (a.alpha ?? -Infinity))
    .slice(0, 5)
  if (topByAlpha.length) {
    console.log(`\n  ── Top 5 mature signals by alpha (for reference, not cherry-picked) ──`)
    for (const s of topByAlpha) {
      console.log(`  ${s.ticker.padEnd(6)} ${s.date}  score=${s.score}  ${s.classification.slice(0,4)}  raw=${fmt1(s.rawReturn)}  α=${fmt1(s.alpha)}  held=${s.daysElapsed}d`)
    }
  }

  const botByAlpha = totalMature
    .filter(s => s.alpha != null)
    .sort((a,b) => (a.alpha ?? Infinity) - (b.alpha ?? Infinity))
    .slice(0, 5)
  if (botByAlpha.length) {
    console.log(`\n  ── Bottom 5 mature signals by alpha ──`)
    for (const s of botByAlpha) {
      console.log(`  ${s.ticker.padEnd(6)} ${s.date}  score=${s.score}  ${s.classification.slice(0,4)}  raw=${fmt1(s.rawReturn)}  α=${fmt1(s.alpha)}  held=${s.daysElapsed}d`)
    }
  }

  // ── Honesty note ──────────────────────────────────────────────────────────

  console.log(`\n  ── Caveats and limitations ──`)
  console.log(`  1. Holding period: returns measured as entry price → today's price.`)
  console.log(`     Not apples-to-apples with the 180d backtest. With max ~${daysBetween(since, TODAY)}d elapsed,`)
  console.log(`     these are short-horizon returns, not the 6-month signal the system is designed for.`)
  console.log(`  2. Market adjustment: SPY only. For small-caps (IWM) the alpha would look different.`)
  console.log(`     Use size-matched benchmarks for rigorous analysis.`)
  console.log(`  3. The conviction score is a RELATIVE RANK within classification (CMP), not a return`)
  console.log(`     predictor. A 90 means "top 10% by these structural factors," not "90% chance of gain."`)
  console.log(`  4. CMP classification is permanent for each insider. Scores updated daily for new trades.`)
  console.log(`  5. UNCLASSIFIABLE insiders haven't traded long enough (or have too-regular patterns)`)
  console.log(`     to qualify as Opportunistic. They are NOT the same signal quality.`)
  console.log(`  6. With <30d-mature sample sizes likely under 50 per bucket, any pattern observed`)
  console.log(`     could easily be noise. Minimum 100+ mature trades per bucket needed to be meaningful.`)
}

async function main() {
  // Run both cut-offs so user can see the tradeoff
  await run(CUTOFF_A, 'algo finalised')
  await run(CUTOFF_B, 'last system change — CMP-only classification')
  console.log('\n')
}

main().catch(e => { console.error(e); process.exit(1) })
