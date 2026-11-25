// Ticker headlines for the ticker page: Yahoo Finance search news (has thumbnails)
// merged with Google News RSS (wider coverage), last 7 days, deduped, scored with
// the free keyword model in ./sentiment. Read-only: nothing is written to the DB.
import YahooFinance from 'yahoo-finance2'
import { scoreHeadline, type Sentiment } from './sentiment'

export type NewsItem = {
  id: string
  title: string
  url: string
  source: string
  sourceDomain: string | null
  publishedAt: string
  thumbnail: string | null
  sentiment: Sentiment
  score: number
}

const yahoo = new YahooFinance()
const WINDOW_DAYS = 7
const MIN_ITEMS = 30
const MAX_ITEMS = 80
const TTL_MS = 10 * 60_000
const cache = new Map<string, { at: number; items: NewsItem[] }>()

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim()
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return m ? decode(m[1]) : ''
}

function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

// Strip the " - Publisher" suffix Google appends, when it matches the source.
function cleanTitle(title: string, source: string): string {
  const suffix = ` - ${source}`
  return source && title.endsWith(suffix) ? title.slice(0, -suffix.length) : title
}

// Yahoo links all point at finance.yahoo.com, so map the publisher to its own
// domain for the logo fallback. Unknown publishers get initials in the UI.
const PUBLISHER_DOMAINS: Record<string, string> = {
  'reuters': 'reuters.com', 'bloomberg': 'bloomberg.com', "barron's": 'barrons.com', 'marketwatch': 'marketwatch.com',
  'the wall street journal': 'wsj.com', 'wsj': 'wsj.com', 'forbes': 'forbes.com', 'cnbc': 'cnbc.com',
  "investor's business daily": 'investors.com', 'motley fool': 'fool.com', 'the motley fool': 'fool.com',
  'benzinga': 'benzinga.com', 'zacks': 'zacks.com', 'simply wall st.': 'simplywall.st', 'thestreet': 'thestreet.com',
  'insider monkey': 'insidermonkey.com', 'gurufocus.com': 'gurufocus.com', 'investing.com': 'investing.com',
  'stocktwits': 'stocktwits.com', 'barchart': 'barchart.com', 'seeking alpha': 'seekingalpha.com',
  'yahoo finance': 'finance.yahoo.com', 'yahoo finance video': 'finance.yahoo.com', 'business insider': 'businessinsider.com',
  'fortune': 'fortune.com', 'associated press finance': 'apnews.com', 'ap finance': 'apnews.com', 'quartz': 'qz.com',
  'financial times': 'ft.com', 'the information': 'theinformation.com', 'tipranks': 'tipranks.com',
  'globenewswire': 'globenewswire.com', 'business wire': 'businesswire.com', 'pr newswire': 'prnewswire.com',
  'accesswire': 'accesswire.com', 'investorplace': 'investorplace.com', '24/7 wall st.': '247wallst.com',
  'decrypt': 'decrypt.co', 'coindesk': 'coindesk.com', 'kiplinger': 'kiplinger.com', 'morningstar research': 'morningstar.com',
}

const dedupeKey =(t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 70)

async function fromYahoo(symbol: string): Promise<NewsItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- yahoo-finance2 search typing is loose
  const res: any = await yahoo.search(symbol, { newsCount: 50, quotesCount: 0 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res?.news ?? []).map((n: any): NewsItem & { related: boolean } => {
    const res140 = n.thumbnail?.resolutions?.find((r: { tag: string }) => r.tag === '140x140')
    const any0 = n.thumbnail?.resolutions?.[0]
    const s = scoreHeadline(n.title)
    return {
      id: `y-${n.uuid}`,
      title: n.title,
      url: n.link,
      source: n.publisher ?? 'Yahoo Finance',
      sourceDomain: PUBLISHER_DOMAINS[String(n.publisher ?? '').toLowerCase()] ?? null,
      publishedAt: new Date(n.providerPublishTime).toISOString(),
      thumbnail: res140?.url ?? any0?.url ?? null,
      sentiment: s.label,
      score: s.score,
      related: Array.isArray(n.relatedTickers) && n.relatedTickers.includes(symbol),
    }
  })
}

// Query 30 days back so thin tickers can still reach MIN_ITEMS; the 7-day selection happens later.
async function fromGoogle(symbol: string, company: string | null): Promise<NewsItem[]> {
  const q = company ? `"${symbol}" OR "${company}" stock when:30d` : `${symbol} stock when:30d`
  const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SentraSignals/1.0)' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`google news ${res.status}`)
  const xml = await res.text()
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m, i): NewsItem | null => {
    const body = m[1]
    const source = tag(body, 'source')
    const srcUrl = body.match(/<source[^>]*url="([^"]+)"/i)?.[1] ?? null
    const title = cleanTitle(tag(body, 'title'), source)
    const link = tag(body, 'link')
    const date = Date.parse(tag(body, 'pubDate'))
    if (!title || !link || Number.isNaN(date)) return null
    const s = scoreHeadline(title)
    return {
      id: `g-${i}-${dedupeKey(title).slice(0, 24)}`,
      title,
      url: link,
      source: source || domainOf(srcUrl) || 'Google News',
      sourceDomain: domainOf(srcUrl),
      publishedAt: new Date(date).toISOString(),
      thumbnail: null,
      sentiment: s.label,
      score: s.score,
    }
  }).filter((x): x is NewsItem => x != null)
}

