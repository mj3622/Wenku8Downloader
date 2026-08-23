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
    const downloadEpub = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)))

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
})
