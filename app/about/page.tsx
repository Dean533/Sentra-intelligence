// ─── Styles (match the homepage) ─────────────────────────────────────────────

const h2Cls   = 'm-0 font-serif text-[28px] font-normal leading-tight text-heading md:text-[34px]'
const h3Cls   = 'm-0 font-serif text-[22px] font-normal leading-snug text-heading'
const prose   = 'm-0 text-[15px] leading-relaxed text-text-secondary'
const card    = 'rounded-md border border-border bg-surface p-5 md:p-6'
const section = 'flex flex-col gap-6 border-b border-border py-12 md:py-14'

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
}

function SectionHead({ label, title }: { label: string; title?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="label-mono">{label}</div>
      {title && <h2 className={h2Cls}>{title}</h2>}
    </div>
  )
}

const GREEN  = 'var(--color-opportunistic)'
const YELLOW = 'var(--color-unclassifiable)'
const RED    = 'var(--color-routine)'

// ─── Content ─────────────────────────────────────────────────────────────────

const CLASSES = [
  {
    name:  'Opportunistic',
    color: GREEN,
    desc:  'The insider bought outside their historical calendar pattern. This is the strongest class of signal. Opportunistic buyers tend to act when they have a genuine reason to buy, not because a scheduled plan told them to.',
  },
  {
    name:  'Unclassifiable',
    color: YELLOW,
    desc:  'There is insufficient trading history to determine a pattern. The insider may be new, filing rarely, or joining the company recently. Carries signal but with less certainty than Opportunistic.',
  },
  {
    name:  'Routine',
    color: RED,
    desc:  'The insider trades on a predictable, calendar-driven schedule. These are typically plan-based or compensation-related transactions. The research shows they carry little forward-looking signal.',
  },
]

const FACTORS = [
  {
    name:    'F1 — Stake increase',
    max:     '30 pts',
    classes: 'All',
    desc:    'How much the purchase increases existing holdings as a percentage. A large increase relative to existing position signals real conviction. New positions (no prior holdings) are scored by dollar size.',
  },
  {
    name:    'F2 — Price momentum 90d',
    max:     '40 pts',
    classes: 'Unclassifiable and Routine only',
    desc:    'The stock\'s 90-day price return before the trade. A pullback before a buy scores higher than buying into an uptrend. Not applied to Opportunistic trades (walk-forward IC is near zero for that group).',
  },
  {
    name:    'F3 — Role',
    max:     '12 pts',
    classes: 'All',
    desc:    '10% owners and co-founders score highest (12 pts), followed by CEO, CFO, President, and Directors (9 pts), then other titles (7 pts).',
  },
  {
    name:    'F4 — Size tilt',
    max:     '8 pts',
    classes: 'All',
    desc:    'Smaller-cap companies score higher. Pearson IC is modest (−0.11); Spearman is near zero. Labeled as a lottery tilt: adds high-variance upside potential, not a consistent edge.',
  },
]

const BUCKETS = [
  { cls: 'OPPORTUNISTIC',  score: '50+',      label: 'Very high signal', color: GREEN,  desc: 'Opportunistic buyer with above-median conviction signals' },
  { cls: 'UNCLASSIFIABLE', score: '50+',      label: 'High signal',      color: YELLOW, desc: 'Unclassifiable insider with above-median signals' },
  { cls: 'OPPORTUNISTIC',  score: 'Under 50', label: 'Moderate signal',  color: GREEN,  desc: 'Opportunistic buyer with below-median signals' },
  { cls: 'UNCLASSIFIABLE', score: 'Under 50', label: 'Low signal',       color: YELLOW, desc: 'Unclassifiable insider with below-median signals' },
  { cls: 'ROUTINE',        score: '50+',      label: 'Low signal',       color: RED,    desc: 'Routine buyer, above median for its class' },
  { cls: 'ROUTINE',        score: 'Under 50', label: 'No signal',        color: RED,    desc: 'Formulaic or small routine buy' },
]

const PAPERS = [
  {
    authors: 'Cohen, Malloy and Pomorski (2012)',
    title:   'Decoding Inside Information',
    journal: 'Journal of Finance',
    finding: 'Insiders who trade outside their historical calendar patterns ("opportunistic" traders) generate significant market-adjusted returns. Insiders on predictable schedules ("routine" traders) generate essentially nothing. The classification is a better predictor of future returns than trade size, role, or any other single variable.',
    use:     'This is the core of the Sentra classification system. Every insider\'s trades are evaluated against their own historical pattern. The opportunistic/routine split drives both the color coding and the signal interpretation.',
  },
  {
    authors: 'Jeng, Metrick and Zeckhauser (2003)',
    title:   'Estimating the Returns to Insider Trading',
    journal: 'Review of Economics and Statistics',
    finding: 'Insider purchases earn roughly 6% abnormal return over 6 months on a value-weighted basis. Insider sales show no significant predictive power.',
    use:     'This anchors the decision to score purchases only. Insider selling is noisy: insiders sell for taxes, diversification, and personal liquidity regardless of their view. Buying with personal capital is a cleaner signal.',
  },
]

