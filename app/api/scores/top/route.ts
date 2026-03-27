import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const [longsRes, shortsRes] = await Promise.all([
    supabase
      .from('signals')
      .select('ticker, score, analyst_gap, analyst_target, current_price, recommendation, signal, computed_at')
      .order('score', { ascending: false })
      .limit(10),
    supabase
      .from('signals')
      .select('ticker, score, analyst_gap, analyst_target, current_price, recommendation, signal, computed_at')
      .order('score', { ascending: true })
      .limit(10),
  ])

  if (longsRes.error) return NextResponse.json({ error: longsRes.error.message }, { status: 500 })
  if (shortsRes.error) return NextResponse.json({ error: shortsRes.error.message }, { status: 500 })

  const longs  = longsRes.data  ?? []
  const shorts = shortsRes.data ?? []

  // Fetch company names
  const allTickers = [...new Set([...longs, ...shorts].map((r) => r.ticker))]
  if (allTickers.length > 0) {
    const { data: tickerRows } = await supabase
      .from('tickers')
      .select('symbol, name')
      .in('symbol', allTickers)

    const nameMap: Record<string, string> = {}
    for (const t of tickerRows ?? []) nameMap[t.symbol] = t.name
    for (const row of [...longs, ...shorts]) (row as any).name = nameMap[row.ticker] ?? null
  }

  const allRows = [...longs, ...shorts]
  const lastUpdated = allRows.length > 0
    ? allRows.reduce((latest, r) => r.computed_at > latest ? r.computed_at : latest, allRows[0].computed_at)
    : null

  return NextResponse.json({ longs, shorts, lastUpdated })
}
