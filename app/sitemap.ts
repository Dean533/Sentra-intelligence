import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://www.sentrasignals.com',
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://www.sentrasignals.com/explore',
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: 'https://www.sentrasignals.com/events',
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: 'https://www.sentrasignals.com/about',
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: 'https://www.sentrasignals.com/login',
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ]
}
