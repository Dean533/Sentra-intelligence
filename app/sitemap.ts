import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 86400 // regenerate at most once per day

const BASE = 'https://www.sentrasignals.com'

const STATIC: MetadataRoute.Sitemap = [
  { url: BASE,                    changeFrequency: 'daily',   priority: 1.0 },
  { url: `${BASE}/explore`,       changeFrequency: 'daily',   priority: 0.9 },
  { url: `${BASE}/events`,        changeFrequency: 'daily',   priority: 0.9 },
  { url: `${BASE}/signals`,       changeFrequency: 'daily',   priority: 0.9 },
  { url: `${BASE}/top`,           changeFrequency: 'daily',   priority: 0.8 },
  { url: `${BASE}/narratives`,    changeFrequency: 'daily',   priority: 0.8 },
  { url: `${BASE}/about`,         changeFrequency: 'monthly', priority: 0.7 },
  { url: `${BASE}/login`,         changeFrequency: 'monthly', priority: 0.5 },
  { url: `${BASE}/privacy`,       changeFrequency: 'monthly', priority: 0.4 },
  { url: `${BASE}/terms`,         changeFrequency: 'monthly', priority: 0.4 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PRIVATE_SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data } = await supabase
    .from('tickers')
    .select('symbol')

  const tickerEntries: MetadataRoute.Sitemap = (data ?? []).map(
    ({ symbol }: { symbol: string }) => ({
      url: `${BASE}/t/${symbol}`,
      changeFrequency: 'weekly',
      priority: 0.6,
    })
  )

  return [...STATIC, ...tickerEntries]
}
