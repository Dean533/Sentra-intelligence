// ══════════════════════════════════════════════════════════════════════════════
//  PAPER TRADING SIMULATION — HINDSIGHT-BIASED, EDUCATION ONLY
//  ─────────────────────────────────────────────────────────────
//  Simulates a portfolio of insider buys using daily OHLC price paths to
//  determine which exit trigger fires first (take-profit, stop-loss, time-exit).
//
//  Entry price:  Form 4 price_per_share (what the insider filed they paid).
//  Exit triggers evaluated in order each day:
//    1. Gap open below stop-loss → exits at open
//    2. Gap open above take-profit → exits at open
//    3. Intraday low ≤ stop-loss price → exits at stop-loss price
//    4. Intraday high ≥ take-profit price → exits at take-profit price
//    5. Day N (maxHoldDays) reached → exits at that day's close
//  If still open at end of available data → mark as "open", valued at last close.
//
//  Equity curve: daily sum of (realized P&L) + (unrealized P&L at day's close).
//  Starting point: $0 net P&L. Each trade adds/subtracts from the curve.
//
//  npx tsx scripts/paper-trade.ts
// ══════════════════════════════════════════════════════════════════════════════

import * as fs   from 'fs'
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

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Adjust these to explore different strategies.

const CONFIG = {
  cutoff:          '2026-05-01',        // signals from this date onward
  classifications: ['OPPORTUNISTIC'],   // or ['UNCLASSIFIABLE'] or both
  minScore:        80,                  // conviction score minimum
  positionSize:    100,                 // $ per trade
  takeProfitPct:   20,                  // exit when price is up X%
  stopLossPct:     10,                  // exit when price is down X%
  maxHoldDays:     90,                  // time exit after N calendar days (not trading days)
}

const TODAY = new Date().toISOString().split('T')[0]

// ── Types ─────────────────────────────────────────────────────────────────────

interface Signal {
  id: string
  ticker: string
  date: string
  score: number
  classification: string
  entryPrice: number | null
}

interface DailyBar {
  date: string
  open: number
  high: number
  low: number
  close: number
}

type ExitReason = 'take-profit' | 'stop-loss' | 'time-exit' | 'open' | 'no-data' | 'bad-entry-price'

interface TradeResult {
  // Signal info
  ticker: string
  entryDate: string
  entryPrice: number
  score: number
  classification: string
  // Exit info
  exitDate: string
  exitPrice: number
  exitReason: ExitReason
  daysHeld: number
  // P&L
  returnPct: number          // (exitPrice - entryPrice) / entryPrice * 100
  dollarPnl: number          // positionSize * returnPct / 100
  // Status
  isOpen: boolean
  hadBadData: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().split('T')[0]
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000)
}

function fmtPct(v: number, digits = 1): string {
  return (v >= 0 ? '+' : '') + v.toFixed(digits) + '%'
}
function fmtDollar(v: number): string {
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2)
}

// ── DB fetch ──────────────────────────────────────────────────────────────────

async function fetchSignals(): Promise<Signal[]> {
  const all: Signal[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('insider_transactions')
      .select('id, ticker, transaction_date, conviction_score, classification, price_per_share')
      .eq('transaction_code', 'P')
      .gte('transaction_date', CONFIG.cutoff)
      .in('classification', CONFIG.classifications)
      .gte('conviction_score', CONFIG.minScore)
      .order('transaction_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    for (const r of data) {
      all.push({
        id:             r.id,
        ticker:         r.ticker,
        date:           r.transaction_date,
        score:          r.conviction_score,
        classification: r.classification,
        entryPrice:     r.price_per_share ?? null,
      })
    }
    if (data.length < PAGE) break
  }
  return all
}

// ── Yahoo daily bars ──────────────────────────────────────────────────────────

