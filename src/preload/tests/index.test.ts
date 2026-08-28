import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DownloadApi,
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

type ExposedApi = DownloadApi & {
  autoGetCookie: (operationId: string) => Promise<unknown>
  getLogStats: () => Promise<unknown>
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

  it('requests log statistics through the fixed channel', async () => {
    const result = { totalSizeBytes: 2048 }
    mocks.invoke.mockResolvedValue(result)

    await expect(exposedApi.getLogStats()).resolves.toBe(result)
    expect(mocks.invoke).toHaveBeenCalledWith('logs:get-stats')
  })

  it('forwards task and history mutation payloads', async () => {
    mocks.invoke.mockResolvedValue({ revision: 1, tasks: [], legacyImportCompleted: true })
    const taskId = 'dl-1720000000000-3'

    await exposedApi.cancelDownload(taskId)
    await exposedApi.retryDownload(taskId)
    await exposedApi.removeDownload(taskId)
    await exposedApi.clearDownloadHistory('terminal')
    await exposedApi.importLegacyDownloadHistory([{ id: taskId }])

    expect(mocks.invoke.mock.calls).toEqual([
      ['download:cancel', { taskId }],
      ['download:retry', { taskId }],
      ['download:remove', { taskId }],
      ['download:clear-history', { scope: 'terminal' }],
      ['download:import-legacy-history', { tasks: [{ id: taskId }] }],
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
