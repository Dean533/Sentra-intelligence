import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import yahooFinance from 'yahoo-finance2'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function offsetDate(base: Date, days: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

// Returns the row whose date is the first trading day on or after targetDate.
function priceAtOrAfter(history: HistRow[], targetDate: Date): HistRow | null {
  const ts = targetDate.getTime()
  return (
    history
      .filter((r) => r.date.getTime() >= ts)
      .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null
  )
}

// Returns the row whose date is the closest trading day on or before targetDate.
function priceAtOrBefore(history: HistRow[], targetDate: Date): HistRow | null {
  const ts = targetDate.getTime()
  return (
    history
      .filter((r) => r.date.getTime() <= ts)
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null
  )
}

function pctChange(from: number, to: number): number {
  return Math.round(((to - from) / from) * 10000) / 100
}

type HistRow = { date: Date; close: number; adjClose?: number; volume: number }

async function fetchHistory(symbol: string, from: Date, to: Date): Promise<HistRow[]> {
  try {
    const rows = await yahooFinance.historical(symbol, {
      period1: from,
      period2: to,
      interval: '1d',
    }) as any[]
    return rows.map((r) => ({
      date: r.date,
      close: r.adjClose ?? r.close,
      volume: r.volume ?? 0,
    }))
  } catch {
    return []
  }
}

// Cache sector and SPY moves by date string to avoid redundant fetches.
const sectorMoveCache = new Map<string, number>()  // key: `${sector}::${dateStr}`
const spyMoveCache    = new Map<string, number>()  // key: dateStr

async function getSpyMove(dateStr: string): Promise<number | null> {
  if (spyMoveCache.has(dateStr)) return spyMoveCache.get(dateStr)!

  const eventDate = new Date(dateStr)
  const history   = await fetchHistory('SPY', offsetDate(eventDate, -3), offsetDate(eventDate, 2))
  const dayRow    = priceAtOrAfter(history, eventDate)
  const prevRow   = dayRow ? priceAtOrBefore(history, new Date(dayRow.date.getTime() - 1)) : null

  if (!dayRow || !prevRow) return null
  const move = pctChange(prevRow.close, dayRow.close)
  spyMoveCache.set(dateStr, move)
  return move
}

async function getSectorMove(
  sector: string,
  dateStr: string,
  sectorSymbols: string[]
): Promise<number | null> {
  const key = `${sector}::${dateStr}`
  if (sectorMoveCache.has(key)) return sectorMoveCache.get(key)!

  const eventDate = new Date(dateStr)
  const from = offsetDate(eventDate, -3)
  const to   = offsetDate(eventDate, 2)

  // Sample up to 20 tickers to keep API calls manageable
  const sample = sectorSymbols.slice(0, 20)
  const moves: number[] = []

  for (const sym of sample) {
    const hist    = await fetchHistory(sym, from, to)
    const dayRow  = priceAtOrAfter(hist, eventDate)
    const prevRow = dayRow ? priceAtOrBefore(hist, new Date(dayRow.date.getTime() - 1)) : null
    if (dayRow && prevRow) moves.push(pctChange(prevRow.close, dayRow.close))
    await sleep(120)
  }

  if (moves.length === 0) return null
  const avg = Math.round((moves.reduce((a, b) => a + b, 0) / moves.length) * 100) / 100
  sectorMoveCache.set(key, avg)
  return avg
}

// ─── main handler ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // 1. Fetch unenriched events
  const { data: events, error } = await supabase
    .from('events')
    .select('id, ticker, event_date')
    .not('event_date', 'is', null)
    .is('price_on_day', null)
    .order('event_date', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!events || events.length === 0) return NextResponse.json({ total: 0, success: 0, failed: 0 })

  // 2. Load ticker→sector map once
  const { data: tickerRows } = await supabase
    .from('tickers')
    .select('symbol, sector')

  const tickerSector: Record<string, string> = {}
  const sectorSymbols: Record<string, string[]> = {}
  for (const row of tickerRows ?? []) {
    tickerSector[row.symbol] = row.sector
    if (row.sector) {
      sectorSymbols[row.sector] ??= []
      sectorSymbols[row.sector].push(row.symbol)
    }
  }

  let success = 0
  let failed  = 0

  // 3. Process in batches of 10
  for (let i = 0; i < events.length; i += 10) {
    const batch = events.slice(i, i + 10)

    await Promise.allSettled(
      batch.map(async (ev) => {
        try {
          const eventDate  = new Date(ev.event_date)
          const windowFrom = offsetDate(eventDate, -35)
          const windowTo   = offsetDate(eventDate, 8)

          const history = await fetchHistory(ev.ticker, windowFrom, windowTo)
          if (history.length === 0) throw new Error('no history')

          // ── event day ──────────────────────────────────────────────────────
          const dayRow  = priceAtOrAfter(history, eventDate)
          if (!dayRow) throw new Error('no price on event day')

          const prevRow = priceAtOrBefore(history, new Date(dayRow.date.getTime() - 1))
          const price0  = dayRow.close

          // ── T+1, T+3, T+5 ─────────────────────────────────────────────────
          const rowT1 = priceAtOrAfter(history, offsetDate(dayRow.date, 1))
          const rowT3 = priceAtOrAfter(history, offsetDate(dayRow.date, 3))
          const rowT5 = priceAtOrAfter(history, offsetDate(dayRow.date, 5))

          // ── pre-event drift (T−3 close → event day close) ─────────────────
          const rowPreStart = priceAtOrBefore(history, offsetDate(dayRow.date, -3))
          const preDrift = rowPreStart ? pctChange(rowPreStart.close, price0) : null

          // ── volume avg 30d ─────────────────────────────────────────────────
          const thirtyDayHistory = history.filter(
            (r) => r.date < dayRow.date && r.date >= offsetDate(dayRow.date, -30)
          )
          const volAvg = thirtyDayHistory.length > 0
            ? Math.round(thirtyDayHistory.reduce((s, r) => s + r.volume, 0) / thirtyDayHistory.length)
            : null

          // ── sector & SPY ───────────────────────────────────────────────────
          const sector       = tickerSector[ev.ticker]
          const dateStr      = dayRow.date.toISOString().split('T')[0]
          const spyMove      = await getSpyMove(dateStr)
          const sectorMove   = sector
            ? await getSectorMove(sector, dateStr, sectorSymbols[sector] ?? [])
            : null

          // ── build update payload ───────────────────────────────────────────
          const update: Record<string, any> = {
            price_on_day:    price0,
            volume_on_day:   dayRow.volume || null,
            volume_avg_30d:  volAvg,
            volume_ratio:    volAvg && dayRow.volume ? Math.round((dayRow.volume / volAvg) * 100) / 100 : null,
            pre_event_drift: preDrift,
            spy_move_on_day:    spyMove,
            sector_move_on_day: sectorMove,
          }

          if (rowT1) {
            update.price_t1        = rowT1.close
            update.price_change_t1 = pctChange(price0, rowT1.close)
          }
          if (rowT3) {
            update.price_t3        = rowT3.close
            update.price_change_t3 = pctChange(price0, rowT3.close)
          }
          if (rowT5) {
            update.price_t5        = rowT5.close
            update.price_change_t5 = pctChange(price0, rowT5.close)
          }
          // Store the actual trading date found (may differ from published_at)
          if (dayRow) {
            update.event_date = dateStr
          }

          const { error: updateErr } = await supabase
            .from('events')
            .update(update)
            .eq('id', ev.id)

          if (updateErr) throw new Error(updateErr.message)
          success++
        } catch {
          failed++
        }
      })
    )

    if (i + 10 < events.length) await sleep(2000)
  }

  return NextResponse.json({ total: events.length, success, failed })
}
