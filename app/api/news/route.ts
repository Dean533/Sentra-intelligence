import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ingestTicker } from '@/lib/newsIngestion'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const ticker = (searchParams.get('ticker') ?? '').toUpperCase().trim()

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ?ticker= param' }, { status: 400 })
  }

  try {
    const result = await ingestTicker(ticker, supabase)
    return NextResponse.json({ ticker, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to ingest news' }, { status: 500 })
  }
}
