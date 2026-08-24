import { afterEach, describe, expect, it, vi } from 'vitest'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('downloadStore.clearHistory', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('keeps both downloading and pending tasks visible', async () => {
    const resolvers: Array<() => void> = []
    const downloadEpub = vi.fn(() => new Promise<{ status: 'ok'; message: string }>((resolve) => {
      resolvers.push(() => resolve({ status: 'ok', message: '下载完成' }))
    }))

    vi.stubGlobal('localStorage', createStorage())
    vi.stubGlobal('window', {
      electronAPI: {
        downloadEpub,
        onDownloadProgress: () => undefined,
      },
    })

    const { useDownloadStore } = await import('./downloadStore')
    const store = useDownloadStore.getState()
    store.downloadEpub('1', '第一本')
    store.downloadEpub('2', '第二本')

    expect(useDownloadStore.getState().tasks.map((task) => task.status).sort()).toEqual([
      'downloading',
      'pending',
    ])

    store.clearHistory()

    expect(useDownloadStore.getState().tasks.map((task) => task.status).sort()).toEqual([
      'downloading',
      'pending',
    ])

    resolvers.shift()?.()
    await vi.waitFor(() => expect(downloadEpub).toHaveBeenCalledTimes(2))
    resolvers.shift()?.()
    await vi.waitFor(() => {
      expect(useDownloadStore.getState().tasks.every((task) => task.status === 'completed')).toBe(true)
    })
  })

  it('stores a friendly failure and raises a toast for a rejected download', async () => {
    vi.stubGlobal('localStorage', createStorage())
    vi.stubGlobal('window', {
      electronAPI: {
        downloadEpub: vi.fn(async () => {
          throw new Error("Error invoking remote method 'download:epub': Error: HTTP 403 Cookie expired")
        }),
        onDownloadProgress: () => undefined,
      },
    })

    const { useDownloadStore } = await import('./downloadStore')
    const { useToastStore } = await import('./toastStore')
    useToastStore.getState().clear()
    useDownloadStore.getState().downloadEpub('3057', '测试作品')

    await vi.waitFor(() => {
      expect(useDownloadStore.getState().tasks[0]?.status).toBe('failed')
    })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.error).toBe('请前往配置页重新登录，然后再试一次。')
    expect(JSON.stringify(task)).not.toContain('HTTP 403')
    expect(useToastStore.getState().items[0]?.title).toBe('登录状态已失效')
  })

  it('marks partial success with a safe persistent warning', async () => {
    vi.stubGlobal('localStorage', createStorage())
    vi.stubGlobal('window', {
      electronAPI: {
        downloadEpub: vi.fn(async () => ({
          status: 'ok',
          message: '下载完成',
          warnings: ['封面未能下载，正文已正常保存。', 'Error: IPC local path C:\\Users\\tester'],
        })),
        onDownloadProgress: () => undefined,
      },
    })

    const { useDownloadStore } = await import('./downloadStore')
    const { useToastStore } = await import('./toastStore')
    useToastStore.getState().clear()
    useDownloadStore.getState().downloadEpub('3057', '测试作品')

    await vi.waitFor(() => {
      expect(useDownloadStore.getState().tasks[0]?.status).toBe('completed')
    })
    const task = useDownloadStore.getState().tasks[0]
    expect(task.warning).toContain('封面未能下载')
    expect(task.warning).not.toContain('IPC')
    expect(useToastStore.getState().items[0]?.tone).toBe('warning')
  })

  it('returns a result and warns when retry is not possible', async () => {
    vi.stubGlobal('localStorage', createStorage())
    vi.stubGlobal('window', {
      electronAPI: {
        downloadEpub: vi.fn(async () => ({ status: 'ok', message: '下载完成' })),
        onDownloadProgress: () => undefined,
      },
    })

    const { useDownloadStore } = await import('./downloadStore')
    const { useToastStore } = await import('./toastStore')
    useToastStore.getState().clear()

    expect(useDownloadStore.getState().retryTask('missing')).toBe(false)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '无法重试下载',
    })
  })

  it('sanitizes legacy persisted task errors during migration', async () => {
    const storage = createStorage()
    storage.setItem('wenku8-download-history', JSON.stringify({
      state: {
        tasks: [{
          id: 'legacy-1',
          bookId: '3057',
          title: '旧记录',
          type: 'epub_full',
          status: 'failed',
          progress: 0,
          error: 'Error: IPC failed at C:\\Users\\tester',
          createdAt: 1,
        }],
      },
      version: 0,
    }))
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('window', {
      electronAPI: {
        onDownloadProgress: () => undefined,
      },
    })

    const { useDownloadStore } = await import('./downloadStore')

    expect(useDownloadStore.getState().tasks[0]?.error).toBe(
      '下载未能完成，请检查网络和下载设置后重试。',
    )
  })
})
