// Daily cron: scores P-code rows WHERE conviction_score IS NULL.
// Runs after ingest so newly ingested trades get scored before the day's feed loads.
// Batch limit of 500 rows keeps this well under the Vercel 60-second function timeout —
// no per-row DB queries; only 3 bulk fetches (rows, classifications, market caps) + per-row updates.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeCron } from '@/lib/cronAuth'
import { computeConvictionScore, ConvictionTrade } from '@/lib/scoring/convictionScore'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

// Mirrors the classification resolution in the backfill script and conviction/[ticker] route.
function resolveClassification(
  row: { insider_cik: string | null; officer_title: string | null; role: string | null; total_value: number | null },
  classMap:       Map<string, string>,
  classifiedCiks: Set<string>
): 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE' | null {
  const cik = row.insider_cik
  if (!cik) return null
  const confirmed = classMap.get(cik)
  if (confirmed) return confirmed as 'OPPORTUNISTIC' | 'UNCLASSIFIABLE' | 'ROUTINE'
  if (classifiedCiks.has(cik)) return null
  const val  = row.total_value ?? 0
  const text = ((row.officer_title ?? '') + ' ' + (row.role ?? '')).toLowerCase()
  if (
    val >= 1_000_000 &&
    (text.includes('ceo') || text.includes('chief executive') ||
     text.includes('president') || text.includes('10%'))
  ) return 'OPPORTUNISTIC'
  return null
}

export async function GET(req: Request) {
  const deny = authorizeCron(req)
  if (deny) return deny

  // ── 1. Fetch unscored P-code rows ─────────────────────────────────────────
  const { data: rows, error: fetchErr } = await supabase
    .from('insider_transactions')
    .select('id, ticker, insider_name, insider_cik, officer_title, role, total_value, price_per_share, shares, shares_owned_after, transaction_date')
    .eq('transaction_code', 'P')
    .is('conviction_score', null)
    .order('transaction_date', { ascending: false })
    .limit(500)

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ total: 0, scored: 0, failed: 0 })

  // ── 2. Bulk-fetch classifications for unique CIKs in this batch ───────────
  const cikSet = [...new Set((rows as any[]).map((r) => r.insider_cik).filter(Boolean))]
  const classMap     = new Map<string, string>()
  const classifiedCiks = new Set<string>()
  if (cikSet.length > 0) {
    const { data: clsRows } = await supabase
      .from('insider_classifications')
      .select('insider_cik, classification, classified_year')
      .in('insider_cik', cikSet)
      .order('classified_year', { ascending: false })
    for (const r of clsRows ?? []) {
      const cik = (r as any).insider_cik as string
      if (!classMap.has(cik)) classMap.set(cik, (r as any).classification)
      classifiedCiks.add(cik)
    }
  }

  // ── 3. Bulk-fetch market caps for tickers in this batch ───────────────────
  const tickerSet = [...new Set((rows as any[]).map((r) => r.ticker as string))]
  const { data: tickerMeta } = await supabase
    .from('tickers')
    .select('symbol, market_cap')
    .in('symbol', tickerSet)
  const marketCapMap: Record<string, number | null> = {}
  for (const t of tickerMeta ?? []) {
    marketCapMap[(t as any).symbol] = (t as any).market_cap ?? null
  }

  // ── 4. Score and write ────────────────────────────────────────────────────
  let scored = 0
  let failed = 0

  for (const row of rows as any[]) {
    try {
      const cls = resolveClassification(row, classMap, classifiedCiks)
      const mc  = marketCapMap[row.ticker] ?? null

      const trade: ConvictionTrade = {
        ticker:               row.ticker,
        insider_name:         row.insider_name ?? '',
        officer_title:        row.officer_title ?? null,
        role:                 row.role ?? null,
        total_value:          row.total_value ?? null,
        price_per_share:      row.price_per_share ?? null,
        transaction_date:     row.transaction_date,
        is_opportunistic:     cls === 'OPPORTUNISTIC',
        is_local:             null,
        sector:               null,
        cluster_count:        0,        // not used in conviction scoring formulas
        cluster_total_value:  0,
        insider_median_value: null,
        classification:       cls,
        shares:               row.shares ?? null,
        shares_owned_after:   row.shares_owned_after ?? null,
        market_cap:           mc,
        momentum_90d:         null,     // not available in cron context; graceful neutral
      }

      const result = computeConvictionScore(trade, [], [], null)

      const { error: updateErr } = await supabase
        .from('insider_transactions')
        .update({ conviction_score: result.score })
        .eq('id', row.id)

      if (updateErr) { failed++; continue }
      scored++
    } catch {
      failed++
    }
  }

  return NextResponse.json({ total: rows.length, scored, failed })
}