async function fetchDailyBars(
  ticker: string,
  startDate: string,
  endDate: string,
): Promise<DailyBar[]> {
  try {
    const d0 = new Date(startDate); d0.setUTCDate(d0.getUTCDate() - 3)  // small buffer
    const d1 = new Date(endDate);   d1.setUTCDate(d1.getUTCDate() + 3)
    const ch: any = await yf.chart(ticker, {
      period1:  d0,
      period2:  d1,
      interval: '1d',
    })
    const bars: DailyBar[] = []
    for (const q of ch?.quotes ?? []) {
      if (!q?.date) continue
      const dateStr = new Date(q.date).toISOString().split('T')[0]
      if (q.open == null || q.high == null || q.low == null || (q.close == null && q.adjClose == null)) continue
      bars.push({
        date:  dateStr,
        open:  q.open,
        high:  q.high,
        low:   q.low,
        close: q.adjClose ?? q.close,
      })
    }
    return bars.sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

// ── Trade simulation ──────────────────────────────────────────────────────────

function simulateTrade(signal: Signal, bars: DailyBar[]): TradeResult {
  const entryPrice = signal.entryPrice!
  const tpPrice    = entryPrice * (1 + CONFIG.takeProfitPct / 100)
  const slPrice    = entryPrice * (1 - CONFIG.stopLossPct / 100)
  const maxExitDate = addDays(signal.date, CONFIG.maxHoldDays)

  // Filter bars to those on or after the entry date (entry day itself is the buy)
  // We evaluate exits from the NEXT trading day onward
  const barsAfterEntry = bars.filter(b => b.date > signal.date && b.date <= maxExitDate)

  // Also capture bars on or before today for open trades
  const barsForOpen = bars.filter(b => b.date > signal.date && b.date <= TODAY)

  const makeResult = (
    exitDate: string,
    exitPrice: number,
    exitReason: ExitReason,
    daysHeld: number,
    isOpen = false,
    hadBadData = false,
  ): TradeResult => {
    const returnPct = (exitPrice - entryPrice) / entryPrice * 100
    return {
      ticker:         signal.ticker,
      entryDate:      signal.date,
      entryPrice,
      score:          signal.score,
      classification: signal.classification,
      exitDate,
      exitPrice,
      exitReason,
      daysHeld,
      returnPct,
      dollarPnl:      CONFIG.positionSize * returnPct / 100,
      isOpen,
      hadBadData,
    }
  }

  for (const bar of barsAfterEntry) {
    const daysHeld = daysBetween(signal.date, bar.date)

    // Gap-down at open: stop triggers at open
    if (bar.open <= slPrice) {
      return makeResult(bar.date, bar.open, 'stop-loss', daysHeld)
    }
    // Gap-up at open: take profit triggers at open
    if (bar.open >= tpPrice) {
      return makeResult(bar.date, bar.open, 'take-profit', daysHeld)
    }
    // Intraday: stop-loss takes precedence if both hit same bar (conservative)
    if (bar.low <= slPrice) {
      return makeResult(bar.date, slPrice, 'stop-loss', daysHeld)
    }
    if (bar.high >= tpPrice) {
      return makeResult(bar.date, tpPrice, 'take-profit', daysHeld)
    }
    // Time exit at last allowed day's close
    if (bar.date >= maxExitDate) {
      return makeResult(bar.date, bar.close, 'time-exit', daysHeld)
    }
  }

  // No bars covered the max hold period → still open
  const openBars = barsForOpen
  if (openBars.length === 0) {
    return makeResult(TODAY, entryPrice, 'no-data', daysBetween(signal.date, TODAY), true, true)
  }
  const lastBar = openBars[openBars.length - 1]
  const daysHeld = daysBetween(signal.date, lastBar.date)
  return makeResult(lastBar.date, lastBar.close, 'open', daysHeld, true)
}

// ── Equity curve ──────────────────────────────────────────────────────────────

function buildEquityCurve(
  trades: TradeResult[],
  allBars: Map<string, DailyBar[]>,
): { date: string; pnl: number; invested: number }[] {
  if (!trades.length) return []

  const startDate = trades.map(t => t.entryDate).sort()[0]
  const endDate   = TODAY

  // Build list of all calendar dates in range
  const dates: string[] = []
  let d = new Date(startDate)
  const end = new Date(endDate)
  while (d <= end) {
    dates.push(d.toISOString().split('T')[0])
    d.setUTCDate(d.getUTCDate() + 1)
  }

  // Helper: look up a ticker's price on a given date (or nearest prior close)
  function getPrice(ticker: string, date: string): number | null {
    const bars = allBars.get(ticker) ?? []
    // Find the last bar on or before date
    let best: DailyBar | null = null
    for (const bar of bars) {
      if (bar.date <= date) best = bar
      else break
    }
    return best?.close ?? null
  }

  const curve: { date: string; pnl: number; invested: number }[] = []
  let realizedPnl = 0

  for (const date of dates) {
    let unrealizedPnl = 0
    let investedToday = 0

    for (const t of trades) {
      if (t.entryDate > date) continue    // not yet entered
      if (!t.isOpen && t.exitDate < date) {
        // Closed before today: only realized
        continue
      }
      if (!t.isOpen && t.exitDate === date) {
        // Closes today: add to realized (will be counted separately)
        continue
      }
      if (!t.isOpen && t.exitDate > date) {
        // This trade exited in the future; on 'date' it's still open
        const price = getPrice(t.ticker, date)
        if (price != null) {
          unrealizedPnl += CONFIG.positionSize * (price - t.entryPrice) / t.entryPrice
          investedToday += CONFIG.positionSize
        }
      } else if (t.isOpen) {
        // Still open today
        const price = getPrice(t.ticker, date)
        if (price != null) {
          unrealizedPnl += CONFIG.positionSize * (price - t.entryPrice) / t.entryPrice
          investedToday += CONFIG.positionSize
        }
      }
    }

    // Compute realized as of this date
    let realized = 0
    for (const t of trades) {
      if (!t.isOpen && t.exitDate <= date) realized += t.dollarPnl
    }

    curve.push({ date, pnl: realized + unrealizedPnl, invested: investedToday })
  }

  return curve
}

// ── Stats helpers ─────────────────────────────────────────────────────────────

function avg(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log()
  console.log('╔══════════════════════════════════════════════════════════════════════╗')
  console.log('║  ⚠  PAPER TRADING SIMULATION — HINDSIGHT-BIASED, EDUCATION ONLY  ⚠ ║')
  console.log('║  Entry prices from Form 4 filings (may differ from market price).  ║')
  console.log('║  Exit triggers simulated from daily OHLC bars via Yahoo Finance.   ║')
  console.log('╚══════════════════════════════════════════════════════════════════════╝')
  console.log()
  console.log('  CONFIG:')
  console.log(`    Signal set:    ${CONFIG.classifications.join('+')} score ≥ ${CONFIG.minScore}`)
  console.log(`    Window:        ${CONFIG.cutoff} → ${TODAY}`)
  console.log(`    Position size: $${CONFIG.positionSize} per trade`)
  console.log(`    Take profit:   +${CONFIG.takeProfitPct}%`)
  console.log(`    Stop loss:     -${CONFIG.stopLossPct}%`)
  console.log(`    Max hold:      ${CONFIG.maxHoldDays} calendar days`)
  console.log()

  // 1. Fetch signals
  process.stdout.write('  Fetching signals...')
  const signals = await fetchSignals()
  const withPrice = signals.filter(s => s.entryPrice != null && s.entryPrice > 0)
  const noPrice   = signals.filter(s => s.entryPrice == null || s.entryPrice <= 0)
  console.log(` ${signals.length} total (${withPrice.length} have entry price, ${noPrice.length} skipped)`)
  if (noPrice.length) console.log(`    No price: ${noPrice.map(s => s.ticker).join(', ')}`)

  if (!withPrice.length) { console.log('  No signals with entry price. Exiting.'); return }

  // 2. Fetch daily bars for each unique ticker
  const uniqueTickers = [...new Set(withPrice.map(s => s.ticker))]
  console.log(`  Fetching daily OHLC for ${uniqueTickers.length} tickers...`)

  const allBars = new Map<string, DailyBar[]>()
  let fetched = 0
  const BATCH = 1  // One at a time for chart() — it doesn't support bulk
  for (const ticker of uniqueTickers) {
    // Fetch from min entry date for this ticker to today + buffer
    const tickerSignals = withPrice.filter(s => s.ticker === ticker)
    const minDate = tickerSignals.map(s => s.date).sort()[0]
    const bars = await fetchDailyBars(ticker, minDate, TODAY)
    allBars.set(ticker, bars)
    fetched++
    process.stdout.write(`\r  Daily OHLC: ${fetched}/${uniqueTickers.length} tickers (${ticker.padEnd(6)}) — ${bars.length} bars`)
    await sleep(300)
  }
  console.log()

  // 3. Simulate each trade
  console.log('  Simulating trades...')
  const trades: TradeResult[] = []
  for (const s of withPrice) {
    const bars = allBars.get(s.ticker) ?? []
    const result = simulateTrade(s, bars)
    trades.push(result)
  }

  // Separate bad-data and valid trades
  const validTrades = trades.filter(t => t.exitReason !== 'no-data')
  const badDataTrades = trades.filter(t => t.exitReason === 'no-data')

  // Flag likely Form 4 entry-price errors (|return| > 200% at current prices)
  const OUTLIER_THRESHOLD = 200
  const outlierTrades = validTrades.filter(t => Math.abs(t.returnPct) > OUTLIER_THRESHOLD)
  const cleanTrades   = validTrades.filter(t => Math.abs(t.returnPct) <= OUTLIER_THRESHOLD)

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalInvested = validTrades.length * CONFIG.positionSize
  const totalPnl      = validTrades.reduce((a, t) => a + t.dollarPnl, 0)
  const totalPnlClean = cleanTrades.reduce((a, t) => a + t.dollarPnl, 0)

  const byReason = {
    tp:   validTrades.filter(t => t.exitReason === 'take-profit'),
    sl:   validTrades.filter(t => t.exitReason === 'stop-loss'),
    time: validTrades.filter(t => t.exitReason === 'time-exit'),
    open: validTrades.filter(t => t.isOpen),
  }

  const returns     = cleanTrades.map(t => t.returnPct)
  const winners     = cleanTrades.filter(t => t.returnPct > 0)
  const losers      = cleanTrades.filter(t => t.returnPct <= 0)

  console.log()
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log('  PORTFOLIO SUMMARY')
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log()
  console.log(`  Signals taken:         ${validTrades.length}`)
  console.log(`  Bad/missing data:      ${badDataTrades.length + noPrice.length}  (skipped)`)
  console.log(`  Outliers (|ret|>200%): ${outlierTrades.length}  (Form 4 filing errors — see below)`)
  console.log()
  console.log(`  Total invested:        $${totalInvested.toFixed(2)}  ($${CONFIG.positionSize} × ${validTrades.length})`)
  console.log(`  Total P&L (all):       ${fmtDollar(totalPnl)}`)
  console.log(`  Total P&L (clean):     ${fmtDollar(totalPnlClean)}`)
  console.log(`  Portfolio return:      ${fmtPct(totalPnlClean / (cleanTrades.length * CONFIG.positionSize) * 100)}  (clean trades only)`)
  console.log()
  console.log(`  Exit breakdown:`)
  console.log(`    Take-profit (+${CONFIG.takeProfitPct}%): ${byReason.tp.length}`)
  console.log(`    Stop-loss   (-${CONFIG.stopLossPct}%): ${byReason.sl.length}`)
  console.log(`    Time exit (${CONFIG.maxHoldDays}d):   ${byReason.time.length}`)
  console.log(`    Still open:        ${byReason.open.length}`)
  console.log()
  console.log(`  Per-trade stats (clean trades, n=${cleanTrades.length}):`)
  console.log(`    Avg return:        ${fmtPct(avg(returns))}`)
  console.log(`    Median return:     ${fmtPct(median(returns))}`)
  console.log(`    Win rate (>0):     ${(winners.length / cleanTrades.length * 100).toFixed(0)}%  (${winners.length}/${cleanTrades.length})`)
  console.log(`    Avg win:           ${fmtPct(avg(winners.map(t => t.returnPct)))}`)
  console.log(`    Avg loss:          ${fmtPct(avg(losers.map(t => t.returnPct)))}`)
  console.log(`    Avg $ per trade:   ${fmtDollar(avg(cleanTrades.map(t => t.dollarPnl)))}`)
  console.log(`    Best trade:        ${fmtPct(Math.max(...returns))}`)
  console.log(`    Worst trade:       ${fmtPct(Math.min(...returns))}`)

  if (outlierTrades.length) {
    console.log()
    console.log('  ── Outlier trades (excluded from clean stats) ──────────────────────')
    console.log('     These likely have Form 4 entry prices ≠ market price')
    for (const t of outlierTrades) {
      console.log(`     ${t.ticker.padEnd(8)} entry=$${t.entryPrice.toFixed(4)}  ret=${fmtPct(t.returnPct)}  reason=${t.exitReason}`)
    }
  }

  // ── Full trade log ─────────────────────────────────────────────────────────
  console.log()
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log('  FULL TRADE LOG  (sorted by return, clean trades only)')
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log()
  const hdr = `  ${'Ticker'.padEnd(8)} ${'Entry'.padEnd(11)} ${'EntryPx'.padStart(9)} ${'Exit'.padEnd(11)} ${'ExitPx'.padStart(8)} ${'Days'.padStart(5)} ${'Return'.padStart(8)} ${'$P&L'.padStart(8)} ${'Reason'.padEnd(13)} ${'Score'.padStart(5)}`
  console.log(hdr)
  console.log(`  ${'-'.repeat(103)}`)
  const sortedClean = [...cleanTrades].sort((a, b) => b.returnPct - a.returnPct)
  for (const t of sortedClean) {
    const openFlag = t.isOpen ? ' *' : '  '
    console.log(
      `  ${t.ticker.padEnd(8)} ${t.entryDate.padEnd(11)} ${('$'+t.entryPrice.toFixed(2)).padStart(9)} ${t.exitDate.padEnd(11)} ${('$'+t.exitPrice.toFixed(2)).padStart(8)} ${String(t.daysHeld).padStart(5)} ${fmtPct(t.returnPct).padStart(8)} ${fmtDollar(t.dollarPnl).padStart(8)} ${t.exitReason.padEnd(13)}${openFlag}${String(t.score).padStart(5)}`
    )
  }
  console.log('  * = still open, valued at most recent close')

  // ── Equity curve data (console) ────────────────────────────────────────────
  console.log()
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log('  BUILDING EQUITY CURVE...')
  console.log('══════════════════════════════════════════════════════════════════════')
  const curve = buildEquityCurve(trades, allBars)

  // Print monthly snapshots
  console.log()
  console.log('  Monthly P&L snapshots:')
  const seenMonths = new Set<string>()
  for (const pt of curve) {
    const month = pt.date.slice(0, 7)
    if (!seenMonths.has(month)) {
      seenMonths.add(month)
      console.log(`    ${pt.date}  net_pnl=${fmtDollar(pt.pnl).padStart(10)}  open_positions=${pt.invested > 0 ? '$' + pt.invested.toFixed(0) : '$0'}`)
    }
  }
  // Final value
  const last = curve[curve.length - 1]
  if (last) console.log(`    ${last.date}  net_pnl=${fmtDollar(last.pnl).padStart(10)}  (final)`)

  // ── Save JSON for artifact ─────────────────────────────────────────────────
  const output = {
    config:      CONFIG,
    runDate:     TODAY,
    summary: {
      totalSignals:  signals.length,
      tradesSimulated: validTrades.length,
      cleanTrades:   cleanTrades.length,
      outliers:      outlierTrades.length,
      totalInvested: cleanTrades.length * CONFIG.positionSize,
      totalPnl:      totalPnlClean,
      portfolioReturn: totalPnlClean / (cleanTrades.length * CONFIG.positionSize) * 100,
      avgReturn:     avg(returns),
      medianReturn:  median(returns),
      winRate:       winners.length / cleanTrades.length * 100,
      byReason: {
        takeProfit: byReason.tp.length,
        stopLoss:   byReason.sl.length,
        timeExit:   byReason.time.length,
        open:       byReason.open.length,
      },
    },
    trades: sortedClean.map(t => ({
      ticker:      t.ticker,
      entryDate:   t.entryDate,
      entryPrice:  t.entryPrice,
      exitDate:    t.exitDate,
      exitPrice:   t.exitPrice,
      exitReason:  t.exitReason,
      daysHeld:    t.daysHeld,
      returnPct:   t.returnPct,
      dollarPnl:   t.dollarPnl,
      score:       t.score,
      isOpen:      t.isOpen,
    })),
    equityCurve: curve,
  }

  const outPath = path.join(__dirname, '..', 'output', 'paper-trade-results.json')
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2))
  console.log()
  console.log(`  Results saved to: output/paper-trade-results.json`)

  console.log()
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log('  ⚠  REMINDER: ALL RESULTS ARE HINDSIGHT-BIASED.')
  console.log('  Entry prices are from Form 4 filings and may not reflect actual')
  console.log('  market prices. Daily bars are from Yahoo Finance (adjusted close).')
  console.log('  Stop/take-profit fills are approximated — real slippage would be worse.')
  console.log('══════════════════════════════════════════════════════════════════════')
  console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
