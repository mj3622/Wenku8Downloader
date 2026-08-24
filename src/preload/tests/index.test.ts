import { beforeEach, describe, expect, it, vi } from 'vitest'

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

type ExposedApi = {
  autoGetCookie: (operationId: string) => Promise<unknown>
  downloadEpub: (bookId: string, volumeName?: string, taskId?: string) => Promise<unknown>
  downloadImages: (bookId: string, volumeName?: string, taskId?: string) => Promise<unknown>
}

const exposedApi = (
  mocks.exposeInMainWorld.mock.calls.find(([name]) => name === 'electronAPI')?.[1]
) as ExposedApi

beforeEach(() => {
  mocks.invoke.mockReset()
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

  it.each([
    ['downloadEpub', 'download:epub'],
    ['downloadImages', 'download:images'],
  ] as const)('forwards %s payloads and returns the structured result', async (method, channel) => {
    const result = {
      status: 'ok',
      message: '下载完成，但有部分内容缺失',
      warnings: ['封面未能下载'],
    }
    mocks.invoke.mockResolvedValue(result)

    await expect(exposedApi[method]('3057', '第一卷', 'dl-123-1')).resolves.toBe(result)
    expect(mocks.invoke).toHaveBeenCalledWith(channel, {
      bookId: '3057',
      volumeName: '第一卷',
      taskId: 'dl-123-1',
    })
  })
})
