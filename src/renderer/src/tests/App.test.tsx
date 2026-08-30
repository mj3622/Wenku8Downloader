// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { useBookshelfUpdateStore } from '../stores/bookshelfUpdateStore'
import { useToastStore } from '../stores/toastStore'

const mocks = {
  getConfig: vi.fn(),
  getBookshelf: vi.fn(),
}

let container: HTMLDivElement
let root: Root
const originalElectronApi = window.electronAPI
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})

beforeEach(() => {
  vi.clearAllMocks()
  useBookshelfUpdateStore.getState().clear()
  useToastStore.getState().clear()
  mocks.getConfig.mockResolvedValue({ account: { hasCookies: false } })
  mocks.getBookshelf.mockResolvedValue({ entries: [], fetchedAt: 1, stale: false })
  window.location.hash = '#/missing-page'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      getDownloadSnapshot: async () => ({
        revision: 0,
        tasks: [],
        legacyImportCompleted: true,
      }),
      importLegacyDownloadHistory: async () => ({
        revision: 1,
        tasks: [],
        legacyImportCompleted: true,
      }),
      onDownloadStateChanged: () => () => undefined,
      getAppInfo: async () => ({ version: '2.2.0' }),
      getConfig: mocks.getConfig,
      getBookshelf: mocks.getBookshelf,
      getDiscoveryHome: async () => ({
        sections: [],
        fetchedAt: Date.now(),
        stale: false,
      }),
    } as unknown as Window['electronAPI'],
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.location.hash = ''
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: originalElectronApi,
  })
})

describe('App routing', () => {
  it('shows a recoverable page instead of a blank screen for unknown routes', async () => {
    await act(async () => root.render(<App />))

    expect(container.textContent).toContain('轻小说文库下载器')
    expect(container.textContent).toContain('页面不存在')
    expect(container.querySelector('a[href="#/discover"]')?.textContent).toContain('发现')
    expect(container.textContent).toContain('返回发现')
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('uses discovery as the default renderer route', async () => {
    window.location.hash = '#/'

    await act(async () => root.render(<App />))

    expect(window.location.hash).toBe('#/discover')
    expect(container.querySelector('h1')?.textContent).toBe('发现')
  })

  it('keeps project information available after the primary navigation', async () => {
    window.location.hash = '#/about'

    await act(async () => root.render(<App />))

    const labels = [...container.querySelectorAll('aside nav a')]
      .map(link => link.textContent?.trim())
    expect(labels).toEqual(['发现', '找书', '书架', '下载', '配置', '项目介绍'])
    expect(container.querySelector('a[href="#/about"]')).not.toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('轻小说文库下载器')
  })

  it('shows a quiet accessible indicator when the automatic bookshelf check finds updates', async () => {
    window.location.hash = '#/about'
    mocks.getConfig.mockResolvedValue({ account: { hasCookies: true } })
    mocks.getBookshelf.mockResolvedValue({
      entries: [{
        bookId: '101',
        title: '星海图书馆',
        author: '林间笔记',
        latestChapter: '第十二章',
        bookmark: null,
        updatedAt: '2026-08-30',
        localState: 'update',
        updateAvailable: true,
      }],
      fetchedAt: 1,
      stale: false,
    })

    await act(async () => root.render(<App />))
    await vi.waitFor(() => {
      expect(container.querySelector('[data-bookshelf-update-indicator]')).not.toBeNull()
    })

    const bookshelfLink = container.querySelector('a[href="#/bookshelf"]')
    expect(bookshelfLink?.textContent).toContain('1 部作品有更新')
    expect(useToastStore.getState().items).toEqual([
      expect.objectContaining({ tone: 'info', title: '书架发现更新' }),
    ])
  })

  it('schedules low-frequency bookshelf checks while the application is running', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')
    try {
      await act(async () => root.render(<App />))

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 6 * 60 * 60 * 1_000)
    } finally {
      setIntervalSpy.mockRestore()
    }
  })
})
