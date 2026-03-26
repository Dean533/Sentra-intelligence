import { createClient } from '@supabase/supabase-js'

// ── sentiment ──────────────────────────────────────────────────────────────────

const BULLISH = [
  'beat', 'beats', 'surge', 'surges', 'jump', 'jumps', 'raises', 'growth',
  'strong', 'upgrade', 'upgraded', 'buy', 'profit', 'record', 'wins', 'win',
  'expands', 'rally', 'rallies', 'gains', 'rises', 'soars', 'outperforms',
]
const BEARISH = [
  'miss', 'misses', 'fall', 'falls', 'drop', 'drops', 'cut', 'cuts', 'loss',
  'losses', 'weak', 'downgrade', 'downgraded', 'sell', 'layoffs', 'layoff',
  'lawsuit', 'investigation', 'decline', 'declines', 'plunge', 'plunges',
  'tumbles', 'slumps', 'warn', 'warning',
]

export function sentimentLabel(title: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = title.toLowerCase()
  const b = BULLISH.filter((w) => lower.includes(w)).length
  const r = BEARISH.filter((w) => lower.includes(w)).length
  return b > r ? 'bullish' : r > b ? 'bearish' : 'neutral'
}

// ── XML helpers ────────────────────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // handles <tag>...</tag> and CDATA
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!m) return ''
  return m[1]
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

interface RSSItem { title: string; link: string; pubDate: string; sourceName: string }

function parseRSSItems(xml: string): RSSItem[] {
  const matches = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
  return matches
    .map((m) => ({
      title:      extractTag(m[1], 'title'),
      link:       extractTag(m[1], 'link'),
      pubDate:    extractTag(m[1], 'pubDate'),
      sourceName: extractTag(m[1], 'source'),
    }))
    .filter((a) => a.title && a.link)
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return 'Unknown' }
}

async function fetchFeed(url: string): Promise<RSSItem[]> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Sentra Intelligence contact@sentra.com' },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const xml = await res.text()
  return parseRSSItems(xml)
}

// ── main export ────────────────────────────────────────────────────────────────

export async function ingestTicker(
  ticker: string,
  supabase: ReturnType<typeof createClient>
): Promise<{ inserted: number; total_found: number; articles: any[] }> {
  const articles: RSSItem[] = []

  // Source 1: Google News RSS
  try {
    const items = await fetchFeed(
      `https://news.google.com/rss/search?q=${encodeURIComponent(ticker + ' stock')}&hl=en-US&gl=US&ceid=US:en`
    )
    items.forEach((i) => articles.push({ ...i, sourceName: i.sourceName || extractDomain(i.link) }))
  } catch { /* Google News unavailable — skip */ }

  // Source 2: Benzinga RSS
  try {
    const items = await fetchFeed(`https://www.benzinga.com/stock/${ticker.toLowerCase()}/feed`)
    items.forEach((i) => articles.push({ ...i, sourceName: 'Benzinga' }))
  } catch { /* Benzinga returns 404 for many tickers — expected */ }

  const total_found = articles.length

  // Always return existing DB articles even if no new ones fetched
  if (total_found === 0) {
    const { data } = await supabase
      .from('events')
      .select('id, title, summary, source_url, published_at, raw_text')
      .eq('ticker', ticker)
      .eq('event_type', 'news')
      .order('published_at', { ascending: false })
      .limit(8)
    return { inserted: 0, total_found: 0, articles: data ?? [] }
  }

  // Deduplication against existing events
  const urls = articles.map((a) => a.link).filter(Boolean)
  const { data: existing } = await supabase
    .from('events')
    .select('source_url')
    .in('source_url', urls)
  const seenUrls = new Set((existing ?? []).map((e: any) => e.source_url))

  const newRows = articles
    .filter((a) => !seenUrls.has(a.link))
    .map((a) => {
      const sentiment = sentimentLabel(a.title)
      const publishedAt = a.pubDate
        ? (() => { try { return new Date(a.pubDate).toISOString() } catch { return new Date().toISOString() } })()
        : new Date().toISOString()
      return {
        ticker,
        event_type: 'news',
        title: a.title,
        summary: sentiment,
        source_url: a.link,
        published_at: publishedAt,
        raw_text: JSON.stringify({ source: a.sourceName || extractDomain(a.link), sentiment }),
      }
    })

  if (newRows.length > 0) {
    await supabase.from('events').insert(newRows)
  }

  // Return latest 8 from DB (includes newly inserted)
  const { data: dbArticles } = await supabase
    .from('events')
    .select('id, title, summary, source_url, published_at, raw_text')
    .eq('ticker', ticker)
    .eq('event_type', 'news')
    .order('published_at', { ascending: false })
    .limit(8)

  return { inserted: newRows.length, total_found, articles: dbArticles ?? [] }
}
