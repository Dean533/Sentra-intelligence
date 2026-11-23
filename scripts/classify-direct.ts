// Run with:  npx tsx scripts/classify-direct.ts
//
// Runs the CMP (Cohen-Malloy-Pomorski) insider classification directly against
// Supabase — no HTTP route, no statement-timeout risk.
//
// Same algorithm as app/api/insider/classify/route.ts but:
//   • Collects ALL distinct CIKs in one paginated pass (done once, up front)
//   • Fetches trades per CIK-page without the overhead of the HTTP layer
//   • No statement-timeout exposure (client-side pagination, not server-side)

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) { console.error('ERROR: .env.local not found'); process.exit(1) }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvLocal()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
)

const FETCH_CHUNK     = 1000  // PostgREST max rows per query
const PAGE_SIZE       = 500   // insiders per upsert page
const CLASSIFIED_YEAR = new Date().getUTCFullYear()
const SINCE           = `${CLASSIFIED_YEAR - 4}-01-01`

// ─── CMP classification ───────────────────────────────────────────────────────

type TradeRecord = { insider_cik: string; insider_name: string | null; transaction_date: string }

function classifyInsider(trades: TradeRecord[]) {
  const lookbackYears = [CLASSIFIED_YEAR - 1, CLASSIFIED_YEAR - 2, CLASSIFIED_YEAR - 3]
  const monthsByYear  = new Map<number, Set<number>>()
  for (const t of trades) {
    const y = new Date(t.transaction_date).getUTCFullYear()
    const m = new Date(t.transaction_date).getUTCMonth() + 1
    if (!monthsByYear.has(y)) monthsByYear.set(y, new Set())
    monthsByYear.get(y)!.add(m)
  }
  const covered = lookbackYears.filter(y => (monthsByYear.get(y)?.size ?? 0) > 0)
  if (covered.length < 3) return { classification: 'UNCLASSIFIABLE' as const, activeMonths: [], tradeYearCount: covered.length }

  const [y1, y2, y3] = lookbackYears
  const activeMonths: number[] = []
  for (let m = 1; m <= 12; m++) {
    if (monthsByYear.get(y1)!.has(m) && monthsByYear.get(y2)!.has(m) && monthsByYear.get(y3)!.has(m)) {
      activeMonths.push(m)
    }
  }
  return activeMonths.length > 0
    ? { classification: 'ROUTINE'        as const, activeMonths, tradeYearCount: 3 }
    : { classification: 'OPPORTUNISTIC'  as const, activeMonths: [], tradeYearCount: 3 }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Classification year: ${CLASSIFIED_YEAR}  (lookback: ${CLASSIFIED_YEAR-3}–${CLASSIFIED_YEAR-1})`)
  console.log(`Scanning ALL trades since ${SINCE} into memory, then classifying...\n`)

  // ── Single pass: load all trades into a client-side Map ──────────────────────
  // Keyset pagination (WHERE id > lastId LIMIT N) keeps each query O(1).
  // OFFSET pagination gets slower as offset grows and hits the statement timeout
  // around 160K rows. No date filter — CMP logic handles year filtering client-side.
  const grouped = new Map<string, TradeRecord[]>()
  let lastId: string | null = null, rowCount = 0

  while (true) {
    let q = supabase
      .from('insider_transactions')
      .select('id, insider_cik, insider_name, transaction_date')
      .not('insider_cik', 'is', null)
      .order('id', { ascending: true })
      .limit(FETCH_CHUNK)
    if (lastId !== null) q = q.gt('id', lastId)
    const { data: chunk, error } = await q

    if (error) {
      console.error(`\nFetch error after id ${lastId}: ${error.message}`)
      process.exit(1)
    }
    if (!chunk || chunk.length === 0) break

    for (const r of chunk as any[]) {
      if (!r.insider_cik) continue
      if (!grouped.has(r.insider_cik)) grouped.set(r.insider_cik, [])
      grouped.get(r.insider_cik)!.push({ insider_cik: r.insider_cik, insider_name: r.insider_name, transaction_date: r.transaction_date })
    }

    lastId    = (chunk[chunk.length - 1] as any).id as string
    rowCount += chunk.length
    if (rowCount % 50000 === 0) console.log(`  loaded ${rowCount.toLocaleString()} rows, ${grouped.size.toLocaleString()} distinct insiders...`)
    if (chunk.length < FETCH_CHUNK) break
  }

  const allCiks = [...grouped.keys()].sort()
  console.log(`\nTotal rows loaded   : ${rowCount.toLocaleString()}`)
  console.log(`Distinct insiders   : ${allCiks.length.toLocaleString()}\n`)

  // ── Classify and upsert in pages of PAGE_SIZE ─────────────────────────────────
  let totalProcessed = 0, totalRoutine = 0, totalOpp = 0, totalU = 0
  const totalPages   = Math.ceil(allCiks.length / PAGE_SIZE)

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const pageCiks = allCiks.slice(pageIdx * PAGE_SIZE, (pageIdx + 1) * PAGE_SIZE)
    let pageR = 0, pageO = 0, pageU = 0
    const upserts: any[] = []

    for (const cik of pageCiks) {
      const trades = grouped.get(cik)!
      const result = classifyInsider(trades)
      upserts.push({
        insider_cik:      cik,
        insider_name:     trades[0].insider_name ?? null,
        classification:   result.classification,
        classified_year:  CLASSIFIED_YEAR,
        active_months:    result.activeMonths,
        trade_year_count: result.tradeYearCount,
        total_trades:     trades.length,
        classified_at:    new Date().toISOString(),
      })
      if (result.classification === 'ROUTINE')            pageR++
      else if (result.classification === 'OPPORTUNISTIC') pageO++
      else                                                 pageU++
    }

    if (upserts.length > 0) {
      const { error: upsertErr } = await supabase
        .from('insider_classifications')
        .upsert(upserts, { onConflict: 'insider_cik,classified_year' })
      if (upsertErr) console.error(`  Upsert error (page ${pageIdx + 1}):`, upsertErr.message)
    }

    totalProcessed += pageCiks.length
    totalRoutine   += pageR
    totalOpp       += pageO
    totalU         += pageU

    console.log(
      `page ${String(pageIdx + 1).padStart(3)}/${totalPages}` +
      ` | offset ${String(pageIdx * PAGE_SIZE).padStart(6)}` +
      ` | R ${String(pageR).padStart(4)}  O ${String(pageO).padStart(4)}  U ${String(pageU).padStart(4)}` +
      ` | cumulative: R ${totalRoutine}  O ${totalOpp}  U ${totalU}`
    )
  }

  console.log('\n── Final totals ──────────────────────────────────────')
  console.log(`  Insiders classified : ${totalProcessed.toLocaleString()}`)
  console.log(`  Routine             : ${totalRoutine.toLocaleString()}`)
  console.log(`  Opportunistic       : ${totalOpp.toLocaleString()}`)
  console.log(`  Unclassifiable      : ${totalU.toLocaleString()}`)
  console.log(`  classified_year     : ${CLASSIFIED_YEAR}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
