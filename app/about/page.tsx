export default function AboutPage() {
  const card: React.CSSProperties = {
    background: '#0d1117',
    border: '1px solid #1e2530',
    borderRadius: '12px',
    padding: '28px 32px',
    marginBottom: '16px',
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: '11px',
    letterSpacing: '2px',
    color: '#7b8498',
    margin: '0 0 10px',
    textTransform: 'uppercase',
  }

  const h2: React.CSSProperties = {
    fontSize: '18px',
    fontWeight: 700,
    margin: '0 0 16px',
    letterSpacing: '-0.2px',
  }

  return (
    <div style={{
      background: '#0a0e14', minHeight: '100vh', color: '#e6edf3',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 40px 80px' }}>

        {/* heading */}
        <p style={{ fontSize: '11px', letterSpacing: '2px', color: '#7b8498', margin: '0 0 10px' }}>
          SENTRA INTELLIGENCE
        </p>
        <h1 style={{ fontSize: '40px', fontWeight: 800, margin: '0 0 16px', letterSpacing: '-0.5px' }}>
          About Sentra
        </h1>
        <p style={{ color: '#7b8498', fontSize: '16px', lineHeight: 1.7, margin: '0 0 40px', maxWidth: '580px' }}>
          A signal intelligence platform that monitors SEC filings, insider activity, news sentiment,
          and market events to surface mispricing opportunities — built for portfolio managers
          priced out of Bloomberg terminals.
        </p>

        {/* how it works */}
        <div style={card}>
          <p style={sectionLabel}>How it works</p>
          <h2 style={h2}>The Sentra Score</h2>
          <p style={{ color: '#7b8498', fontSize: '14px', lineHeight: 1.7, margin: '0 0 20px' }}>
            Every ticker gets a Sentra Score from 0–100 that measures how likely a stock is mispriced
            relative to recent events. The score has three components:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {[
              {
                label: 'News Sentiment',
                pts: '40 pts',
                desc: 'Analyses the last 10 news articles for each ticker. Recent articles are weighted more heavily. Bullish sentiment near a stagnant price = opportunity.',
              },
              {
                label: 'SEC Filing Recency',
                pts: '35 pts',
                desc: 'Scores based on how recently the company filed an 8-K. Filing type matters — earnings releases and M&A activity boost the score; legal disclosures lower it.',
              },
              {
                label: 'Mispricing Signal',
                pts: '25 pts',
                desc: 'Compares 7-day price movement against sentiment direction. If sentiment is bearish but the stock hasn\'t dropped, or bullish but hasn\'t risen, that divergence is the signal.',
              },
            ].map(({ label, pts, desc }, i, arr) => (
              <div
                key={label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '12px',
                  padding: '14px 0',
                  borderBottom: i < arr.length - 1 ? '1px solid #141920' : 'none',
                  alignItems: 'start',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#c9d1d9', marginBottom: '4px' }}>
                    {label}
                  </div>
                  <div style={{ fontSize: '13px', color: '#7b8498', lineHeight: 1.6 }}>
                    {desc}
                  </div>
                </div>
                <span style={{
                  fontSize: '11px', fontWeight: 600, color: '#9ecbff',
                  background: 'rgba(158,203,255,0.08)', border: '1px solid rgba(158,203,255,0.15)',
                  borderRadius: '20px', padding: '3px 10px', whiteSpace: 'nowrap',
                }}>
                  {pts}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* data sources */}
        <div style={card}>
          <p style={sectionLabel}>Data Sources</p>
          <h2 style={h2}>Where the data comes from</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {[
              {
                name: 'SEC EDGAR',
                tag: 'Free · Official',
                desc: '8-K filings, insider transactions, and material event disclosures directly from the U.S. Securities and Exchange Commission.',
                color: '#d29922',
              },
              {
                name: 'Google News RSS',
                tag: 'Free',
                desc: 'Real-time news headlines for each ticker from Google News, parsed and scored for bullish/bearish sentiment.',
                color: '#9ecbff',
              },
              {
                name: 'Yahoo Finance',
                tag: 'Free',
                desc: 'Live price quotes, analyst price targets, 52-week ranges, and recommendation consensus via the yahoo-finance2 library.',
                color: '#3fb950',
              },
            ].map(({ name, tag, desc, color }, i, arr) => (
              <div
                key={name}
                style={{
                  display: 'flex', gap: '16px', alignItems: 'flex-start',
                  padding: '16px 0',
                  borderBottom: i < arr.length - 1 ? '1px solid #141920' : 'none',
                }}
              >
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: color, flexShrink: 0, marginTop: '5px',
                }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#c9d1d9' }}>{name}</span>
                    <span style={{
                      fontSize: '10px', color: '#7b8498',
                      border: '1px solid #1e2530', borderRadius: '4px',
                      padding: '1px 7px', letterSpacing: '0.3px',
                    }}>
                      {tag}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#7b8498', lineHeight: 1.6, margin: 0 }}>
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
