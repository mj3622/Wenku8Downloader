import { createHash } from 'crypto'

export function hashCacheKey(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function normalizeCacheUrl(rawUrl: string, baseUrl?: string): string | null {
  if (!rawUrl || rawUrl.length > 2_048) return null
  try {
    const url = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    const normalized = url.toString()
    return normalized.length <= 2_048 ? normalized : null
  } catch {
    return null
  }
}
