// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { OpenFolderTarget } from '../../../shared/ipc-types'
import { api } from '../api/client'

const mocks = vi.hoisted(() => ({
  openFolder: vi.fn(),
  useDownloadStore: vi.fn(),
}))

vi.mock('../stores/downloadStore', () => ({
  useDownloadStore: mocks.useDownloadStore,
}))

vi.mock('../api/client', () => ({
  api: { openFolder: mocks.openFolder },
}))

import DownloadHistoryPage from './DownloadHistoryPage'

let mountedRoot: Root | null = null
let container: HTMLDivElement | null = null
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot?.unmount())
  }
  container?.remove()
  mountedRoot = null
  container = null
  vi.clearAllMocks()
})

describe('DownloadHistoryPage', () => {
  it('keeps the renderer API folder target aligned with the IPC whitelist', () => {
    expectTypeOf(api.openFolder).toEqualTypeOf<
      (target: OpenFolderTarget) => Promise<void>
    >()
  })

  it('shows an IPC error after clicking the completed task folder button', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-1-1',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
      }],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
    })
    mocks.openFolder.mockRejectedValueOnce(new Error('目录不存在'))
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => {
      mountedRoot?.render(createElement(DownloadHistoryPage))
    })
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[title="打开所在文件夹"]',
    )
    expect(openButton).not.toBeNull()

    await act(async () => {
      openButton?.click()
      await Promise.resolve()
    })

    expect(mocks.openFolder).toHaveBeenCalledWith('novels')
    expect(container.textContent).toContain('目录不存在')
  })
})
