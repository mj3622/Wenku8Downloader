export type CookieProgress = {
  step: string
  message: string
}

export type DownloadProgress = {
  taskId: string
  current: number
  total: number
  phase: string
}

export type WebDownloadTask = {
  id: string
  bookId: string
  title: string
  cover?: string
  type: 'epub_full' | 'epub_volume' | 'images'
  volume?: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  phase?: string
  error?: string
  createdAt: number
  hasArtifact?: boolean
}

const isElectron = typeof window.electronAPI !== 'undefined'
const taskListeners = new Set<(tasks: WebDownloadTask[]) => void>()
let cookieListener: ((data: CookieProgress) => void) | null = null
let eventSource: EventSource | null = null

async function webRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (init.method && init.method !== 'GET' && init.method !== 'HEAD') {
    headers.set('X-Wenku8-CSRF', '1')
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  })
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event('wenku8-session-expired'))
    }
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error || `HTTP ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function connectWebEvents(): void {
  if (isElectron || eventSource) return
  eventSource = new EventSource('/api/events')
  eventSource.onmessage = (event) => {
    const message = JSON.parse(event.data) as { type: string; data: unknown }
    if (message.type === 'tasks') {
      for (const listener of taskListeners) listener(message.data as WebDownloadTask[])
    } else if (message.type === 'cookie-progress') {
      cookieListener?.(message.data as CookieProgress)
    }
  }
  eventSource.onerror = () => {
    void fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((response) => response.json())
      .then((session: { authenticated?: boolean }) => {
        if (!session.authenticated) {
          eventSource?.close()
          eventSource = null
          window.dispatchEvent(new Event('wenku8-session-expired'))
        }
      })
      .catch(() => undefined)
  }
}

export const api = {
  target: isElectron ? 'electron' as const : 'web' as const,

  getAuthSession: () =>
    isElectron
      ? Promise.resolve({ authenticated: true })
      : webRequest<{ authenticated: boolean }>('/auth/session'),

  login: (password: string) =>
    webRequest<{ authenticated: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () =>
    isElectron
      ? Promise.resolve({ authenticated: false })
      : webRequest<{ authenticated: boolean }>('/auth/logout', { method: 'POST' }),

  connectEvents: () => connectWebEvents(),

  // 配置
  getConfig: () =>
    isElectron
      ? window.electronAPI.getConfig()
      : webRequest<Record<string, unknown>>('/config'),

  setConfig: (section: string, key: string, value: unknown) =>
    isElectron
      ? window.electronAPI.setConfig(section, key, value)
      : webRequest<Record<string, unknown>>('/config', {
          method: 'PATCH',
          body: JSON.stringify({ section, key, value }),
        }),

  // Cookie
  autoGetCookie: () =>
    isElectron
      ? window.electronAPI.autoGetCookie()
      : webRequest<{ status: string; message: string }>('/cookie/auto', { method: 'POST' }),
  getCookieProgress: (callback: (data: CookieProgress) => void) => {
    if (isElectron) window.electronAPI.onCookieProgress(callback)
    else cookieListener = callback
  },

  // 搜索
  searchAuthor: (q: string) =>
    isElectron
      ? window.electronAPI.searchAuthor(q)
      : webRequest<{ results: SearchResult[] }>(`/search?field=author&q=${encodeURIComponent(q)}`),
  searchTitle: (q: string) =>
    isElectron
      ? window.electronAPI.searchTitle(q)
      : webRequest<{ results: SearchResult[] }>(`/search?field=title&q=${encodeURIComponent(q)}`),

  // 书籍
  getBook: (id: string) =>
    isElectron
      ? window.electronAPI.getBook(id)
      : webRequest<BookInfo>(`/books/${encodeURIComponent(id)}`),
  getBookImages: (id: string) =>
    isElectron
      ? window.electronAPI.getBookImages(id)
      : Promise.resolve({ images: {} as Record<string, string> }),

  // 下载
  downloadEpub: (bookId: string, volumeName?: string, taskId?: string, title?: string) =>
    isElectron
      ? window.electronAPI.downloadEpub(bookId, volumeName, taskId)
      : webRequest<{ task: WebDownloadTask }>('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            bookId,
            title,
            type: volumeName ? 'epub_volume' : 'epub_full',
            volume: volumeName,
          }),
        }),
  downloadImages: (bookId: string, volumeName?: string, taskId?: string, title?: string) =>
    isElectron
      ? window.electronAPI.downloadImages(bookId, volumeName, taskId)
      : webRequest<{ task: WebDownloadTask }>('/tasks', {
          method: 'POST',
          body: JSON.stringify({ bookId, title, type: 'images', volume: volumeName }),
        }),
  getDownloadProgress: (callback: (data: DownloadProgress) => void) => {
    if (isElectron) window.electronAPI.onDownloadProgress(callback)
  },
  getTasks: () =>
    isElectron
      ? Promise.resolve({ tasks: [] as WebDownloadTask[] })
      : webRequest<{ tasks: WebDownloadTask[] }>('/tasks'),
  onTasks: (callback: (tasks: WebDownloadTask[]) => void) => {
    taskListeners.add(callback)
    return () => taskListeners.delete(callback)
  },
  retryTask: (id: string) =>
    webRequest<{ task: WebDownloadTask }>(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' }),
  removeWebTask: (id: string) =>
    webRequest<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearWebTasks: () => webRequest<void>('/tasks', { method: 'DELETE' }),
  downloadArtifact: (id: string) => {
    window.location.assign(`/api/tasks/${encodeURIComponent(id)}/artifact`)
  },

  // 文件
  openFolder: (subdir: string) =>
    isElectron ? window.electronAPI.openFolder(subdir) : Promise.resolve(),
  selectFolder: () =>
    isElectron ? window.electronAPI.selectFolder() : Promise.resolve(null),
  openExternal: (url: string) => {
    if (isElectron) return window.electronAPI.openExternal(url)
    window.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve()
  },
}

export type SearchResult = {
  title: string
  cover: string
  id: string
  author?: string
  status?: string
  updateTime?: string
  tags?: string
  desc?: string
}

export type BookInfo = {
  book_id: string
  basic_info: Record<string, string>
  volumes: Record<string, { name: string; link: string }[]>
}

export default api
