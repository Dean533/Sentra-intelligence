import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { ingestTicker } from '@/lib/newsIngestion'
import { authorizeCron } from '@/lib/cronAuth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  const { data: rows, error } = await supabase
    .from('tickers')
    .select('symbol')
    .order('market_cap', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const symbols = (rows ?? []).map((r: any) => r.symbol as string)
  let success = 0
  let failed = 0

  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map((symbol) => ingestTicker(symbol, supabase))
    )
    for (const result of results) {
      if (result.status === 'fulfilled') success++
      else failed++
    }
    if (i + 5 < symbols.length) await sleep(1000)
  }

  return NextResponse.json({ total: symbols.length, success, failed })
}