// Company name without legal suffixes, for the Google query ("NVIDIA Corporation" → "NVIDIA").
function shortName(name: string | null): string | null {
  if (!name) return null
  const n = name.replace(/[,.]/g, '').replace(/\b(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|plc|Holdings?|Group|SA|NV|AG|LP)\b/gi, '').replace(/\s+/g, ' ').trim()
  return n.length >= 3 ? n : null
}

// Common all-caps acronyms that look like tickers but aren't — excluded so a
// headline like "AI chip demand..." doesn't get flagged as "about another company."
const ACRONYM_STOPLIST = new Set([
  'AI', 'ML', 'CEO', 'CFO', 'COO', 'CTO', 'CMO', 'CIO', 'IPO', 'SEC', 'US', 'UK', 'EU', 'UN', 'USA',
  'GDP', 'CPI', 'PPI', 'YOY', 'QOQ', 'ATH', 'ESG', 'ETF', 'ETFS', 'IRS', 'FDA', 'FTC', 'FBI', 'CIA',
  'DOJ', 'FOMC', 'FED', 'NYSE', 'SPAC', 'EPS', 'GAAP', 'EV', 'EVS', 'GPU', 'GPUS', 'CPU', 'CPUS',
  'API', 'APIS', 'IT', 'HR', 'PR', 'ID', 'SA', 'AG', 'NV', 'PLC', 'LLC', 'LP', 'VC', 'OK', 'TV', 'PC',
])

// A headline mentioning our name/ticker in passing (e.g. "COHR Stock Swings After
// Nvidia-Led AI Rally") isn't about us — it's about whichever other ticker-looking
// token leads the headline. If OUR symbol is spelled out explicitly, trust that
// over position; otherwise, drop it when a different ticker-like token is present.
function isAboutAnotherCompany(title: string, symbol: string): boolean {
  const tokens: string[] = title.match(/\b[A-Z]{2,5}\b/g) ?? []
  if (tokens.includes(symbol)) return false
  return tokens.some((t) => !ACRONYM_STOPLIST.has(t))
}

export async function getTickerNews(symbol: string, companyName: string | null = null): Promise<NewsItem[]> {
  const key = symbol.toUpperCase()
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items

  const short = shortName(companyName)
  const [y, g] = await Promise.allSettled([fromYahoo(key), fromGoogle(key, short)])
  if (y.status === 'rejected') console.error('[news] yahoo failed:', y.reason?.message ?? y.reason)
  if (g.status === 'rejected') console.error('[news] google failed:', g.reason?.message ?? g.reason)
  // Yahoo first so its thumbnailed copy wins the dedupe.
  const merged = [...(y.status === 'fulfilled' ? y.value : []), ...(g.status === 'fulfilled' ? g.value : [])]

  // Relevance: Yahoo's search feed mixes in general market stories, so keep an item
  // only if the headline names the company or ticker.
  const names = [key, short, short?.split(' ')[0]]
    .filter((x): x is string => !!x && x.length >= 3)
    .map((x) => x.toLowerCase())
  const mentions = (title: string) => {
    const t = ` ${title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')} `
    return names.some((n) => t.includes(` ${n.replace(/[^a-z0-9 ]+/g, ' ')} `))
  }
  const relevant = merged.filter((n) => mentions(n.title) && !isAboutAnotherCompany(n.title, key))

  const seen = new Set<string>()
  const unique = relevant.filter((n) => {
    const k = dedupeKey(n.title)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  unique.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

  // Last 7 days, balanced across days: a busy ticker's newest day would otherwise
  // fill the whole cap. Round-robin newest-first through each day's items.
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const recent = unique.filter((n) => n.publishedAt >= cutoff)
  let picked: NewsItem[]
  if (recent.length > MAX_ITEMS) {
    const byDay = new Map<string, NewsItem[]>()
    for (const n of recent) {
      const d = n.publishedAt.slice(0, 10)
      if (!byDay.has(d)) byDay.set(d, [])
      byDay.get(d)!.push(n)
    }
    const days = [...byDay.values()]
    picked = []
    for (let i = 0; picked.length < MAX_ITEMS && days.some((d) => d.length > i); i++) {
      for (const d of days) if (d[i] && picked.length < MAX_ITEMS) picked.push(d[i])
    }
    picked.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  } else if (recent.length >= MIN_ITEMS) {
    picked = recent
  } else {
    // Thin coverage: fall back to the newest MIN_ITEMS regardless of age.
    picked = unique.slice(0, MIN_ITEMS)
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const items: NewsItem[] = picked.map(({ related, ...n }: NewsItem & { related?: boolean }) => n)

  cache.set(key, { at: Date.now(), items })
  return items
}
