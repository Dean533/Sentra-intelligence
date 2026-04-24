import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// expected_move_pct is a log-scale CMP formula score (range ~-0.43 to +0.46), NOT a real %.
// Do not display the raw value as a percentage — use signal_strength_label instead.
function signalStrengthLabel(v: number): string {
  if (v > 0.3)   return 'Strong bullish signal'
  if (v > 0.05)  return 'Bullish signal'
  if (v < -0.2)  return 'Strong bearish signal'
  if (v < -0.05) return 'Bearish signal'
  return 'Neutral'
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params

  // Signal window is 1-6 months per Cohen, Malloy & Pomorski (2012) Figure 3
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6)
  sixMonthsAgo.setUTCDate(1)
  const since = sixMonthsAgo.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('insider_signals_monthly')
    .select(
      'signal_direction, expected_move_pct, opportunistic_buy_count, opportunistic_sell_count, local_opportunistic_count, routine_trades_filtered, cluster_strength, signal_month'
    )
    .eq('ticker', ticker.toUpperCase())
    .gte('signal_month', since)
    .order('signal_month', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ data: null })

  const expectedMovePct: number = (data as any).expected_move_pct ?? 0

  return NextResponse.json({
    data: {
      signal_direction:           (data as any).signal_direction,
      expected_move_pct:          expectedMovePct,  // log-scale score, NOT a %; use signal_strength_label for display
      signal_strength_label:      signalStrengthLabel(expectedMovePct),
      opportunistic_buy_count:    (data as any).opportunistic_buy_count,
      opportunistic_sell_count:   (data as any).opportunistic_sell_count,
      local_opportunistic_count:  (data as any).local_opportunistic_count,
      routine_trades_filtered:    (data as any).routine_trades_filtered,
      cluster_strength:           (data as any).cluster_strength,
      signal_month:               (data as any).signal_month,
      timeframe_label:            '1–6 months',
    },
  })
}
