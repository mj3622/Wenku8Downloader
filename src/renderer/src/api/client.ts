const BASE_URL = 'http://127.0.0.1:52525'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(msg || `请求失败: ${res.status}`)
  }
  return res.json()
}

export const api = {
  // 配置
  getConfig: () => request<Record<string, unknown>>('/api/config'),
  setConfig: (section: string, key: string, value: string) =>
    request('/api/config', {
      method: 'POST',
      body: JSON.stringify({ section, key, value }),
    }),

  // Cookie
  autoGetCookie: () => request('/api/cookie/auto', { method: 'POST' }),

  // 搜索
  searchAuthor: (q: string) =>
    request<{ results: SearchResult[] }>(`/api/search/author?q=${encodeURIComponent(q)}`),
  searchTitle: (q: string) =>
    request<{ results: SearchResult[] }>(`/api/search/title?q=${encodeURIComponent(q)}`),

  // 书籍
  getBook: (id: string) => request<BookInfo>(`/api/book/${id}`),
  getBookImages: (id: string) =>
    request<{ images: Record<string, string[]> }>(`/api/book/${id}/images`),

  // 下载
  downloadEpub: (bookId: string, volumeName?: string) =>
    request('/api/download/epub', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId, volume_name: volumeName ?? null }),
    }),
  downloadImages: (bookId: string, volumeName?: string) =>
    request('/api/download/images', {
      method: 'POST',
      body: JSON.stringify({ book_id: bookId, volume_name: volumeName ?? null }),
    }),
}

export type SearchResult = {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  tags?: string
  desc?: string
}

export type BookInfo = {
  book_id: string
  basic_info: Record<string, string>
  volumes: Record<string, { name: string; link: string }[]>
}
