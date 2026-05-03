import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'
import { getPositions, placeMarketSell } from '@/lib/alpaca'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const EARLY_EXIT_DAYS    = 30
const EARLY_EXIT_LOSS_PC = -0.05  // -5%

export async function GET(req: Request) {
  const authError = authorizeCron(req)
  if (authError) return authError

  const positions = await getPositions()
  if (positions.length === 0) return NextResponse.json({ exited: [], skipped: [] })

  const symbols = positions.map(p => p.symbol)

  // Fetch open paper_trades for these tickers, newest entry per ticker
  const { data: trades, error: tradesErr } = await supabase
    .from('paper_trades')
    .select('id, ticker, created_at')
    .eq('status', 'open')
    .in('ticker', symbols)
  if (tradesErr) return NextResponse.json({ error: tradesErr.message }, { status: 500 })

  // Map ticker → earliest open trade (in case of multiple open entries)
  const tradeMap: Record<string, { id: string; created_at: string }> = {}
  for (const t of trades ?? []) {
    if (!tradeMap[t.ticker] || t.created_at < tradeMap[t.ticker].created_at) {
      tradeMap[t.ticker] = { id: t.id, created_at: t.created_at }
    }
  }

  const today = Date.now()
  const exited: string[] = []
  const skipped: string[] = []

  for (const pos of positions) {
    const trade = tradeMap[pos.symbol]
    if (!trade) { skipped.push(`${pos.symbol}:no_trade`); continue }

    const daysHeld = Math.floor((today - new Date(trade.created_at).getTime()) / 86400000)
    const plpc     = parseFloat(pos.unrealized_plpc)  // e.g. -0.07 = -7%

    if (daysHeld <= EARLY_EXIT_DAYS && plpc < EARLY_EXIT_LOSS_PC) {
      try {
        await placeMarketSell(pos.symbol, parseFloat(pos.qty))
        await supabase
          .from('paper_trades')
          .update({ status: 'closed', closed_at: new Date().toISOString(), exit_reason: 'early_exit_30d' })
          .eq('id', trade.id)
        exited.push(`${pos.symbol} (days=${daysHeld}, plpc=${(plpc * 100).toFixed(1)}%)`)
      } catch (err: any) {
        skipped.push(`${pos.symbol}:sell_error:${err.message}`)
      }
    } else {
      skipped.push(`${pos.symbol}:no_exit (days=${daysHeld}, plpc=${(plpc * 100).toFixed(1)}%)`)
    }
  }

  return NextResponse.json({ exited, skipped })
}
