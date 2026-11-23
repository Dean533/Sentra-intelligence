// npx tsx scripts/calibrate-score.ts
//
// Computes percentile anchor arrays for the walk-forward insider scoring engine.
// Run once after updating factor formulas; paste output constants into
// lib/scoring/convictionScore.ts.
//
// Output: JSON with 19 anchor values per classification (p5–p95 in steps of 5).
// These anchors map a raw composite score [0,1] to a 0-100 percentile rank.

import * as fs   from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

function loadEnv() {
  const p = path.join(__dirname, '..', '.env.local')
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

// ─── Factor formulas (must match lib/scoring/convictionScore.ts exactly) ──────

export function computeStakePts(shares: number|null, sharesOwnedAfter: number|null, totalValue: number|null): number {
  if (!shares || !sharesOwnedAfter || shares <= 0) return 0
  const before = sharesOwnedAfter - shares
  if (before <= 0) {
    // New position — score by dollar size, cap at 25
    const tv = totalValue ?? 0
    return tv >= 500_000 ? 25 : tv >= 50_000 ? 15 : 5
  }
  const pct = (shares / before) * 100
  return 30 * pct / (pct + 50)
}

export function computeRolePts(role: string): number {
  if (role === '10% Owner' || role === 'Co-Founder/Partner') return 12
  if (['CEO','CFO','President','Director'].includes(role)) return 9
  return 7  // Other/EVP, Insider (other) — slightly discounted
}

export function computeCapPts(marketCap: number|null): number {
  if (!marketCap || marketCap <= 0) return 4  // unknown — neutral
  const logMC = Math.log10(marketCap)
  // $200M → 8 pts, $50B → 0 pts, log-linear between
  return 8 * Math.max(0, Math.min(1, (10.7 - logMC) / 2.4))
}

// Momentum: neutral (20 pts = sigmoid midpoint) when null.
// Keeps denominator constant at 90 for UNCL/ROUT so percentile anchors are stable.
export function computeMomPts(mom: number|null): number {
  if (mom == null) return 20  // neutral — sigmoid(0) × 40 = 20
  return 40 / (1 + Math.exp(-(mom - 5) / 25))
}

// Raw composite ∈ [0, 1]
export function computeRaw(
  classification: string,
  stakePts: number,
  rolePts: number,
  capPts: number,
  momPts: number,  // already resolved (neutral if originally null)
): number {
  const isOPP = classification === 'OPPORTUNISTIC'
  const pts    = stakePts + rolePts + capPts + (isOPP ? 0 : momPts)
  const maxPts = 30 + 12 + 8 + (isOPP ? 0 : 40)  // 50 or 90
  return pts / maxPts
}

// ─── Percentile helper ────────────────────────────────────────────────────────

function percentiles(values: number[], steps: number[]): number[] {
  const s = [...values].sort((a, b) => a - b)
  return steps.map(p => {
    const idx = p * (s.length - 1)
    const lo  = Math.floor(idx)
    const hi  = Math.ceil(idx)
    return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo)
  })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const CSV = path.join(__dirname,'..','output','backtest-universe.csv')
  const lines = fs.readFileSync(CSV,'utf-8').split('\n').filter(Boolean)
  const hdr   = parseCsv(lines[0])
  const idx   = (n:string)=>hdr.indexOf(n)

  const C = {
    ticker:             idx('ticker'),
    classification:     idx('classification'),
    direction:          idx('direction'),
    shares:             idx('shares'),
    shares_owned_after: idx('shares_owned_after'),
    role_classified:    idx('role_classified'),
    total_value:        idx('total_value'),
  }

  // Fetch market caps
  const tickers = [...new Set(lines.slice(1).map(l=>parseCsv(l)[C.ticker]).filter(Boolean))]
  console.error(`Fetching market caps for ${tickers.length} tickers...`)
  const mcMap = new Map<string,number|null>()
  for (let i=0; i<tickers.length; i+=500) {
    const{data}=await supabase.from('tickers').select('symbol,market_cap').in('symbol',tickers.slice(i,i+500))
    for(const r of data??[])mcMap.set((r as any).symbol,(r as any).market_cap??null)
  }
  console.error('Done.')

  const pools: Record<string, number[]> = { OPPORTUNISTIC: [], UNCLASSIFIABLE: [], ROUTINE: [] }

  for (const line of lines.slice(1)) {
    const f   = parseCsv(line)
    const cls = f[C.classification]
    const dir = f[C.direction]
    if (dir !== 'buy') continue
    if (!(cls in pools)) continue

    const ticker = f[C.ticker]
    const role   = f[C.role_classified] ?? 'Other/EVP'
    const shares = pn(f[C.shares])
    const soa    = pn(f[C.shares_owned_after])
    const mc     = mcMap.get(ticker) ?? null
    const tv     = pn(f[C.total_value])

    const stakePts = computeStakePts(shares, soa, tv)
    const rolePts  = computeRolePts(role)
    const capPts   = computeCapPts(mc)
    const momPts   = computeMomPts(null)  // no momentum in calibration (same as null at serve time)

    const raw = computeRaw(cls, stakePts, rolePts, capPts, momPts)
    pools[cls].push(raw)
  }

  // 19 anchors: p5, p10, ..., p95
  const STEPS = Array.from({length:19}, (_,i) => (i+1) * 0.05)
  const anchors: Record<string, number[]> = {}
  for (const [cls, vals] of Object.entries(pools)) {
    const p = percentiles(vals, STEPS)
    anchors[cls] = p.map(v => Math.round(v * 100000) / 100000)
    console.error(`${cls}: n=${vals.length}, p5=${p[0].toFixed(4)}, p50=${p[9].toFixed(4)}, p95=${p[18].toFixed(4)}`)
  }

  console.log(JSON.stringify(anchors, null, 2))
}

main().catch(e=>{console.error(e);process.exit(1)})
