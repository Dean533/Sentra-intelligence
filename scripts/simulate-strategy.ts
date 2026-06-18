// Run with:  npx tsx scripts/simulate-strategy.ts
//
// Reads output/backtest-universe.csv (already enriched with prices).
// Does NOT refetch any prices — all return columns come from the CSV.
//
// ⚠  IMPORTANT CAVEATS printed at top of output:
//    1. Uses RETROACTIVE 2026 classification (lookahead bias) — optimistic ceiling,
//       not a live-trading guarantee.
//    2. Reinvest simulation assumes SEQUENTIAL SINGLE-POSITION timing: each trade
//       must fully complete before the next starts. Illustrative only.

import * as fs   from 'fs'
import * as path from 'path'

const CSV_PATH = path.join(__dirname, '..', 'output', 'backtest-universe.csv')

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ
    } else if (ch === ',' && !inQ) { fields.push(cur); cur = '' }
    else cur += ch
  }
  fields.push(cur)
  return fields
}

function n(v: string): number | null {
  if (!v || v === '') return null
  const f = parseFloat(v)
  return isNaN(f) ? null : f
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Row = {
  direction:        string
  classification:   string
  transaction_date: string
  total_value:      number | null
  role_classified:  string
  return_90d:       number | null
  return_180d:      number | null
  spy_return_90d:   number | null
  spy_return_180d:  number | null
  alpha_90d:        number | null
  alpha_180d:       number | null
}

// ─── Load CSV ─────────────────────────────────────────────────────────────────

function loadCsv(): Row[] {
  const lines = fs.readFileSync(CSV_PATH, 'utf-8').split('\n').filter(Boolean)
  const headers = parseCsvLine(lines[0])
  const idx = (name: string) => headers.indexOf(name)

  const C = {
    direction:        idx('direction'),
    classification:   idx('classification'),
    transaction_date: idx('transaction_date'),
    total_value:      idx('total_value'),
    role_classified:  idx('role_classified'),
    return_90d:       idx('return_90d'),
    return_180d:      idx('return_180d'),
    spy_return_90d:   idx('spy_return_90d'),
    spy_return_180d:  idx('spy_return_180d'),
    alpha_90d:        idx('alpha_90d'),
    alpha_180d:       idx('alpha_180d'),
  }

  const missing = Object.entries(C).filter(([, v]) => v === -1).map(([k]) => k)
  if (missing.length) { console.error('Missing columns:', missing); process.exit(1) }

  return lines.slice(1).map(line => {
    const f = parseCsvLine(line)
    return {
      direction:        f[C.direction]        ?? '',
      classification:   f[C.classification]   ?? '',
      transaction_date: f[C.transaction_date] ?? '',
      total_value:      n(f[C.total_value]),
      role_classified:  f[C.role_classified]  ?? '',
      return_90d:       n(f[C.return_90d]),
      return_180d:      n(f[C.return_180d]),
      spy_return_90d:   n(f[C.spy_return_90d]),
      spy_return_180d:  n(f[C.spy_return_180d]),
      alpha_90d:        n(f[C.alpha_90d]),
      alpha_180d:       n(f[C.alpha_180d]),
    }
  })
}

// ─── Statistics ───────────────────────────────────────────────────────────────

function mean(arr: number[]): number | null {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null
}

function median(arr: number[]): number | null {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function winRate(arr: number[]): number | null {
  return arr.length ? arr.filter(v => v > 0).length / arr.length : null
}

function r2(v: number | null): number | null {
  return v == null ? null : Math.round(v * 100) / 100
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fp(v: number | null, dp = 1): string {
  if (v == null) return 'N/A'
  return (v >= 0 ? '+' : '') + v.toFixed(dp) + '%'
}

function fd(v: number): string {
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2)
}

function fc(v: number): string {
  return '$' + v.toFixed(2)
}

function fwr(v: number | null): string {
  return v == null ? 'N/A' : (v * 100).toFixed(1) + '%'
}

// ─── Part 1: per-category tables ──────────────────────────────────────────────

function printPart1(rows: Row[]) {
  const CLASSIFICATIONS = ['OPPORTUNISTIC', 'ROUTINE', 'UNCLASSIFIABLE'] as const
  const DIRECTIONS      = ['buy', 'sell'] as const

  type Group = { label: string; rows: Row[] }
  const groups: Group[] = [
    { label: 'ALL TRADES',    rows },
    { label: 'ALL BUYS',      rows: rows.filter(r => r.direction === 'buy') },
    { label: 'ALL SELLS',     rows: rows.filter(r => r.direction === 'sell') },
    ...CLASSIFICATIONS.map(c => ({
      label: c + ' (all)',
      rows:  rows.filter(r => r.classification === c),
    })),
    ...CLASSIFICATIONS.flatMap(c =>
      DIRECTIONS.map(d => ({
        label: `${c} · ${d}`,
        rows:  rows.filter(r => r.classification === c && r.direction === d),
      }))
    ),
  ]

  const COL = 10
  const LW  = 28
  const hdr =
    'Group'.padEnd(LW) + 'n'.padStart(6) + '  ' +
    'r90 mean'.padStart(COL) + ' r90 med'.padStart(COL) + '  ' +
    'r180 mean'.padStart(COL) + ' r180 med'.padStart(COL) + '  ' +
    'α90 mean'.padStart(COL) + ' α90 med'.padStart(COL) + '  ' +
    'α180 mean'.padStart(COL) + ' α180 med'.padStart(COL)
  const SEP = '─'.repeat(hdr.length)

  console.log('\n' + '═'.repeat(hdr.length))
  console.log('PART 1 — PER-CATEGORY RETURNS & ALPHA')
  console.log('═'.repeat(hdr.length))
  console.log(hdr)
  console.log(SEP)

  for (const g of groups) {
    const r90s  = g.rows.map(r => r.return_90d).filter((v): v is number => v != null)
    const r180s = g.rows.map(r => r.return_180d).filter((v): v is number => v != null)
    const a90s  = g.rows.map(r => r.alpha_90d).filter((v): v is number => v != null)
    const a180s = g.rows.map(r => r.alpha_180d).filter((v): v is number => v != null)

    // separator before classification blocks
    if (['OPPORTUNISTIC (all)', 'ALL TRADES', 'ALL SELLS'].includes(g.label)
      && g.label !== 'ALL TRADES') {
      console.log(SEP)
    }

    console.log(
      g.label.slice(0, LW - 1).padEnd(LW) +
      String(g.rows.length).padStart(6) + '  ' +
      fp(r2(mean(r90s))).padStart(COL)  + fp(r2(median(r90s))).padStart(COL)  + '  ' +
      fp(r2(mean(r180s))).padStart(COL) + fp(r2(median(r180s))).padStart(COL) + '  ' +
      fp(r2(mean(a90s))).padStart(COL)  + fp(r2(median(a90s))).padStart(COL)  + '  ' +
      fp(r2(mean(a180s))).padStart(COL) + fp(r2(median(a180s))).padStart(COL)
    )
  }
  console.log(SEP)
}

// ─── Simulation helpers ───────────────────────────────────────────────────────

type SimSignal = { date: string; ret180: number; spyRet180: number }

function freshSim(signals: SimSignal[], betSize = 100) {
  const strat: number[] = []
  const spy:   number[] = []
  let bestRet = -Infinity, worstRet = Infinity
  let bestTrade = '', worstTrade = ''

  for (const s of signals) {
    const sv = betSize * (1 + s.ret180 / 100)
    const bv = betSize * (1 + s.spyRet180 / 100)
    strat.push(sv)
    spy.push(bv)
    if (s.ret180 > bestRet)  { bestRet  = s.ret180; bestTrade  = s.date }
    if (s.ret180 < worstRet) { worstRet = s.ret180; worstTrade = s.date }
  }

  const totalInvested = betSize * signals.length
  const stratEnd      = strat.reduce((a, b) => a + b, 0)
  const spyEnd        = spy.reduce((a,   b) => a + b, 0)
  const stratProfit   = stratEnd - totalInvested
  const spyProfit     = spyEnd   - totalInvested
  const stratRet      = (stratEnd / totalInvested - 1) * 100
  const spyRet        = (spyEnd   / totalInvested - 1) * 100
  const excess        = stratEnd - spyEnd
  const excessRet     = stratRet - spyRet

  return {
    n: signals.length, totalInvested, stratEnd, stratProfit, stratRet,
    spyEnd, spyProfit, spyRet, excess, excessRet,
    avgRetPerTrade: r2(mean(signals.map(s => s.ret180))),
    winRt: winRate(signals.map(s => s.ret180)),
    bestRet, worstRet, bestTrade, worstTrade,
  }
}

function reinvestSim(signals: SimSignal[]) {
  let stratPot = 100, spyPot = 100
  const sorted = [...signals].sort((a, b) => a.date.localeCompare(b.date))
  for (const s of sorted) {
    stratPot *= (1 + s.ret180 / 100)
    spyPot   *= (1 + s.spyRet180 / 100)
  }
  const n = signals.length
  // Geometric mean return per trade (annualised proxy)
  const stratGeoMean = n > 0 ? (Math.pow(stratPot / 100, 1 / n) - 1) * 100 : 0
  const spyGeoMean   = n > 0 ? (Math.pow(spyPot   / 100, 1 / n) - 1) * 100 : 0
  return {
    n,
    stratFinal:    stratPot,
    stratRet:      (stratPot - 100),
    spyFinal:      spyPot,
    spyRet:        (spyPot - 100),
    excess:        stratPot - spyPot,
    excessRet:     (stratPot - 100) - (spyPot - 100),
    stratGeoMean:  r2(stratGeoMean),
    spyGeoMean:    r2(spyGeoMean),
    excessGeoMean: r2(stratGeoMean - spyGeoMean),
  }
}

function getSignals(rows: Row[]): SimSignal[] {
  return rows
    .filter(r => r.return_180d != null && r.spy_return_180d != null)
    .map(r => ({
      date:      r.transaction_date,
      ret180:    r.return_180d!,
      spyRet180: r.spy_return_180d!,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Print simulation block ────────────────────────────────────────────────────

function printSim(label: string, signals: SimSignal[]) {
  const W = 44
  const SEP = '─'.repeat(W)

  if (!signals.length) {
    console.log(`  ${label}: no signals with complete 180d data`)
    return
  }

  const fr = freshSim(signals)
  const rv = reinvestSim(signals)

  console.log(`\n  ┌${'─'.repeat(W - 2)}┐`)
  console.log(`  │ ${label.padEnd(W - 3)}│`)
  console.log(`  ├${'─'.repeat(W - 2)}┤`)

  const row = (k: string, v: string) =>
    console.log(`  │ ${k.padEnd(22)}${v.padStart(W - 25)} │`)

  console.log(`  │ (A) FRESH $100 PER SIGNAL'.padEnd(W - 3)}│`.replace("(A) FRESH $100 PER SIGNAL'.padEnd(W - 3)}", `(A) FRESH $100 PER SIGNAL`.padEnd(W - 3)))
  row('Signals',          String(fr.n))
  row('Total invested',   fc(fr.totalInvested))
  row('Strategy end val', fc(fr.stratEnd))
  row('Strategy profit',  fd(fr.stratProfit))
  row('Strategy return',  fp(fr.stratRet, 2))
  row('SPY end val',      fc(fr.spyEnd))
  row('SPY return',       fp(fr.spyRet, 2))
  row('Excess vs SPY ($)',fd(fr.excess))
  row('Excess vs SPY (%)',fp(fr.excessRet, 2))
  row('Avg return/trade', fp(fr.avgRetPerTrade))
  row('Win rate',         fwr(fr.winRt))
  row('Best trade',       fp(fr.bestRet) + ' (' + fr.bestTrade + ')')
  row('Worst trade',      fp(fr.worstRet) + ' (' + fr.worstTrade + ')')

  console.log(`  ├${'─'.repeat(W - 2)}┤`)
  console.log(`  │ (B) REINVEST (compounding)`.padEnd(W - 1) + '│')
  // When n is large, compounded pot overflows to astronomical numbers.
  // Show geo-mean return per trade instead — interpretable at any n.
  const bigN = rv.n > 200
  row('Signals',          String(rv.n))
  if (bigN) {
    row('Strategy $100→',  '~' + rv.stratFinal.toExponential(2))
    row('SPY $100→',       '~' + rv.spyFinal.toExponential(2))
    row('Note', 'n>' + rv.n + ': use geo-mean below')
  } else {
    row('Strategy $100→',  fc(rv.stratFinal))
    row('SPY $100→',       fc(rv.spyFinal))
  }
  row('Geo-mean/trade strat', fp(rv.stratGeoMean))
  row('Geo-mean/trade SPY',   fp(rv.spyGeoMean))
  row('Geo-mean excess/trade',fp(rv.excessGeoMean))
  console.log(`  └${'─'.repeat(W - 2)}┘`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const rows = loadCsv()
  console.log(`Loaded ${rows.length.toLocaleString()} rows from backtest-universe.csv`)

  // ── Caveats ─────────────────────────────────────────────────────────────────

  const BORDER = '!'.repeat(80)
  console.log('\n' + BORDER)
  console.log('!! CAVEATS:')
  console.log('!!  1. Classification uses retroactive 2026 CMP labels (LOOKAHEAD BIAS).')
  console.log('!!     This is an OPTIMISTIC CEILING, not a live-trading guarantee.')
  console.log('!!  2. Reinvest (B) assumes SEQUENTIAL SINGLE-POSITION timing:')
  console.log('!!     each 180d trade fully completes before the next starts.')
  console.log('!!     In reality signals overlap — this is ILLUSTRATIVE only.')
  console.log(BORDER)

  // ── Part 1 ──────────────────────────────────────────────────────────────────

  printPart1(rows)

  // ── Part 2 + 3: all opportunistic buys ──────────────────────────────────────

  const oppBuys = rows.filter(r => r.classification === 'OPPORTUNISTIC' && r.direction === 'buy')
  const oppSigs = getSignals(oppBuys)

  console.log('\n\n' + '═'.repeat(80))
  console.log('PART 2 + 3 — ALL OPPORTUNISTIC BUYS vs SPY (180d hold)')
  console.log(`  ${oppBuys.length} opp buys total  ·  ${oppSigs.length} with complete 180d data`)
  console.log('═'.repeat(80))

  printSim('ALL OPPORTUNISTIC BUYS', oppSigs)

  // ── Part 4: high-conviction subset ──────────────────────────────────────────

  const HC_ROLES   = new Set(['CEO', 'CFO', 'President', 'Director'])
  const HC_MIN_VAL = 500_000

  const hcBuys = oppBuys.filter(r =>
    HC_ROLES.has(r.role_classified) &&
    r.total_value != null && r.total_value >= HC_MIN_VAL
  )
  const hcSigs = getSignals(hcBuys)

  console.log('\n' + '═'.repeat(80))
  console.log('PART 4 — HIGH-CONVICTION SUBSET vs SPY')
  console.log('  Filter: OPPORTUNISTIC buy + role in (CEO/CFO/President/Director) + value ≥ $500K')
  console.log(`  ${hcBuys.length} trades total  ·  ${hcSigs.length} with complete 180d data`)
  console.log('═'.repeat(80))

  printSim('HIGH-CONVICTION BUYS', hcSigs)

  // ── Side-by-side summary ─────────────────────────────────────────────────────

  const oppFresh  = freshSim(oppSigs)
  const hcFresh   = freshSim(hcSigs)
  const oppReinv  = reinvestSim(oppSigs)
  const hcReinv   = reinvestSim(hcSigs)

  console.log('\n' + '═'.repeat(80))
  console.log('SUMMARY — SIDE BY SIDE')
  console.log('═'.repeat(80))

  const SL = 28
  console.log(
    'Metric'.padEnd(SL) +
    'All Opp Buys'.padStart(18) +
    'High-Conviction'.padStart(18) +
    'Diff (HC - Opp)'.padStart(18)
  )
  console.log('─'.repeat(SL + 54))

  const cmp = (label: string, a: number | null, b: number | null, pct = true) => {
    const fmt = pct ? fp : (v: number | null) => v == null ? 'N/A' : fc(v!)
    const diff = a != null && b != null ? r2(b - a) : null
    console.log(
      label.padEnd(SL) +
      (fmt as any)(r2(a)).padStart(18) +
      (fmt as any)(r2(b)).padStart(18) +
      (diff != null ? (diff >= 0 ? '+' : '') + diff.toFixed(2) + (pct ? '%' : '') : 'N/A').padStart(18)
    )
  }

  console.log('\n  (A) FRESH $100 PER SIGNAL:')
  const cmpN = (label: string, a: number, b: number) =>
    console.log(label.padEnd(SL) + String(a).padStart(18) + String(b).padStart(18) + String(b - a).padStart(18))
  cmpN('  n signals',             oppFresh.n,        hcFresh.n)
  cmp('  Strategy return',        oppFresh.stratRet,  hcFresh.stratRet)
  cmp('  SPY return',             oppFresh.spyRet,    hcFresh.spyRet)
  cmp('  Excess vs SPY',          oppFresh.excessRet, hcFresh.excessRet)
  cmp('  Win rate',               oppFresh.winRt! * 100, hcFresh.winRt! * 100)
  cmp('  Avg return/trade',       oppFresh.avgRetPerTrade, hcFresh.avgRetPerTrade)

  console.log('\n  (B) REINVEST — geo-mean return per trade:')
  cmp('  Strat geo-mean/trade',   oppReinv.stratGeoMean,  hcReinv.stratGeoMean)
  cmp('  SPY geo-mean/trade',     oppReinv.spyGeoMean,    hcReinv.spyGeoMean)
  cmp('  Excess geo-mean/trade',  oppReinv.excessGeoMean, hcReinv.excessGeoMean)
  console.log('  (HC $100→ ' + fc(hcReinv.stratFinal) + ' vs SPY ' + fc(hcReinv.spyFinal) + ' over ' + hcReinv.n + ' sequential trades)')

  console.log('\n' + '═'.repeat(80) + '\n')
}

main()
