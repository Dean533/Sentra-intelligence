import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  // MAX signal_month where conviction_score > 0
  const { data: latest, error: latestErr } = await supabase
    .from('insider_signals_monthly')
    .select('signal_month')
    .gt('conviction_score', 0)
    .order('signal_month', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestErr) return NextResponse.json({ error: latestErr.message }, { status: 500 })
  if (!latest)   return NextResponse.json({ data: [], signal_month: null })

  const signalMonth = latest.signal_month as string  // e.g. "2026-03-01"

  // All signals for that month, sorted by conviction_score DESC
  const { data: signals, error: sigErr } = await supabase
    .from('insider_signals_monthly')
    .select('ticker, conviction_score, signal_direction, signal_month, hold_days')
    .eq('signal_month', signalMonth)
    .order('conviction_score', { ascending: false })

  if (sigErr) return NextResponse.json({ error: sigErr.message }, { status: 500 })
  if (!signals || signals.length === 0) return NextResponse.json({ data: [], signal_month: signalMonth })

  const tickers = signals.map((s: any) => s.ticker)

  // Compute end of month using signalMonth directly — no string construction
  const endDate = new Date(signalMonth)
  endDate.setMonth(endDate.getMonth() + 1)
  const nextMonth = endDate.toISOString().slice(0, 10)

  // All buy transactions for those tickers in that month
  const { data: txRows, error: txErr } = await supabase
    .from('insider_transactions')
    .select('ticker, insider_name, officer_title, role, total_value')
    .in('ticker', tickers)
    .eq('transaction_direction', 'buy')
    .gte('transaction_date', signalMonth)
    .lt('transaction_date', nextMonth)
    .order('total_value', { ascending: false })

  if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

  // Per ticker: lead insider = highest total_value buy; total buy value = sum
  type TxRow = { ticker: string; insider_name: string | null; officer_title: string | null; role: string | null; total_value: number | null }
  const leadMap   = new Map<string, TxRow>()
  const totalMap  = new Map<string, number>()

  for (const tx of (txRows ?? []) as TxRow[]) {
    if (!leadMap.has(tx.ticker)) leadMap.set(tx.ticker, tx)
    totalMap.set(tx.ticker, (totalMap.get(tx.ticker) ?? 0) + (tx.total_value ?? 0))
  }

  const data = signals.map((s: any) => {
    const lead = leadMap.get(s.ticker)
    return {
      ticker:            s.ticker,
      conviction_score:  s.conviction_score,
      signal_direction:  s.signal_direction,
      signal_month:      s.signal_month,
      hold_days:         s.hold_days ?? null,
      lead_insider_name: lead?.insider_name ?? null,
      lead_insider_role: lead?.officer_title || lead?.role || null,
      total_buy_value:   totalMap.get(s.ticker) ?? null,
    }
  })

  return NextResponse.json({ data, signal_month: signalMonth })
}
