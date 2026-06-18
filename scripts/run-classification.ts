// Run with:  npx tsx scripts/run-classification.ts
//
// Drives the classify route page-by-page until all insiders are classified.
// No auth needed when running against localhost (dev bypasses CRON_SECRET).

const BASE_URL = 'http://localhost:3000'
const LIMIT    = 500

async function main() {
  let offset: number | null = 0
  let page = 0

  let totalProcessed      = 0
  let totalRoutine        = 0
  let totalOpportunistic  = 0
  let totalUnclassifiable = 0

  while (offset !== null) {
    page++
    const url = `${BASE_URL}/api/insider/classify?offset=${offset}&limit=${LIMIT}`
    const res  = await fetch(url)

    if (!res.ok) {
      const text = await res.text()
      console.error(`\nPage ${page} failed (HTTP ${res.status}): ${text}`)
      process.exit(1)
    }

    const body = await res.json() as {
      processed:      number
      routine:        number
      opportunistic:  number
      unclassifiable: number
      failed:         number
      total_distinct: number
      remaining:      number
      offset_next:    number | null
    }

    totalProcessed      += body.processed
    totalRoutine        += body.routine
    totalOpportunistic  += body.opportunistic
    totalUnclassifiable += body.unclassifiable

    console.log(
      `page ${String(page).padStart(2)} | offset ${String(offset).padStart(5)} ` +
      `| processed ${String(body.processed).padStart(3)} ` +
      `| R ${String(body.routine).padStart(3)} ` +
      `O ${String(body.opportunistic).padStart(3)} ` +
      `U ${String(body.unclassifiable).padStart(3)} ` +
      `| remaining ${body.remaining}`
    )

    offset = body.offset_next
  }

  console.log('\n── Cumulative totals ──────────────────────────────')
  console.log(`  Processed:      ${totalProcessed}`)
  console.log(`  Routine:        ${totalRoutine}`)
  console.log(`  Opportunistic:  ${totalOpportunistic}`)
  console.log(`  Unclassifiable: ${totalUnclassifiable}`)
}

main().catch(err => { console.error(err); process.exit(1) })
