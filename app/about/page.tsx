export default function AboutPage() {
  const C = {
    bg:      '#0a0e14',
    surface: '#0d1117',
    border:  '#1e2530',
    text:    '#e6edf3',
    muted:   '#7b8498',
    dimmed:  '#3a4a60',
    green:   '#3fb950',
    yellow:  '#d29922',
    red:     '#f85149',
    blue:    '#9ecbff',
    font:    '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }

  const section = (topPad = '72px'): React.CSSProperties => ({
    maxWidth: '1100px',
    margin:   '0 auto',
    padding:  `${topPad} clamp(16px, 4vw, 40px) 0`,
  })

  const label: React.CSSProperties = {
    fontSize:      '11px',
    letterSpacing: '2.5px',
    color:         C.muted,
    margin:        '0 0 12px',
    textTransform: 'uppercase',
  }

  const h2: React.CSSProperties = {
    fontSize:      '26px',
    fontWeight:    800,
    color:         C.text,
    margin:        '0 0 20px',
    letterSpacing: '-0.3px',
  }

  const prose: React.CSSProperties = {
    fontSize:   '15px',
    color:      C.muted,
    lineHeight: 1.75,
    margin:     '0 0 16px',
  }

  const card: React.CSSProperties = {
    background:   C.surface,
    border:       `1px solid ${C.border}`,
    borderRadius: '12px',
    padding:      '24px 28px',
  }

  const divider: React.CSSProperties = {
    maxWidth:   '1100px',
    margin:     '72px auto 0',
    borderTop:  `1px solid ${C.border}`,
  }

  const chip = (color: string): React.CSSProperties => ({
    display:         'inline-block',
    width:           '10px',
    height:          '10px',
    borderRadius:    '50%',
    background:      color,
    marginRight:     '8px',
    flexShrink:      0,
    verticalAlign:   'middle',
    position:        'relative',
    top:             '-1px',
  })

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: C.font, paddingBottom: '100px' }}>

      {/* ── 1. HERO ──────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '80px clamp(16px, 4vw, 40px) 0' }}>
        <p style={label}>SENTRA SIGNALS</p>
        <h1 style={{ fontSize: '48px', fontWeight: 800, margin: '0 0 20px', letterSpacing: '-1px', lineHeight: 1.1 }}>
          How Sentra Signals Works
        </h1>
        <p style={{ fontSize: '18px', color: C.muted, lineHeight: 1.7, maxWidth: '580px', margin: 0 }}>
          An insider-activity radar for the full Russell 3000. Surfaces the trades that carry real signal and filters out the noise.
        </p>
      </div>

      <div style={divider} />

      {/* ── 2. THE PROBLEM ───────────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>The Problem</p>
        <p style={{ ...prose, color: C.text }}>
          The most powerful signal in markets has always been hiding in plain sight: insiders. CEOs, CFOs, and major shareholders see earnings before they are announced, contracts before they are signed, product pipelines before the market has any idea. They have an edge that no analyst and no algorithm can replicate.
        </p>
        <p style={{ ...prose, color: C.text }}>
          And by law, every time an insider acts on that conviction, they have to report it to the SEC within two business days. The data is public. The signal is sitting there. So why does it get ignored?
        </p>
        <p style={{ ...prose, color: C.text }}>
          Noise. Insiders file thousands of trades every month: routine stock grants, scheduled sales on pre-set 10b5-1 plans, small compensation exercises. None of that means anything. Finding the trades that matter means telling the difference between an insider following a calendar and one acting on conviction. That is not easy to do at scale.
        </p>
        <p style={{ ...prose, color: C.text }}>
          Sentra reads every Form 4 filing across the full Russell 3000 (~2,899 tickers), classifies each insider using a methodology grounded in academic research, and surfaces the trades where the signal is real.
        </p>
      </div>

      <div style={divider} />

      {/* ── 3. CLASSIFICATION ────────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>CMP Classification</p>
        <h2 style={h2}>Three Classes of Insiders</h2>
        <p style={prose}>
          Every insider in the Russell 3000 is classified using the Cohen, Malloy and Pomorski (2012) framework. The core insight: insiders who buy outside their historical calendar patterns generate meaningful returns. Insiders on predictable schedules generate essentially none.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ ...card, borderLeft: `3px solid ${C.green}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <span style={chip(C.green)} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>Opportunistic</span>
            </div>
            <p style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65, margin: 0 }}>
              The insider bought outside their historical calendar pattern. This is the strongest class of signal. Opportunistic buyers tend to act when they have a genuine reason to buy, not because a scheduled plan told them to.
            </p>
          </div>
          <div style={{ ...card, borderLeft: `3px solid ${C.yellow}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <span style={chip(C.yellow)} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>Unclassifiable</span>
            </div>
            <p style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65, margin: 0 }}>
              There is insufficient trading history to determine a pattern. The insider may be new, filing rarely, or joining the company recently. Carries signal but with less certainty than Opportunistic.
            </p>
          </div>
          <div style={{ ...card, borderLeft: `3px solid ${C.red}` }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
              <span style={chip(C.red)} />
              <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>Routine</span>
            </div>
            <p style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65, margin: 0 }}>
              The insider trades on a predictable, calendar-driven schedule. These are typically plan-based or compensation-related transactions. The research shows they carry little forward-looking signal.
            </p>
          </div>
        </div>
      </div>

      <div style={divider} />

      {/* ── 4. CONVICTION SCORE ──────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>The Conviction Score</p>
        <h2 style={h2}>A Percentile Rank Within Each Classification</h2>
        <p style={prose}>
          The color tells you the classification. The number (0–100) ranks that trade relative to other trades in the same classification. A score of 80 means this trade scored better than 80% of similar trades on the same signals. It is a description of trade characteristics, not a profit prediction.
        </p>
        <p style={prose}>
          Only purchases are scored. Insider selling carries almost no forward-looking signal: insiders sell for many reasons (taxes, diversification, personal liquidity). Sentra scores open market purchases only.
        </p>

        <h3 style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '28px 0 16px' }}>
          Scoring Factors (walk-forward validated)
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '36px' }}>
          {[
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
          ].map(({ name, max, classes, desc }) => (
            <div key={name} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px', gap: '12px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: C.text }}>{name}</span>
                <div style={{ display: 'flex', gap: '12px', flexShrink: 0 }}>
                  <span style={{ fontSize: '12px', color: C.blue }}>{max}</span>
                  <span style={{ fontSize: '12px', color: C.dimmed }}>{classes}</span>
                </div>
              </div>
              <p style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65, margin: 0 }}>{desc}</p>
            </div>
          ))}
        </div>
        <p style={{ ...prose, fontSize: '13px', color: C.dimmed, margin: '0 0 28px' }}>
          Composite IC 0.05 to 0.09 across validation sample. Factors excluded from the model (noise or lookahead bias): trade size in dollars, insider cluster breadth, sector, 52-week range, and prior track record.
        </p>

        <h3 style={{ fontSize: '16px', fontWeight: 700, color: C.text, margin: '0 0 16px' }}>
          Six Signal Buckets
        </h3>
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {[
            { cls: 'OPPORTUNISTIC',  score: '50+',      label: 'Very high signal', color: C.green,  desc: 'Opportunistic buyer with above-median conviction signals' },
            { cls: 'UNCLASSIFIABLE', score: '50+',      label: 'High signal',      color: C.yellow, desc: 'Unclassifiable insider with above-median signals' },
            { cls: 'OPPORTUNISTIC',  score: 'Under 50', label: 'Moderate signal',  color: C.green,  desc: 'Opportunistic buyer with below-median signals' },
            { cls: 'UNCLASSIFIABLE', score: 'Under 50', label: 'Low signal',       color: C.yellow, desc: 'Unclassifiable insider with below-median signals' },
            { cls: 'ROUTINE',        score: '50+',      label: 'Low signal',       color: C.red,    desc: 'Routine buyer, above median for its class' },
            { cls: 'ROUTINE',        score: 'Under 50', label: 'No signal',        color: C.red,    desc: 'Formulaic or small routine buy' },
          ].map(({ cls, score, label: lbl, color, desc }) => (
            <div key={cls + score} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${C.border}`, gap: '16px' }}>
              <span style={chip(color)} />
              <span style={{ fontSize: '12px', color: C.dimmed, width: '130px', flexShrink: 0 }}>{cls}</span>
              <span style={{ fontSize: '12px', color: C.dimmed, width: '68px', flexShrink: 0 }}>{score}</span>
              <span style={{ fontSize: '13px', fontWeight: 600, color: C.text, width: '130px', flexShrink: 0 }}>{lbl}</span>
              <span style={{ fontSize: '13px', color: C.muted }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={divider} />

      {/* ── 5. ACADEMIC FOUNDATION ───────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>Academic Foundation</p>
        <h2 style={h2}>The Research Base</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
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
          ].map(({ authors, title, finding, use, journal }) => (
            <div key={authors} style={{ ...card, borderLeft: `3px solid ${C.blue}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: C.blue }}>{authors}</div>
                <div style={{ fontSize: '11px', color: C.dimmed, textAlign: 'right' }}>{journal}</div>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: C.text, marginBottom: '6px' }}>{title}</div>
              <div style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65, marginBottom: '12px' }}>{finding}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '1.5px', color: C.dimmed, marginBottom: '6px' }}>HOW SENTRA USES THIS</div>
              <div style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65 }}>{use}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={divider} />

      {/* ── 6. METHODOLOGY ───────────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>Methodology</p>
        <h2 style={h2}>From Filing to Signal</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
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
          ].map(({ step, title, body }) => (
            <div key={step} style={{ ...card, display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
              <div style={{
                fontSize: '13px', fontWeight: 800, color: C.dimmed,
                minWidth: '28px', paddingTop: '1px', fontVariantNumeric: 'tabular-nums',
              }}>
                {step}
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: C.text, marginBottom: '6px' }}>{title}</div>
                <div style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={divider} />

      {/* ── 7. DISCLAIMER ────────────────────────────────────────────────────── */}
      <div style={{ ...section('48px'), paddingBottom: '0' }}>
        <p style={{ fontSize: '13px', color: C.dimmed, lineHeight: 1.7, textAlign: 'center', maxWidth: '600px', margin: '0 auto' }}>
          Sentra Signals provides informational data sourced from public SEC filings only. It is not a registered investment advisor and nothing on this platform constitutes investment advice. Users are solely responsible for their own investment decisions.
        </p>
      </div>

    </div>
  )
}
