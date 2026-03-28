import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const { data, error } = await supabase
    .from('tickers')
    .select('symbol, name')
    .or(`symbol.ilike.%${q}%,name.ilike.%${q}%`)
    .limit(5)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ results: data ?? [] })
}
