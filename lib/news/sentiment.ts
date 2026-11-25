// Free, deterministic headline sentiment: a finance-specific weighted lexicon.
// No external calls. Rules, in order:
//   1. Strip the trailing " - Publisher" that RSS aggregators append.
//   2. Match multi-word phrases first ("price target cut", "all-time high"), then
//      single whole words (no substring matches: "buy" never matches "buyback").
//   3. A negator within the two words before a term flips its sign ("not a beat").
//   4. Terms after "despite" count at 25% (the headline's main verb comes first).
//   5. Terms in the first five words count 1.5x: headlines lead with the news.
//   6. A headline ending in "?" or starting with "If" is speculative: score halved.
// Positive if score >= 1, negative if <= -1, otherwise neutral.

export type Sentiment = 'positive' | 'negative' | 'neutral'

const WORDS: Record<string, number> = {
  // ── positive ──
  beat: 2, beats: 2, tops: 1.5, topped: 1.5, surpass: 1.5, surpasses: 1.5, exceeds: 1.5,
  surge: 2, surges: 2, surged: 2, surging: 2, soar: 2, soars: 2, soared: 2, soaring: 2,
  skyrocket: 2, skyrockets: 2, skyrocketed: 2, rocket: 1.5, rockets: 1.5, rocketing: 1.5,
  jump: 1.5, jumps: 1.5, jumped: 1.5, spike: 1, spikes: 1, spiked: 1,
  rally: 1.5, rallies: 1.5, rallied: 1.5, rallying: 1.5,
  gain: 1, gains: 1, gained: 1, rise: 1, rises: 1, rose: 1, rising: 1,
  climb: 1, climbs: 1, climbed: 1, advance: 1, advances: 1, rebound: 1, rebounds: 1, rebounded: 1,
  upgrade: 2, upgrades: 2, upgraded: 2, outperform: 1.5, outperforms: 1.5, outperformed: 1.5,
  bullish: 1.5, upbeat: 1.5, optimism: 1, optimistic: 1, boost: 1, boosts: 1, boosted: 1,
  approval: 1.5, approves: 1.5, approved: 1.5, clears: 1, cleared: 1,
  breakthrough: 1.5, wins: 1, won: 1, awarded: 1, secures: 1, secured: 1, lands: 0.5,
  strong: 1, stronger: 1, strength: 0.5, robust: 1, accelerates: 1, accelerating: 1,
  record: 1, best: 1, buyback: 1, repurchase: 1, raises: 1, raised: 0.5, hikes: 0.5,
  profit: 0.5, profitable: 1, growth: 0.5, expands: 0.5, expansion: 0.5, partnership: 0.5,
  recovers: 1, recovery: 1, reinstated: 0.5, reinstatement: 0.5, returns: 0.25,
  upside: 1, tailwind: 1, tailwinds: 1, momentum: 0.5, rebounding: 1,
  // ── negative ──
  miss: -2, misses: -2, missed: -2, disappoint: -2, disappoints: -2, disappointing: -2, disappointed: -2,
  downgrade: -2, downgrades: -2, downgraded: -2, underperform: -1.5, underperforms: -1.5,
  plunge: -2, plunges: -2, plunged: -2, plunging: -2, plummet: -2, plummets: -2, plummeted: -2,
  crash: -2, crashes: -2, crashed: -2, tank: -1.5, tanks: -1.5, tanked: -1.5, nosedive: -2,
  tumble: -1.5, tumbles: -1.5, tumbled: -1.5, sink: -1.5, sinks: -1.5, sank: -1.5, sinking: -1.5,
  slump: -1.5, slumps: -1.5, slumped: -1.5, selloff: -1.5, slide: -1, slides: -1, slid: -1,
  fall: -1, falls: -1, fell: -1, falling: -1, drop: -1, drops: -1, dropped: -1, dropping: -1,
  decline: -1, declines: -1, declined: -1, declining: -1, slip: -0.75, slips: -0.75, slipped: -0.75,
  lower: -0.5, lowers: -1, lowered: -1, slash: -1.5, slashes: -1.5, slashed: -1.5, cut: -1, cuts: -1,
  lawsuit: -2, lawsuits: -2, sue: -1.5, sues: -1.5, sued: -1.5, probe: -2, probes: -2,
  investigation: -2, investigating: -1.5, subpoena: -2, fraud: -2.5, scandal: -2, indictment: -2.5,
  charged: -1.5, settlement: -1, fine: -0.5, fined: -1.5, penalty: -1.5,
  layoff: -1.5, layoffs: -1.5, restructuring: -1, recall: -1.5, recalls: -1.5, recalled: -1.5,
  warn: -1.5, warns: -1.5, warned: -1.5, warning: -1.5, bearish: -1.5, weak: -1, weaker: -1, weakness: -1,
  loss: -1, losses: -1, halt: -1.5, halts: -1.5, halted: -1.5, delay: -1, delays: -1, delayed: -1,
  bankrupt: -3, bankruptcy: -3, default: -1.5, delisting: -2, delisted: -2,
  resign: -1, resigns: -1, resigned: -1, ousted: -1.5, exits: -0.5, departure: -0.5,
  ban: -1.5, bans: -1.5, banned: -1.5, restrictions: -1, curbs: -1, sanctions: -1, tariff: -0.5, tariffs: -0.5,
  concern: -1, concerns: -1, fears: -1, worries: -1, risk: -0.5, risks: -0.5, struggle: -1, struggles: -1,
  overvalued: -1, bubble: -1, dilution: -1, shortfall: -1.5, headwinds: -1, slowdown: -1, slowing: -1,
  rout: -2, routs: -2, downside: -1, problem: -1, problems: -1, trouble: -1, skepticism: -0.5, scrutiny: -1, backlash: -1,
  worst: -1.5, rejected: -1.5, rejects: -1.5, fails: -1.5, failed: -1.5, failure: -1.5,
  cool: -1, cools: -1, cooling: -1, cooled: -1, fade: -1, fades: -1, faded: -1, fading: -1, doubt: -1, doubts: -1,
}