const STEPS = [
  {
    step:  '01',
    title: 'Ingest SEC EDGAR Form 4 filings',
    body:  'Daily ingestion of Form 4 filings across the full Russell 3000 (~2,899 tickers). Every transaction is parsed, normalized, and stored with full insider metadata.',
  },
  {
    step:  '02',
    title: 'Classify each insider using CMP methodology',
    body:  'Each insider\'s trade history is analyzed for calendar patterns. Trades outside a predictable monthly or quarterly pattern are classified Opportunistic. Predictable, scheduled trades are Routine. Insiders without enough history to classify are Unclassifiable.',
  },
  {
    step:  '03',
    title: 'Score open market purchases 0–100',
    body:  'For each purchase, four validated factors are computed: stake increase, price momentum (Unclassifiable and Routine only), role, and size tilt. The raw composite is mapped to a 0–100 percentile rank within that insider\'s classification, calibrated from historical buys.',
  },
  {
    step:  '04',
    title: 'Display with classification color and signal bucket',
    body:  'Each trade is shown with its CMP color (green/yellow/red) and conviction score. Classification and score together determine signal strength using six buckets, from Very high signal (Opportunistic ≥50) to No signal (Routine under 50).',
  },
]

// ─── Page ────────────────────────────────────────────────────────────────────

