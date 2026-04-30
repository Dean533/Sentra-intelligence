export default function AboutPage() {
  const C = {
    bg:       '#0a0e14',
    surface:  '#0d1117',
    border:   '#1e2530',
    text:     '#e6edf3',
    muted:    '#7b8498',
    dimmed:   '#3a4a60',
    green:    '#3fb950',
    yellow:   '#d29922',
    blue:     '#9ecbff',
    font:     '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  }

  const section = (topPad = '72px'): React.CSSProperties => ({
    maxWidth: '1100px',
    margin: '0 auto',
    padding: `${topPad} 40px 0`,
  })

  const label: React.CSSProperties = {
    fontSize: '11px',
    letterSpacing: '2.5px',
    color: C.muted,
    margin: '0 0 12px',
    textTransform: 'uppercase',
  }

  const h2: React.CSSProperties = {
    fontSize: '26px',
    fontWeight: 800,
    color: C.text,
    margin: '0 0 20px',
    letterSpacing: '-0.3px',
  }

  const prose: React.CSSProperties = {
    fontSize: '15px',
    color: C.muted,
    lineHeight: 1.75,
    margin: '0 0 16px',
  }

  const card: React.CSSProperties = {
    background: C.surface,
    border: `1px solid ${C.border}`,
    borderRadius: '12px',
    padding: '24px 28px',
  }

  const divider: React.CSSProperties = {
    maxWidth: '1100px',
    margin: '72px auto 0',
    borderTop: `1px solid ${C.border}`,
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: C.font, paddingBottom: '100px' }}>

      {/* ── 1. HERO ──────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '80px 40px 0' }}>
        <p style={label}>SENTRA INTELLIGENCE</p>
        <h1 style={{ fontSize: '48px', fontWeight: 800, margin: '0 0 20px', letterSpacing: '-1px', lineHeight: 1.1 }}>
          How Sentra Works
        </h1>
        <p style={{ fontSize: '18px', color: C.muted, lineHeight: 1.7, maxWidth: '580px', margin: 0 }}>
          Institutional-grade insider signal detection, powered by academic research.
        </p>
      </div>

      <div style={divider} />

      {/* ── INTRO ────────────────────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>OUR THESIS</p>
        {[
          "Investors try to make money in the market through all different types of comlicated means; whether it's analyzing financial statements, building large language models, or even using satellite imagery to count the number of cars in a retailer store parking lot. But the single most powerful signal has always been hidden in plain sight: insiders.",
          "CEOs, CFOs, and major shareholders see earnings before they're announced, contracts before they're signed, and product pipelines before the market has any idea. They have an edge that no analyst, no algorithm, and no hedge fund can replicate. And fortunately for us, every time they act on that conviction, they have to tell you about it.",
          "By law, every insider trade must be reported to the SEC within 2 business days. The information is public. The signal is hiding in plain sight. So why isn't everyone using it?",
          "The problem is noise. Insiders file thousands of trades every month: outine stock grants, scheduled 10b5-1 plan sales, compensation exercises. None of trhat means anything. Finding the trades that actually matter requires knowing the difference between an insider following a calendar and an insider acting on conviction, isnt easy.",
          "But that's the entire thesis of Sentra. We built a system that reads every Form 4 filing across the S&P 500, classifies each insider using a methodology developed by Harvard and MIT researchers, and surfaces only the trades where someone with real conviction is putting real money to work.",
        ].map((para, i) => (
          <p key={i} style={{ ...prose, color: C.text }}>{para}</p>
        ))}
      </div>

      <div style={divider} />


      {/* ── 3. ACADEMIC FOUNDATION ───────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>Academic Foundation</p>
        <h2 style={h2}>The Research Base</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
          {[
            {
              authors: 'Seyhun (1986)',
              title: "Insiders' Profits, Costs of Trading, and Market Efficiency",
              journal: 'Journal of Financial Economics',
              finding: 'Foundational study establishing that insider purchases predict positive abnormal returns and insider sales predict negative returns, proving insiders systematically exploit private information.',
              adapted: 'Sentra adapted the finding that purchase size relative to company size is the strongest predictor of abnormal returns. We use this to weight relative purchase size most heavily in our expected move calculation, giving more significance to buys in smaller companies than the same dollar amount in a mega cap.',
            },
            {
              authors: 'Jeng, Metrick & Zeckhauser (2003)',
              title: 'Estimating the Returns to Insider Trading',
              journal: 'Review of Economics and Statistics',
              finding: 'Insider purchases earn roughly 6% abnormal return over 6 months on a value-weighted basis. Insider sales show no significant predictive power; buys are the signal.',
              adapted: 'Sentra adapted the finding that insider purchases earn roughly 6% abnormal return over 6 months, with buys carrying the signal and sales carrying none. This anchors our expected move estimates and is why Sentra only tracks open market purchases, not sales or option exercises.',
            },
            {
              authors: 'Cohen, Malloy & Pomorski (2012)',
              title: 'Decoding Inside Information',
              journal: 'Journal of Finance',
              finding: 'Insiders who trade outside their historical calendar patterns generate significant market-adjusted alpha. Insiders on predictable schedules generate essentially nothing. This distinction is the core of Sentra\'s methodology.',
              adapted: "Sentra adapted the core distinction between opportunistic and routine insiders. Insiders who buy outside their historical patterns generate the meaningful signal. This is why Sentra's classification system filters for opportunistic buyers and discounts predictable calendar-driven transactions.",
            },
          ].map(({ authors, title, finding, adapted, journal }) => (
            <div key={authors} style={{ ...card, borderLeft: `3px solid ${C.blue}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: C.blue }}>{authors}</div>
                <div style={{ fontSize: '11px', color: C.dimmed, textAlign: 'right' }}>{journal}</div>
              </div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: C.text, marginBottom: '6px' }}>{title}</div>
              <div style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65, marginBottom: '12px' }}>{finding}</div>
              <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '1.5px', color: C.dimmed, marginBottom: '6px' }}>HOW SENTRA USES THIS</div>
              <div style={{ fontSize: '13px', color: C.muted, lineHeight: 1.65 }}>{adapted}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={divider} />

      {/* ── 4. METHODOLOGY ───────────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>Our Methodology</p>
        <h2 style={h2}>From Filing to Signal</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            {
              step: '01',
              title: 'Ingest SEC EDGAR Form 4 filings',
              body:  'Daily ingestion of Form 4 filings across 522 S&P 500 stocks. Every transaction is parsed, normalized, and stored with full insider metadata.',
            },
            {
              step: '02',
              title: 'Classify insiders as Routine or Opportunistic',
              body:  '3-year rolling calendar analysis per insider. Trades that align with a predictable monthly or quarterly pattern are flagged Routine. All others are Opportunistic.',
            },
            {
              step: '03',
              title: 'Score every signal 0–100',
              body:  'Our conviction engine weighs role seniority, trade size, sector alpha history, insider clustering, track record, and known high-alpha insiders.',
            },
            {
              step: '04',
              title: 'Surface actionable alerts',
              body:  'Only signals scoring ≥70 are surfaced as trade alerts. Scores of 60–69 are flagged for monitoring. Routine trades and low-conviction signals are filtered out.',
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

      {/* ── 5. CONVICTION SCORE ──────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>The Conviction Score</p>
        <h2 style={h2}>0–100 Signal Scoring Engine</h2>
        <div style={{ borderTop: `1px solid ${C.border}` }}>
          {[
            { criterion: 'Opportunistic classification (CMP 2012)',              desc: 'Insider trades outside their historical calendar pattern',                                    value: 'Base: 50 pts' },
            { criterion: 'Routine classification (CMP 2012)',                    desc: 'Insider trades on a predictable schedule',                                                   value: 'Hard cap: 1–49 pts' },
            { criterion: 'Open market purchase (Form 4, Code P)',                desc: 'Required condition — signal is void if absent',                                             value: 'Required: +0 pts' },
            { criterion: 'Transaction size $500K–$5M',                          desc: '',                                                                                           value: '+8 pts' },
            { criterion: 'Transaction size $5M–$25M',                           desc: '',                                                                                           value: '+15 pts' },
            { criterion: 'Transaction size >$25M',                              desc: '',                                                                                           value: '-10 pts' },
            { criterion: 'Purchase as % of market cap 0.01–0.05%',              desc: '',                                                                                           value: '+5 pts' },
            { criterion: 'Purchase as % of market cap 0.05–0.1%',               desc: '',                                                                                           value: '+10 pts' },
            { criterion: 'Purchase as % of market cap >0.1%',                   desc: '',                                                                                           value: '+18 pts' },
            { criterion: 'CEO or Executive Chairman role',                       desc: '',                                                                                           value: '+14 pts' },
            { criterion: '10% Owner role',                                       desc: '',                                                                                           value: '+20 pts' },
            { criterion: 'CFO or COO role',                                      desc: '',                                                                                           value: '+10 pts' },
            { criterion: 'Director role',                                        desc: '',                                                                                           value: '+6 pts' },
            { criterion: 'Insider cluster — 2 buyers, same 30d window',         desc: '',                                                                                           value: '+5 pts' },
            { criterion: 'Insider cluster — 3 buyers, same 30d window',         desc: '',                                                                                           value: '+9 pts' },
            { criterion: 'Insider cluster — 4+ buyers, same 30d window',        desc: '',                                                                                           value: '+12 pts' },
            { criterion: 'Communication Services sector',                        desc: '',                                                                                           value: '+12 pts' },
            { criterion: 'Financial Services sector',                            desc: '',                                                                                           value: '+8 pts' },
            { criterion: 'Industrials sector',                                   desc: '',                                                                                           value: '+7 pts' },
            { criterion: 'Consumer Cyclical sector',                             desc: '',                                                                                           value: '+6 pts' },
            { criterion: 'Stock in bottom 20% of 52-week range',                desc: '',                                                                                           value: '+6 pts' },
            { criterion: 'Stock in bottom 40% of 52-week range',                desc: '',                                                                                           value: '+3 pts' },
            { criterion: 'Stock in top 20% of 52-week range',                   desc: '',                                                                                           value: '-4 pts' },
            { criterion: 'Prior opportunistic buy, same insider, within 180d',  desc: '',                                                                                           value: '+5 pts' },
            { criterion: 'Maximum score (opportunistic)',                        desc: '',                                                                                           value: '100 pts' },
            { criterion: 'Minimum score (routine, any criteria)',                desc: '',                                                                                           value: '49 pts' },
          ].map(({ criterion, desc, value }) => (
            <div key={criterion} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0', borderBottom: `1px solid ${C.border}`, gap: '24px' }}>
              <div>
                <span style={{ fontSize: '13px', color: C.text }}>{criterion}</span>
                {desc && <span style={{ fontSize: '12px', color: C.muted, marginLeft: '8px' }}>{desc}</span>}
              </div>
              <span style={{ fontSize: '13px', color: C.muted, whiteSpace: 'nowrap', flexShrink: 0 }}>{value}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: '14px', color: C.muted, lineHeight: 1.75, margin: '24px 0 0' }}>
          Scores of 70 or above trigger a Sentra signal. Scores of 85 or above are classified as high conviction. Routine traders never exceed 49 regardless of transaction size or cluster activity.
        </p>
      </div>

      <div style={divider} />

      {/* ── 6. BACKTEST RESULTS ──────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>Backtest Results</p>
        <h2 style={h2}>88,044 Trades · 2015–2026</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '12px' }}>
          {[
            { stat: '88,044', sub: 'Insider transactions analyzed' },
            { stat: '59.7%',  sub: 'Win rate, all opportunistic' },
            { stat: '90%',    sub: 'Win rate at conviction ≥70' },
            { stat: '100%',   sub: 'Win rate at conviction ≥85' },
            { stat: '+12.9%', sub: 'Avg alpha at 180d (score ≥70)' },
            { stat: '11yr',   sub: 'Dataset spanning 2015–2026' },
          ].map(({ stat, sub }) => (
            <div key={sub} style={{ ...card, textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: 800, color: C.green, letterSpacing: '-0.5px', lineHeight: 1, marginBottom: '6px' }}>
                {stat}
              </div>
              <div style={{ fontSize: '12px', color: C.muted, lineHeight: 1.4 }}>{sub}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div style={{ ...card, borderLeft: `3px solid ${C.green}` }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', color: C.muted, marginBottom: '8px' }}>BEST ROLE</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.text, marginBottom: '4px' }}>10% Owner</div>
            <div style={{ fontSize: '13px', color: C.muted }}>100% win rate at 180 days</div>
          </div>
          <div style={{ ...card, borderLeft: `3px solid ${C.green}` }}>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.5px', color: C.muted, marginBottom: '8px' }}>BEST SECTOR</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.text, marginBottom: '4px' }}>Communication Services</div>
            <div style={{ fontSize: '13px', color: C.muted }}>81% win rate</div>
          </div>
        </div>
      </div>

      <div style={divider} />

      {/* ── 7. TRADING SYSTEM ────────────────────────────────────────────────── */}
      <div style={section()}>
        <p style={label}>The Trading System</p>
        <h2 style={h2}>Automated Signal Execution</h2>
        <p style={prose}>
          Qualifying signals are executed automatically on Alpaca paper trading via a daily
          cron job. Every trade follows a strict rules-based framework:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {[
            { label: 'ENTRY',       value: 'Score ≥70',         sub: 'Opportunistic only' },
            { label: 'STOP LOSS',   value: '−15%',              sub: 'Hard exit within 30d' },
            { label: 'TAKE PROFIT', value: '+25%',              sub: 'Limit order attached' },
            { label: 'HOLD PERIOD', value: '90–180 days',       sub: 'Role and sector adjusted' },
            { label: 'TIER 1',      value: '$10,000 split',     sub: 'Score ≥70, equal weight' },
            { label: 'TIER 2',      value: '$500 flat',         sub: 'Score 60–69, monitor size' },
          ].map(({ label: l, value, sub }) => (
            <div key={l} style={card}>
              <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', color: C.muted, marginBottom: '8px' }}>{l}</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: C.text, lineHeight: 1, marginBottom: '4px' }}>{value}</div>
              <div style={{ fontSize: '12px', color: C.dimmed }}>{sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={divider} />

      {/* ── 8. DISCLAIMER ────────────────────────────────────────────────────── */}
      <div style={{ ...section('48px'), paddingBottom: '0' }}>
        <p style={{ fontSize: '12px', color: C.dimmed, lineHeight: 1.7, textAlign: 'center', maxWidth: '560px', margin: '0 auto' }}>
          Sentra is a research and paper trading platform. All signals are for informational
          purposes only. Past performance does not guarantee future results.
        </p>
      </div>

    </div>
  )
}