// Checked before single words; their words are then not scored again.
const PHRASES: [string, number][] = [
  ['all time high', 2], ['record high', 2], ['52 week high', 1.5], ['52 week low', -1.5],
  ['beats estimates', 2], ['tops estimates', 2], ['misses estimates', -2], ['below expectations', -2],
  ['above expectations', 2], ['raises guidance', 2], ['raises outlook', 2], ['lifts guidance', 2],
  ['cuts guidance', -2], ['lowers guidance', -2], ['cuts outlook', -2], ['guidance cut', -2],
  ['raises price target', 1.5], ['price target raised', 1.5], ['lifts price target', 1.5], ['boosts price target', 1.5],
  ['cuts price target', -1.5], ['lowers price target', -1.5], ['price target cut', -1.5], ['price target lowered', -1.5],
  ['strong buy', 1.5], ['best day', 1.5], ['worst day', -2], ['short seller', -1.5], ['class action', -2],
  ['sell off', -1.5], ['going concern', -2.5], ['rate cut', 0.5], ['dividend hike', 1.5], ['dividend cut', -2],
  ['stock split', 0.5], ['worst is over', 1.5], ['worst over', 1.5], ['great news', 1.5], ['good news', 1.5], ['bad news', -1.5], ['losing streak', -1.5], ['winning streak', 1.5], ['under pressure', -1], ['under investigation', -2], ['takes a hit', -1.5],
  ['may not', -1],
]

const NEGATORS = new Set(['not', 'no', 'never', 'without', "isn't", "aren't", "won't", "doesn't", "didn't", 'fails', 'failed'])

function normalize(title: string): string[] {
  // Drop a trailing " - Publisher" / " | Publisher" suffix.
  const core = title.replace(/\s+[-|–]\s+[^-|–]{2,60}$/, '')
  return core
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[’‘]/g, "'")
    .replace(/(\d)-(week|day|year)/g, '$1 $2')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9'%$ ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export function scoreHeadline(title: string): { label: Sentiment; score: number; hits: string[] } {
  const words = normalize(title)
  const used = new Array(words.length).fill(false)
  const hits: string[] = []
  let score = 0
  const despiteAt = words.indexOf('despite')

  const weightAt = (i: number, w: number) => {
    let x = w
    if (i < 5) x *= 1.5
    if (despiteAt >= 0 && i > despiteAt) x *= 0.25
    const prev = words.slice(Math.max(0, i - 2), i)
    if (prev.some((p) => NEGATORS.has(p))) x = -x
    return x
  }

  for (const [phrase, w] of PHRASES) {
    const p = phrase.split(' ')
    for (let i = 0; i + p.length <= words.length; i++) {
      if (used[i]) continue
      if (p.every((t, j) => words[i + j] === t)) {
        const x = weightAt(i, w)
        score += x
        hits.push(`${phrase} ${x > 0 ? '+' : ''}${x.toFixed(1)}`)
        for (let j = 0; j < p.length; j++) used[i + j] = true
      }
    }
  }
  words.forEach((wd, i) => {
    if (used[i]) return
    const w = WORDS[wd]
    if (w == null) return
    const x = weightAt(i, w)
    score += x
    hits.push(`${wd} ${x > 0 ? '+' : ''}${x.toFixed(1)}`)
  })

  // Speculative framing: questions and conditionals ("If a crash is coming...").
  if (/\?\s*$/.test(title.replace(/\s+[-|–]\s+[^-|–]{2,60}$/, '')) || words[0] === 'if') score *= 0.5
  const label: Sentiment = score >= 1 ? 'positive' : score <= -1 ? 'negative' : 'neutral'
  return { label, score: Math.round(score * 100) / 100, hits }
}
