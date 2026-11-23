import YahooFinance from 'yahoo-finance2'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { config as dotenvConfig } from 'dotenv'

dotenvConfig({ path: path.join(process.cwd(), '.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const CONFIG = {
  cutoff:          '2026-05-01',
  classifications: ['OPPORTUNISTIC'],
  minScore:        80,
  positionSize:    100,
  maxHoldDays:     90,
  excludeTickers:  new Set<string>(),  // IRTC included
}

const yf    = new YahooFinance()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── DB ──────────────────────────────────────────────────────────────────────

async function fetchSignals() {
  const rows: any[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('insider_transactions')
      .select('id,ticker,transaction_date,price_per_share,conviction_score,classification,transaction_code')
      .in('classification', CONFIG.classifications)
      .gte('conviction_score', CONFIG.minScore)
      .gte('transaction_date', CONFIG.cutoff)
      .eq('transaction_code', 'P')
      .not('price_per_share', 'is', null)
      .gt('price_per_share', 0)
      .order('transaction_date', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 1000) break
    from += 1000
  }
  return rows.filter(r => !CONFIG.excludeTickers.has(r.ticker))
}

// ── Price data ───────────────────────────────────────────────────────────────

type Bar = { date: string; open: number; high: number; low: number; close: number }

async function fetchDailyBars(ticker: string, startDate: string): Promise<Bar[]> {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() + 1)
  try {
    const res = await yf.chart(ticker, {
      period1:  startDate,
      period2:  end.toISOString().split('T')[0],
      interval: '1d',
    })
    return (res.quotes ?? [])
      .filter((q: any) => q.date && q.high != null && q.close != null && q.open != null)
      .map((q: any) => ({
        date:  new Date(q.date).toISOString().split('T')[0],
        open:  q.open  as number,
        high:  q.high  as number,
        low:   q.low   as number,
        close: q.close as number,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

// ── Exit logic ───────────────────────────────────────────────────────────────

function computeTrade(signal: any, bars: Bar[]) {
  const entryDate  = signal.transaction_date.split('T')[0]
  const entryPrice = signal.price_per_share as number

  // Find bars starting from entry date
  const startIdx = bars.findIndex(b => b.date >= entryDate)
  if (startIdx < 0 || bars.length === 0) return null

  const window = bars.slice(startIdx, startIdx + CONFIG.maxHoldDays)
  if (window.length === 0) return null

  const isOpen = window.length < CONFIG.maxHoldDays

  // ── Perfect hindsight: max(high) across all bars in window ──
  let peakHigh  = -Infinity
  let peakDate  = window[0].date
  for (const b of window) {
    if (b.high > peakHigh) { peakHigh = b.high; peakDate = b.date }
  }

  // ── Hold 90: close of final bar (day 90 or latest available) ──
  const lastBar    = window[window.length - 1]
  const hold90Px   = lastBar.close
  const hold90Date = lastBar.date
  const daysHeld   = window.length

  const peakReturn  = (peakHigh   - entryPrice) / entryPrice * 100
  const hold90Return = (hold90Px  - entryPrice) / entryPrice * 100

  return {
    ticker:       signal.ticker,
    score:        signal.conviction_score,
    entryDate,
    entryPrice,
    daysHeld,
    isOpen,

    // Perfect hindsight
    peakHigh:     +peakHigh.toFixed(4),
    peakDate,
    peakReturn:   +peakReturn.toFixed(2),
    peakDollar:   +(CONFIG.positionSize * peakReturn / 100).toFixed(2),

    // Hold 90 (or current if open)
    hold90Px:     +hold90Px.toFixed(4),
    hold90Date,
    hold90Return: +hold90Return.toFixed(2),
    hold90Dollar: +(CONFIG.positionSize * hold90Return / 100).toFixed(2),
  }
}

// ── Stats helpers ────────────────────────────────────────────────────────────

function median(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function stratSummary(label: string, trades: any[], dollarsKey: string, returnKey: string, invested: number) {
  const dollars  = trades.map(t => t[dollarsKey] as number)
  const returns  = trades.map(t => t[returnKey]  as number)
  const totalPnl = dollars.reduce((a, b) => a + b, 0)
  const wins     = returns.filter(r => r > 0).length
  return {
    label,
    n:             trades.length,
    totalInvested: invested,
    totalPnl:      +totalPnl.toFixed(2),
    portfolioRet:  +(totalPnl / invested * 100).toFixed(2),
    avgReturn:     +(returns.reduce((a, b) => a + b, 0) / returns.length).toFixed(2),
    medianReturn:  +median(returns).toFixed(2),
    winRate:       +(wins / trades.length * 100).toFixed(1),
    wins,
    losses:        trades.length - wins,
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching signals (OPP 80+, excl. IRTC)...')
  const signals = await fetchSignals()
  console.log(`  ${signals.length} signals`)

  const trades: ReturnType<typeof computeTrade>[] = []
  const failed: string[] = []

  for (const sig of signals) {
    const ticker = sig.ticker
    const date   = sig.transaction_date.split('T')[0]
    process.stdout.write(`  ${ticker.padEnd(6)} ${date}  `)
    await sleep(300)
    const bars = await fetchDailyBars(ticker, date)
    const t    = computeTrade(sig, bars)
    if (!t) { failed.push(`${ticker}@${date}`); console.log('NO BARS'); continue }
    trades.push(t)
    const openTag = t.isOpen ? ' (open)' : ''
    console.log(
      `peak ${t.peakReturn >= 0 ? '+' : ''}${t.peakReturn.toFixed(1)}%  ` +
      `hold90 ${t.hold90Return >= 0 ? '+' : ''}${t.hold90Return.toFixed(1)}%${openTag}`
    )
  }

  const n = trades.length
  const invested = n * CONFIG.positionSize

  const ph   = stratSummary('perfectHindsight', trades, 'peakDollar',   'peakReturn',   invested)
  const h90  = stratSummary('hold90',           trades, 'hold90Dollar', 'hold90Return', invested)

  // Realistic from previous paper-trade sim (OPP 80+, +20% TP, -10% SL, 90d; excl. IRTC)
  const realistic = {
    label:        'realistic',
    n:            51,
    totalInvested: 5100,
    totalPnl:     11.33,
    portfolioRet: 0.22,
    avgReturn:    0.22,
    medianReturn: 4.30,
    winRate:      61.0,
    wins:         31,
    losses:       20,
    note:         '+20% TP / -10% SL / 90d from paper-trade.ts run',
  }

  console.log('\n══ COMPARISON ═════════════════════════════════════════════════════')
  console.log(`                   Perfect Hindsight   Realistic    Hold 90 Days`)
  console.log(`Trades:            ${String(ph.n).padStart(8)}             ${realistic.n}          ${h90.n}`)
  console.log(`Total P&L:         $${String(ph.totalPnl.toFixed(0)).padStart(7)}           $${realistic.totalPnl.toFixed(0)}       $${h90.totalPnl.toFixed(0)}`)
  console.log(`Portfolio return:  ${ph.portfolioRet.toFixed(1)}%              ${realistic.portfolioRet}%       ${h90.portfolioRet.toFixed(1)}%`)
  console.log(`Avg per trade:     ${ph.avgReturn.toFixed(1)}%              ${realistic.avgReturn}%       ${h90.avgReturn.toFixed(1)}%`)
  console.log(`Median per trade:  ${ph.medianReturn.toFixed(1)}%             ${realistic.medianReturn}%       ${h90.medianReturn.toFixed(1)}%`)
  console.log(`Win rate:          ${ph.winRate.toFixed(0)}%              ${realistic.winRate}%       ${h90.winRate.toFixed(0)}%`)
  console.log('═══════════════════════════════════════════════════════════════════')

  // Highlight any trades where even perfect hindsight = negative (stock only went down)
  const phLosers = trades.filter(t => t!.peakReturn < 0)
  if (phLosers.length > 0) {
    console.log(`\n⚠ ${phLosers.length} trades where peak < entry price (stock never recovered):`)
    phLosers.forEach(t => console.log(`  ${t!.ticker.padEnd(6)} entry=$${t!.entryPrice}  peak=$${t!.peakHigh}  (${t!.peakReturn.toFixed(1)}%)`))
  }

  const output = {
    config: { ...CONFIG, excludeTickers: [...CONFIG.excludeTickers] },
    comparison: { perfectHindsight: ph, realistic, hold90: h90 },
    trades: trades.sort((a, b) => b!.peakReturn - a!.peakReturn),
    failed,
  }

  fs.writeFileSync('output/perfect-hindsight-results.json', JSON.stringify(output, null, 2))
  console.log('\nSaved → output/perfect-hindsight-results.json')
}

main().catch(console.error)
