// npx tsx scripts/score-examples.ts
// Shows 5 examples spanning the score range + 3 new-position trades across dollar sizes.
import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'
import { computeConvictionScore, classifyRole, ConvictionTrade } from '../lib/scoring/convictionScore'

function loadEnv() {
  const p = path.join(__dirname,'..', '.env.local')
  for (const line of fs.readFileSync(p,'utf-8').split('\n')) {
    const t=line.trim(); if(!t||t.startsWith('#')) continue
    const eq=t.indexOf('='); if(eq<0) continue
    const k=t.slice(0,eq).trim(), v=t.slice(eq+1).trim().replace(/^["']|["']$/g,'')
    if(!process.env[k]) process.env[k]=v
  }
}
loadEnv()
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!)

function parseCsv(line: string): string[] {
  const f:string[]=[]; let cur='',inQ=false
  for(let i=0;i<line.length;i++){
    const ch=line[i]
    if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++}else inQ=!inQ}
    else if(ch===','&&!inQ){f.push(cur);cur=''}else cur+=ch
  }
  f.push(cur);return f
}
const pn=(v:string):number|null=>{const n=parseFloat(v);return isNaN(n)?null:n}

async function main() {
  const CSV = path.join(__dirname,'..','output','backtest-universe.csv')
  const lines = fs.readFileSync(CSV,'utf-8').split('\n').filter(Boolean)
  const hdr   = parseCsv(lines[0])
  const I = (n:string) => hdr.indexOf(n)
  const C = {
    ticker:I('ticker'), insider_name:I('insider_name'), classification:I('classification'),
    role_classified:I('role_classified'), direction:I('direction'),
    transaction_date:I('transaction_date'), shares:I('shares'),
    shares_owned_after:I('shares_owned_after'), total_value:I('total_value'),
    price_per_share:I('price_per_share'), return_180d:I('return_180d'),
  }

  // Fetch market caps
  const tickers = [...new Set(lines.slice(1).map(l=>parseCsv(l)[C.ticker]).filter(Boolean))]
  const mcMap = new Map<string,number|null>()
  for (let i=0;i<tickers.length;i+=500) {
    const{data}=await supabase.from('tickers').select('symbol,market_cap').in('symbol',tickers.slice(i,i+500))
    for(const r of data??[])mcMap.set((r as any).symbol,(r as any).market_cap??null)
  }

  const VALID_CLS = new Set(['OPPORTUNISTIC','UNCLASSIFIABLE','ROUTINE'])

  // Build ConvictionTrade from a CSV row
  function tradeFrom(f: string[]): ConvictionTrade {
    const cls = f[C.classification] as 'OPPORTUNISTIC'|'UNCLASSIFIABLE'|'ROUTINE'
    return {
      ticker:               f[C.ticker],
      insider_name:         f[C.insider_name] ?? '',
      officer_title:        null,
      role:                 f[C.role_classified] ?? null,
      total_value:          pn(f[C.total_value]),
      price_per_share:      pn(f[C.price_per_share]),
      transaction_date:     f[C.transaction_date],
      is_opportunistic:     cls === 'OPPORTUNISTIC',
      is_local:             null,
      sector:               null,
      cluster_count:        0,
      cluster_total_value:  0,
      insider_median_value: null,
      classification:       cls,
      shares:               pn(f[C.shares]),
      shares_owned_after:   pn(f[C.shares_owned_after]),
      market_cap:           mcMap.get(f[C.ticker]) ?? null,
      momentum_90d:         null,
    }
  }

  // Score all buys
  type Scored = { f: string[]; score: number }
  const scored: Scored[] = []
  for (const line of lines.slice(1)) {
    const f = parseCsv(line)
    if (f[C.direction] !== 'buy') continue
    if (!VALID_CLS.has(f[C.classification])) continue
    const result = computeConvictionScore(tradeFrom(f), [], [])
    scored.push({ f, score: result.score })
  }

  // ── Print helper ─────────────────────────────────────────────────────────────
  const COLORS: Record<string,string> = { OPPORTUNISTIC:'🟢', UNCLASSIFIABLE:'🟡', ROUTINE:'🔴' }
  const LINE = '─'.repeat(90)

  function printExample(f: string[], header?: string) {
    const trade  = tradeFrom(f)
    const result = computeConvictionScore(trade, [], [])
    const role   = classifyRole(trade)
    const cls    = f[C.classification]
    const mc     = mcMap.get(f[C.ticker]) ?? null
    const shares = pn(f[C.shares])
    const soa    = pn(f[C.shares_owned_after])
    const tv     = pn(f[C.total_value]) ?? 0
    const before = (shares && soa) ? soa - shares : null

    const stakePct = (shares && before && before > 0)
      ? `${(shares/before*100).toFixed(1)}% of prior holdings`
      : 'new position'
    const mcLabel = mc
      ? mc >= 1e12 ? `$${(mc/1e12).toFixed(1)}T`
      : mc >= 1e9  ? `$${(mc/1e9).toFixed(1)}B`
      : `$${(mc/1e6).toFixed(0)}M`
      : 'Unknown'
    const tvLabel = tv >= 1e6 ? `$${(tv/1e6).toFixed(1)}M` : tv >= 1e3 ? `$${(tv/1e3).toFixed(0)}K` : `$${tv.toFixed(0)}`
    const fwdRet  = pn(f[C.return_180d])
    const fwdLabel = fwdRet != null ? `${fwdRet>=0?'+':''}${fwdRet.toFixed(1)}%` : 'N/A'

    if (header) console.log(`\n  ${header}`)
    console.log('\n' + LINE)
    console.log(`  ${COLORS[cls]??'⚪'}  ${f[C.ticker]}  |  ${f[C.insider_name]}  |  ${f[C.transaction_date]}`)
    console.log(`  Color: ${cls === 'OPPORTUNISTIC' ? 'GREEN' : cls === 'UNCLASSIFIABLE' ? 'YELLOW' : 'RED'} (${cls.toLowerCase()})   Score: ${result.score}/100 (${result.classification})`)
    console.log(`  Role: ${role}  |  Trade: ${tvLabel}  |  Market cap: ${mcLabel}  |  Stake: ${stakePct}`)
    console.log(`  Actual 180d return (backtest): ${fwdLabel}`)
    console.log(LINE)
    for (const b of result.breakdown) {
      const fill = Math.round(b.points / b.maxPoints * 20)
      const bar  = ('█'.repeat(fill) + '░'.repeat(20 - fill))
      console.log(`  ${b.factor.padEnd(18)} [${bar}] ${String(b.points.toFixed(1)).padStart(5)}/${b.maxPoints}`)
      console.log(`    → ${b.reason}`)
    }
    console.log(`  ${'─'.repeat(53)} percentile: top ${100-result.score}% of ${cls.toLowerCase()} buys`)
  }

  // ── 5 examples spanning score range ──────────────────────────────────────────
  console.log('\n' + '█'.repeat(90))
  console.log('  SECTION 1 — 5 EXAMPLES SPANNING SCORE RANGE')
  console.log('█'.repeat(90))

  const byScore = [...scored].sort((a,b) => b.score - a.score)
  const targets = [0.97, 0.75, 0.50, 0.25, 0.03]
  for (const pct of targets) {
    const ex = byScore[Math.floor(pct * (byScore.length - 1))]
    printExample(ex.f)
  }

  // ── 3 new-position examples ───────────────────────────────────────────────────
  console.log('\n\n' + '█'.repeat(90))
  console.log('  SECTION 2 — 3 NEW-POSITION TRADES (no prior holdings), ACROSS DOLLAR SIZES')
  console.log('  These previously all got 30/30 stake pts. Fixed formula uses dollar size instead.')
  console.log('█'.repeat(90))

  const isNewPos = (f: string[]) => {
    const sh = pn(f[C.shares]), so = pn(f[C.shares_owned_after])
    return sh != null && so != null && sh > 0 && (so - sh) <= 0
  }
  const newPosBuys = lines.slice(1)
    .map(l => parseCsv(l))
    .filter(f => f[C.direction]==='buy' && VALID_CLS.has(f[C.classification]) && isNewPos(f))
    .sort((a,b) => (pn(a[C.total_value])??0) - (pn(b[C.total_value])??0))

  const npLow  = newPosBuys.find(f => (pn(f[C.total_value])??0) > 0 && (pn(f[C.total_value])??0) < 50_000)
  const npMid  = newPosBuys.find(f => { const tv=pn(f[C.total_value])??0; return tv>=50_000&&tv<500_000 })
  const npHigh = [...newPosBuys].reverse().find(f => (pn(f[C.total_value])??0) >= 500_000)

  if (npLow)  printExample(npLow,  '  < $50K (nominal/compliance) → should score ~5/30 stake pts')
  if (npMid)  printExample(npMid,  '  $50K–$500K (moderate new bet) → should score ~15/30 stake pts')
  if (npHigh) printExample(npHigh, '  > $500K (large new bet) → should score ~25/30 stake pts')

  // ── Distribution check ────────────────────────────────────────────────────────
  console.log('\n\n' + LINE)
  console.log(`\n  Total scored: ${scored.length.toLocaleString()} buys — distribution should be near-uniform:`)
  for (let lo=0; lo<100; lo+=10) {
    const n   = scored.filter(s=>s.score>=lo&&s.score<lo+10).length
    const bar = '█'.repeat(Math.round(n/scored.length*100))
    console.log(`    ${String(lo).padStart(3)}–${String(lo+10).padStart(3)}: ${bar} ${n}`)
  }
  console.log()
}

main().catch(e=>{console.error(e);process.exit(1)})
