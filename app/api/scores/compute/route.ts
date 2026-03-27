import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { calculateSentraScore, getValuation } from '@/lib/scoring/sentraScore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function GET() {
  const { data: rows, error } = await supabase
    .from('tickers')
    .select('symbol')
    .order('market_cap', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const symbols = (rows ?? []).map((r: any) => r.symbol as string)
  let success = 0
  let failed = 0
  const upsertRows: any[] = []
  const computedAt = new Date().toISOString()

  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5)

    const results = await Promise.allSettled(
      batch.map(async (symbol) => {
        const [scoreResult, valuationResult] = await Promise.all([
          calculateSentraScore(symbol, supabase),
          getValuation(symbol),
        ])
        return { symbol, scoreResult, valuationResult }
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { symbol, scoreResult, valuationResult } = result.value
        upsertRows.push({
          ticker:         symbol,
          score:          scoreResult.score,
          analyst_gap:    valuationResult.analystGap,
          analyst_target: valuationResult.analystTarget,
          current_price:  valuationResult.currentPrice,
          recommendation: valuationResult.recommendation,
          signal:         valuationResult.signal,
          computed_at:    computedAt,
        })
        success++
      } else {
        failed++
      }
    }

    if (i + 5 < symbols.length) await sleep(1000)
  }

  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase
      .from('signals')
      .upsert(upsertRows, { onConflict: 'ticker', ignoreDuplicates: false })

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ total: symbols.length, success, failed })
}
