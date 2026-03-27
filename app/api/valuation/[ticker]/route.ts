import { NextResponse } from 'next/server'
import { getValuation } from '@/lib/scoring/sentraScore'

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
    const result = await getValuation(ticker)
    return NextResponse.json({ ticker, ...result })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Failed to fetch valuation' }, { status: 500 })
  }
}
