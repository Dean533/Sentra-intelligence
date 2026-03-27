import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { calculateSentraScore } from '@/lib/scoring/sentraScore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params
  const ticker = rawTicker.toUpperCase().trim()

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker' }, { status: 400 })
  }

  try {
    const result = await calculateSentraScore(ticker, supabase)
    return NextResponse.json({ ticker, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to calculate score' }, { status: 500 })
  }
}
