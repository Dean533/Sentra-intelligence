import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const SELECT = 'id, ticker, insider_name, insider_cik, role, is_director, officer_title, transaction_date, shares, total_value, filed_date, source_url'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const daysParam = searchParams.get('days') ?? '90'
  const role      = searchParams.get('role') ?? 'all'

  const cutoff = daysParam !== 'all'
    ? new Date(Date.now() - parseInt(daysParam, 10) * 86400000).toISOString().split('T')[0]
    : null

  // 1. OPPORTUNISTIC CIKs — used as confirmed gate and inferred exclusion
  const { data: clsRows, error: clsErr } = await supabase
    .from('insider_classifications')
    .select('insider_cik')
    .eq('classification', 'OPPORTUNISTIC')
  if (clsErr) return NextResponse.json({ error: clsErr.message }, { status: 500 })
  const opportunisticCiks = new Set(
    (clsRows ?? []).map((r: any) => r.insider_cik as string).filter(Boolean)
  )

  // 2a. Confirmed: purchases by confirmed OPPORTUNISTIC insiders
  let confirmedQ = supabase
    .from('insider_transactions')
    .select(SELECT)
    .eq('transaction_code', 'P')
    .in('insider_cik', [...opportunisticCiks])
    .order('transaction_date', { ascending: false })
    .limit(50)

  if (cutoff)              confirmedQ = confirmedQ.gte('transaction_date', cutoff)
  if (role === 'ceo')      confirmedQ = confirmedQ.ilike('officer_title', '%Chief Executive%')
  if (role === 'cfo')      confirmedQ = confirmedQ.ilike('officer_title', '%Chief Financial%')
  if (role === 'director') confirmedQ = confirmedQ.eq('is_director', true)
  if (role === '10pct')    confirmedQ = confirmedQ.ilike('officer_title', '%10%')

  // 2b. Inferred: $1M+ purchases by CEO/CFO/10% owners not already confirmed OPPORTUNISTIC.
  // Director role filter has no inferred results by definition, so skip that query.
  const includeInferred = role !== 'director'
  let inferredQ = supabase
    .from('insider_transactions')
    .select(SELECT)
    .eq('transaction_code', 'P')
    .gte('total_value', 1_000_000)
    .or('officer_title.ilike.%Chief Executive%,officer_title.ilike.%Chief Financial%,officer_title.ilike.%10%')
    .order('transaction_date', { ascending: false })
    .limit(100)

  if (cutoff)           inferredQ = inferredQ.gte('transaction_date', cutoff)
  if (role === 'ceo')   inferredQ = inferredQ.ilike('officer_title', '%Chief Executive%')
  if (role === 'cfo')   inferredQ = inferredQ.ilike('officer_title', '%Chief Financial%')
  if (role === '10pct') inferredQ = inferredQ.ilike('officer_title', '%10%')

  const [confirmedRes, inferredRes] = await Promise.all([
    opportunisticCiks.size > 0 ? confirmedQ : Promise.resolve({ data: [], error: null }),
    includeInferred ? inferredQ : Promise.resolve({ data: [], error: null }),
  ])

  if (confirmedRes.error) return NextResponse.json({ error: confirmedRes.error.message }, { status: 500 })
  if (inferredRes.error)  return NextResponse.json({ error: inferredRes.error.message },  { status: 500 })

  const today = Date.now()

  function enrich(tx: any, is_inferred: boolean) {
    const filed = tx.filed_date ? new Date(tx.filed_date).getTime() : null
    return {
      ...tx,
      is_inferred,
      days_since_filing: filed ? Math.floor((today - filed) / 86400000) : null,
    }
  }

  const confirmed = (confirmedRes.data ?? []).map((tx: any) => enrich(tx, false))

  // Exclude any inferred row whose CIK is already confirmed OPPORTUNISTIC
  const inferred = (inferredRes.data ?? [])
    .filter((tx: any) => !opportunisticCiks.has(tx.insider_cik))
    .map((tx: any) => enrich(tx, true))

  // Merge, sort by transaction_date DESC, top 20
  const data = [...confirmed, ...inferred]
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, 20)

  return NextResponse.json({ data })
}
