export const WENKU_BASE_URL = 'https://www.wenku8.net'

export function wenkuRequestCredentials(rawUrl: string): 'include' | 'omit' {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase()
    return hostname === 'wenku8.net' || hostname.endsWith('.wenku8.net')
      ? 'include'
      : 'omit'
  } catch {
    return 'omit'
  }
}
