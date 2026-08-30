import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DownloadApi,
  CacheApi,
  CatalogApi,
  BookshelfApi,
  DiscoveryApi,
  DownloadStateEvent,
  EnqueueDownloadInput,
} from '../../shared/ipc-types'

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
  ipcRenderer: {
    invoke: mocks.invoke,
    on: mocks.on,
    removeListener: mocks.removeListener,
    send: mocks.send,
  },
}))

import '../index'

type ExposedApi = DownloadApi & CacheApi & CatalogApi & DiscoveryApi & BookshelfApi & {
  autoGetCookie: (operationId: string) => Promise<unknown>
  getLogStats: () => Promise<unknown>
  getVolumeCovers: (bookId: string, volumes: string[]) => Promise<unknown>
  getBook: (bookId: string, options?: { revalidate?: boolean }) => Promise<unknown>
}

const exposedApi = (
  mocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'electronAPI')?.[1]
) as ExposedApi

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.on.mockReset()
  mocks.removeListener.mockReset()
})

describe('preload download boundary', () => {
  it('forwards the login operation ID', async () => {
    const result = { status: 'ok', message: '登录成功' }
    mocks.invoke.mockResolvedValue(result)

    await expect(exposedApi.autoGetCookie('login-1720000000000-3')).resolves.toBe(result)
    expect(mocks.invoke).toHaveBeenCalledWith('cookie:auto', {
      operationId: 'login-1720000000000-3',
    })
  })

  it('forwards snapshot and enqueue commands', async () => {
    const result = { revision: 1, tasks: [], legacyImportCompleted: false }
    mocks.invoke.mockResolvedValue(result)
    const input: EnqueueDownloadInput = {
      bookId: '3057',
      title: '测试作品',
      type: 'epub_volume',
      volume: '第一卷',
    }

    await expect(exposedApi.getDownloadSnapshot()).resolves.toBe(result)
    await expect(exposedApi.enqueueDownload(input)).resolves.toBe(result)
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'download:get-snapshot')
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'download:enqueue', input)
  })

  it('forwards atomic batch commands through fixed channels', async () => {
    const inputs: EnqueueDownloadInput[] = [{
      bookId: '3057', title: '测试作品', type: 'epub_volume', volume: '第一卷',
    }]
    const batchId = '550e8400-e29b-41d4-a716-446655440000'

    await exposedApi.enqueueDownloadBatch(inputs)
    await exposedApi.cancelDownloadBatch(batchId)
    await exposedApi.retryDownloadBatch(batchId)

    expect(mocks.invoke.mock.calls).toEqual([
      ['download:enqueue-batch', { inputs }],
      ['download:cancel-batch', { batchId }],
      ['download:retry-batch', { batchId }],
    ])
  })

  it('requests log statistics through the fixed channel', async () => {
    const result = { totalSizeBytes: 2048 }
    mocks.invoke.mockResolvedValue(result)

    await expect(exposedApi.getLogStats()).resolves.toBe(result)
    expect(mocks.invoke).toHaveBeenCalledWith('logs:get-stats')
  })

  it('requests selected volume covers through the fixed channel', async () => {
    const result = { covers: { '第一卷': 'https://example.com/1.jpg' } }
    mocks.invoke.mockResolvedValue(result)

    await expect(exposedApi.getVolumeCovers('3057', ['第一卷'])).resolves.toBe(result)
    expect(mocks.invoke).toHaveBeenCalledWith('book:volume-covers', {
      bookId: '3057',
      volumes: ['第一卷'],
    })
  })

  it('uses fixed channels for revalidation and full cache clearing', async () => {
    mocks.invoke.mockResolvedValue({ deferred: false })

    await exposedApi.getBook('3057', { revalidate: true })
    await expect(exposedApi.clearCache()).resolves.toEqual({ deferred: false })

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'book:get', {
      bookId: '3057',
      revalidate: true,
    })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'cache:clear')
  })

  it('uses fixed discovery channels and bounded payloads', async () => {
    mocks.invoke.mockResolvedValue({ sections: [], fetchedAt: 1, stale: false })

    await exposedApi.getDiscoveryHome(true)
    await exposedApi.getRanking('dayvisit', 2, false)

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'discovery:get-home', { refresh: true })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'discovery:get-ranking', {
      type: 'dayvisit',
      page: 2,
      refresh: false,
    })
  })

  it('uses the fixed readonly bookshelf channel', async () => {
    mocks.invoke.mockResolvedValue({ entries: [], fetchedAt: 1, stale: false })

    await exposedApi.getBookshelf(true)

    expect(mocks.invoke).toHaveBeenCalledWith('bookshelf:get', { refresh: true })
  })

  it('uses the fixed catalog channel and a typed query payload', async () => {
    const query = {
      tag: '校园' as const,
      status: 'all' as const,
      animation: 'all' as const,
      sort: 'lastupdate' as const,
      page: 2,
    }
    mocks.invoke.mockResolvedValue({ query, books: [], page: 2, totalPages: 3 })

    await exposedApi.getCatalog(query, true)

    expect(mocks.invoke).toHaveBeenCalledWith('catalog:get', { query, refresh: true })
  })

  it('forwards task and history mutation payloads', async () => {
    mocks.invoke.mockResolvedValue({ revision: 1, tasks: [], legacyImportCompleted: true })
    const taskId = 'dl-1720000000000-3'

    await exposedApi.cancelDownload(taskId)
    await exposedApi.retryDownload(taskId)
    await exposedApi.removeDownload(taskId)
    await exposedApi.clearDownloadHistory('terminal')
    await exposedApi.importLegacyDownloadHistory([{ id: taskId }])
    await exposedApi.openDownloadArtifact(taskId, 'primary')
    await exposedApi.revealDownloadArtifact(taskId, 'primary')

    expect(mocks.invoke.mock.calls).toEqual([
      ['download:cancel', { taskId }],
      ['download:retry', { taskId }],
      ['download:remove', { taskId }],
      ['download:clear-history', { scope: 'terminal' }],
      ['download:import-legacy-history', { tasks: [{ id: taskId }] }],
      ['download:artifact-open', { taskId, artifactId: 'primary' }],
      ['download:artifact-reveal', { taskId, artifactId: 'primary' }],
    ])
  })

  it('removes exactly the download-state listener it registered', () => {
    const callback = vi.fn<(event: DownloadStateEvent) => void>()
    const cleanup = exposedApi.onDownloadStateChanged(callback)
    const listener = mocks.on.mock.calls[0]?.[1]

    const event = { snapshot: { revision: 1, tasks: [], legacyImportCompleted: true } }
    listener({}, event)
    expect(callback).toHaveBeenCalledWith(event)

    cleanup()
    expect(mocks.removeListener).toHaveBeenCalledWith('download:state-changed', listener)
  })
})