const th = 'px-3 py-3 text-left font-mono text-[11px] font-medium tracking-[0.08em] text-muted md:px-4'
const td = 'px-3 py-[13px] md:px-4'

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background pt-16 text-text">
      <main className="mx-auto max-w-[1400px] px-4 md:px-8">

        {/* ── 1. HERO ──────────────────────────────────────────────────────── */}
        <section className="flex flex-col gap-6 border-b border-border pb-12 pt-12 md:pb-14 md:pt-20">
          <div className="font-mono text-[11px] tracking-[0.08em] text-muted md:text-xs">SENTRA SIGNALS</div>
          <h1 className="m-0 font-serif text-[42px] font-normal leading-[1.04] tracking-[-0.015em] text-heading md:text-[62px]">
            How Sentra Signals Works
          </h1>
          <p className="m-0 max-w-[580px] text-base leading-relaxed text-text-secondary md:text-[17px]">
            An insider-activity radar for the full Russell 3000. Surfaces the trades that carry real signal and filters out the noise.
          </p>
        </section>

        {/* ── 2. THE PROBLEM ───────────────────────────────────────────────── */}
        <section className={section}>
          <SectionHead label="THE PROBLEM" />
          <div className="flex max-w-[760px] flex-col gap-4">
            <p className={`${prose} text-text`}>
              The most powerful signal in markets has always been hiding in plain sight: insiders. CEOs, CFOs, and major shareholders see earnings before they are announced, contracts before they are signed, product pipelines before the market has any idea. They have an edge that no analyst and no algorithm can replicate.
            </p>
            <p className={`${prose} text-text`}>
              And by law, every time an insider acts on that conviction, they have to report it to the SEC within two business days. The data is public. The signal is sitting there. So why does it get ignored?
            </p>
            <p className={`${prose} text-text`}>
              Noise. Insiders file thousands of trades every month: routine stock grants, scheduled sales on pre-set 10b5-1 plans, small compensation exercises. None of that means anything. Finding the trades that matter means telling the difference between an insider following a calendar and one acting on conviction. That is not easy to do at scale.
            </p>
            <p className={`${prose} text-text`}>
              Sentra reads every Form 4 filing across the full Russell 3000 (~2,899 tickers), classifies each insider using a methodology grounded in academic research, and surfaces the trades where the signal is real.
            </p>
          </div>
        </section>

        {/* ── 3. CLASSIFICATION ────────────────────────────────────────────── */}
        <section className={section}>
          <SectionHead label="CMP CLASSIFICATION" title="Three Classes of Insiders" />
          <p className={`${prose} max-w-[760px]`}>
            Every insider in the Russell 3000 is classified using the Cohen, Malloy and Pomorski (2012) framework. The core insight: insiders who buy outside their historical calendar patterns generate meaningful returns. Insiders on predictable schedules generate essentially none.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
            {CLASSES.map((c) => (
              <div key={c.name} className={`${card} flex flex-col gap-3`}>
                <span className="inline-flex items-center gap-2 text-sm font-medium" style={{ color: c.color }}>
                  <Dot color={c.color} />{c.name}
                </span>
                <p className="m-0 text-sm leading-relaxed text-text-secondary">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 4. CONVICTION SCORE ──────────────────────────────────────────── */}
        <section className={section}>
          <SectionHead label="THE CONVICTION SCORE" title="A Percentile Rank Within Each Classification" />
          <div className="flex max-w-[760px] flex-col gap-4">
            <p className={prose}>
              The color tells you the classification. The number (0–100) ranks that trade relative to other trades in the same classification. A score of 80 means this trade scored better than 80% of similar trades on the same signals. It is a description of trade characteristics, not a profit prediction.
            </p>
            <p className={prose}>
              Only purchases are scored. Insider selling carries almost no forward-looking signal: insiders sell for many reasons (taxes, diversification, personal liquidity). Sentra scores open market purchases only.
            </p>
          </div>

          <h3 className={`${h3Cls} pt-4`}>Scoring Factors (walk-forward validated)</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {FACTORS.map(({ name, max, classes, desc }) => (
              <div key={name} className={`${card} flex flex-col gap-3`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-[15px] font-medium text-heading">{name}</span>
                  <span className="font-mono text-sm text-heading">{max}</span>
                </div>
                <div className="label-mono">{classes.toUpperCase()}</div>
                <p className="m-0 text-sm leading-relaxed text-text-secondary">{desc}</p>
              </div>
            ))}
          </div>
          <p className="m-0 max-w-[760px] text-sm leading-relaxed text-muted">
            Composite IC 0.05 to 0.09 across validation sample. Factors excluded from the model (noise or lookahead bias): trade size in dollars, insider cluster breadth, sector, 52-week range, and prior track record.
          </p>

          <h3 className={`${h3Cls} pt-4`}>Six Signal Buckets</h3>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface">
                  <th className={th}>CLASS</th>
                  <th className={th}>SCORE</th>
                  <th className={th}>SIGNAL</th>
                  <th className={`${th} hidden md:table-cell`}>MEANING</th>
                </tr>
              </thead>
              <tbody>
                {BUCKETS.map(({ cls, score, label, color, desc }) => (
                  <tr key={cls + score} className="border-b border-row-border align-top last:border-b-0 md:align-middle">
                    <td className={td}>
                      <span className="inline-flex items-center gap-2 font-mono text-xs" style={{ color }}>
                        <Dot color={color} />{cls}
                      </span>
                    </td>
                    <td className={`${td} whitespace-nowrap font-mono text-text-secondary`}>{score}</td>
                    <td className={td}>
                      <div className="font-medium text-heading md:whitespace-nowrap">{label}</div>
                      <div className="pt-1 text-[13px] leading-snug text-muted md:hidden">{desc}</div>
                    </td>
                    <td className={`${td} hidden text-muted md:table-cell`}>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 5. ACADEMIC FOUNDATION ───────────────────────────────────────── */}
        <section className={section}>
          <SectionHead label="ACADEMIC FOUNDATION" title="The Research Base" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] gap-4">
            {PAPERS.map(({ authors, title, finding, use, journal }) => (
              <article key={authors} className="flex flex-col gap-3 rounded-md border border-border p-6">
                <div className="label-mono">{journal.toUpperCase()}</div>
                <div className="font-serif text-[22px] leading-snug text-heading">{title}</div>
                <div className="text-[13px] text-muted">{authors}</div>
                <p className="m-0 text-[15px] leading-relaxed text-text-secondary">{finding}</p>
                <div className="flex flex-col gap-1.5 border-t border-border pt-3">
                  <div className="label-mono">HOW SENTRA USES THIS</div>
                  <p className="m-0 text-sm leading-relaxed text-muted">{use}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── 6. METHODOLOGY ───────────────────────────────────────────────── */}
        <section className={section}>
          <SectionHead label="METHODOLOGY" title="From Filing to Signal" />
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4 p-0">
            {STEPS.map(({ step, title, body }) => (
              <li key={step} className={`${card} flex flex-col gap-3`}>
                <div className="font-mono text-sm text-muted">{step}</div>
                <div className="text-[15px] font-medium leading-snug text-heading">{title}</div>
                <p className="m-0 text-sm leading-relaxed text-text-secondary">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── 7. DISCLAIMER ────────────────────────────────────────────────── */}
        <section className="pb-16 pt-10">
          <p className="m-0 max-w-[760px] text-[13px] leading-relaxed text-muted">
            Sentra Signals provides informational data sourced from public SEC filings only. It is not a registered investment advisor and nothing on this platform constitutes investment advice. Users are solely responsible for their own investment decisions.
          </p>
        </section>

      </main>
    </div>
  )
}
