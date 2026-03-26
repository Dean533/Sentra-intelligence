import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ingestTicker } from '@/lib/newsIngestion'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function GET() {
  // Fetch all tickers from DB
  const { data: rows, error } = await supabase
    .from('tickers')
    .select('symbol')
    .order('market_cap', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const symbols = (rows ?? []).map((r: any) => r.symbol as string)
  const results: { ticker: string; inserted: number; total_found: number }[] = []

  for (const symbol of symbols) {
    try {
      const r = await ingestTicker(symbol, supabase)
      results.push({ ticker: symbol, inserted: r.inserted, total_found: r.total_found })
    } catch {
      results.push({ ticker: symbol, inserted: 0, total_found: 0 })
    }
    await sleep(1000)
  }

  const totalInserted = results.reduce((s, r) => s + r.inserted, 0)
  const totalFound    = results.reduce((s, r) => s + r.total_found, 0)

  return NextResponse.json({
    tickers_processed: symbols.length,
    total_inserted: totalInserted,
    total_found: totalFound,
    results,
  })
}
