// Run with:  npx tsx scripts/enrich-opportunistic-trades.ts
// Output:    output/opportunistic_trades_enriched.csv

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import YahooFinance from 'yahoo-finance2'

// ─── Load .env.local ──────────────────────────────────────────────────────────

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('ERROR: .env.local not found at', envPath)
    process.exit(1)
  }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const yahooFinance = new YahooFinance()

// ─── Config ───────────────────────────────────────────────────────────────────

const YAHOO_DELAY_MS = 200
const OUTPUT_PATH    = path.join(__dirname, '..', 'output', 'opportunistic_trades_enriched.csv')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function addDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function pct(entry: number, exit: number): number {
  return Math.round(((exit - entry) / entry) * 10000) / 100  // 2 decimal places
}

// Build a date→close map from a yahoo-finance2 chart result.
// Keys are YYYY-MM-DD strings. Only includes days with a valid close.
function buildPriceMap(quotes: any[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const q of quotes) {
    if (q?.date == null || q?.close == null) continue
    map.set(isoDate(new Date(q.date)), q.close)
  }
  return map
}

// Find the closest available trading day on or after targetDate (up to 7 days forward).
function lookupPrice(map: Map<string, number>, targetDate: Date): number | null {
  for (let offset = 0; offset <= 7; offset++) {
    const d = new Date(targetDate)
    d.setUTCDate(d.getUTCDate() + offset)
    const price = map.get(isoDate(d))
    if (price != null) return price
  }
  return null
}

// CSV-escape a value
function csvCell(v: string | number | boolean | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Trade = {
  id:                   string
  ticker:               string
  insider_name:         string
  insider_cik:          string | null
  officer_title:        string | null
  role:                 string | null
  transaction_date:     string
  transaction_code:     string
  transaction_direction:string
  shares:               number | null
  price_per_share:      number | null
  total_value:          number | null
  accession_number:     string | null
  filed_date:           string | null
}

type EnrichedRow = Trade & {
  price_entry:          number | null
  price_30d:            number | null
  price_90d:            number | null
  price_180d:           number | null
  return_30d:           number | null
  return_90d:           number | null
  return_180d:          number | null
  signal_correct_30d:   boolean | null
  signal_correct_90d:   boolean | null
}

// ─── CSV writer ───────────────────────────────────────────────────────────────

const CSV_COLUMNS: (keyof EnrichedRow)[] = [
  'id', 'ticker', 'insider_name', 'insider_cik', 'officer_title', 'role',
  'transaction_date', 'transaction_code', 'transaction_direction',
  'shares', 'price_per_share', 'total_value', 'accession_number', 'filed_date',
  'price_entry', 'price_30d', 'price_90d', 'price_180d',
  'return_30d', 'return_90d', 'return_180d',
  'signal_correct_30d', 'signal_correct_90d',
]

function writeCsv(rows: EnrichedRow[]) {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  const header = CSV_COLUMNS.join(',')
  const lines  = rows.map((row) =>
    CSV_COLUMNS.map((col) => csvCell(row[col])).join(',')
  )
  fs.writeFileSync(OUTPUT_PATH, [header, ...lines].join('\n'), 'utf-8')
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading opportunistic buy trades from Supabase...')

  // Step 1: fetch all OPPORTUNISTIC insider CIKs
  const { data: classifications, error: classErr } = await supabase
    .from('insider_classifications')
    .select('insider_cik, classified_year')
    .eq('classification', 'OPPORTUNISTIC')

  if (classErr) {
    console.error('Failed to fetch classifications:', classErr.message)
    process.exit(1)
  }

  if (!classifications || classifications.length === 0) {
    console.log('No OPPORTUNISTIC classifications found. Run /api/insider/classify first.')
    process.exit(0)
  }

  const opportunisticCiks = [...new Set(classifications.map((c: any) => c.insider_cik as string))]

  console.log(`  ${opportunisticCiks.length} insiders with OPPORTUNISTIC classification`)

  // Step 2: fetch ALL buy transactions for those CIKs, no year filter
  const { data: txRows, error: txErr } = await supabase
    .from('insider_transactions')
    .select(
      'id, ticker, insider_name, insider_cik, officer_title, role, ' +
      'transaction_date, transaction_code, transaction_direction, ' +
      'shares, price_per_share, total_value, accession_number, filed_date'
    )
    .in('insider_cik', opportunisticCiks)
    .eq('transaction_direction', 'buy')
    .order('transaction_date', { ascending: true })

  if (txErr) {
    console.error('Failed to fetch transactions:', txErr.message)
    process.exit(1)
  }

  const trades: Trade[] = (txRows ?? []) as Trade[]

  console.log(`  ${trades.length} buy trades for opportunistic insiders`)
  console.log()

  if (trades.length === 0) {
    console.log('No trades to enrich.')
    process.exit(0)
  }

  // Step 4: group by ticker, fetch price history once per ticker
  const tradesByTicker = new Map<string, Trade[]>()
  for (const t of trades) {
    if (!tradesByTicker.has(t.ticker)) tradesByTicker.set(t.ticker, [])
    tradesByTicker.get(t.ticker)!.push(t)
  }

  const enriched: EnrichedRow[] = []
  const tickers = [...tradesByTicker.keys()]

  for (let ti = 0; ti < tickers.length; ti++) {
    const ticker      = tickers[ti]
    const tickerTrades = tradesByTicker.get(ticker)!

    // Date range: earliest trade → latest trade + 185 days (covers the 180d window + buffer)
    const dates       = tickerTrades.map((t) => t.transaction_date).sort()
    const rangeStart  = new Date(dates[0])
    const rangeEnd    = addDays(dates[dates.length - 1], 185)

    console.log(`[${ti + 1}/${tickers.length}] ${ticker.padEnd(6)} — ${tickerTrades.length} trade(s), fetching prices ${isoDate(rangeStart)} → ${isoDate(rangeEnd)}`)

    let priceMap = new Map<string, number>()

    try {
      await sleep(YAHOO_DELAY_MS)
      const chart: any = await yahooFinance.chart(ticker, {
        period1:  rangeStart,
        period2:  rangeEnd,
        interval: '1d',
      })
      priceMap = buildPriceMap(Array.isArray(chart?.quotes) ? chart.quotes : [])
    } catch (err: any) {
      console.log(`  ⚠ Yahoo Finance error for ${ticker}: ${err.message} — prices will be null`)
    }

    for (const trade of tickerTrades) {
      const entryDate  = new Date(trade.transaction_date)
      const date30d    = addDays(trade.transaction_date, 30)
      const date90d    = addDays(trade.transaction_date, 90)
      const date180d   = addDays(trade.transaction_date, 180)

      const priceEntry = lookupPrice(priceMap, entryDate)
      const price30d   = lookupPrice(priceMap, date30d)
      const price90d   = lookupPrice(priceMap, date90d)
      const price180d  = lookupPrice(priceMap, date180d)

      const return30d  = priceEntry != null && price30d  != null ? pct(priceEntry, price30d)  : null
      const return90d  = priceEntry != null && price90d  != null ? pct(priceEntry, price90d)  : null
      const return180d = priceEntry != null && price180d != null ? pct(priceEntry, price180d) : null

      enriched.push({
        ...trade,
        price_entry:        priceEntry,
        price_30d:          price30d,
        price_90d:          price90d,
        price_180d:         price180d,
        return_30d:         return30d,
        return_90d:         return90d,
        return_180d:        return180d,
        signal_correct_30d: return30d  != null ? return30d  > 0 : null,
        signal_correct_90d: return90d  != null ? return90d  > 0 : null,
      })
    }
  }

  // Step 5: write CSV
  writeCsv(enriched)
  console.log()
  console.log(`Written ${enriched.length} rows → ${OUTPUT_PATH}`)

  // Step 6: quick accuracy summary
  const with30d = enriched.filter((r) => r.signal_correct_30d != null)
  const with90d = enriched.filter((r) => r.signal_correct_90d != null)

  if (with30d.length > 0) {
    const correct30 = with30d.filter((r) => r.signal_correct_30d).length
    console.log(`Signal accuracy 30d : ${correct30}/${with30d.length} (${Math.round(correct30 / with30d.length * 100)}%)`)
  }
  if (with90d.length > 0) {
    const correct90 = with90d.filter((r) => r.signal_correct_90d).length
    console.log(`Signal accuracy 90d : ${correct90}/${with90d.length} (${Math.round(correct90 / with90d.length * 100)}%)`)
  }
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
