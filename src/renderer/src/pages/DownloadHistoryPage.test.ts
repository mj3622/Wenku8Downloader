// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { PublicConfigSnapshot, TitleFormat } from '../../../shared/config-types'
import type { OpenFolderTarget } from '../../../shared/ipc-types'
import { api } from '../api/client'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  openFolder: vi.fn(),
  useDownloadStore: vi.fn(),
}))

vi.mock('../stores/downloadStore', () => ({
  useDownloadStore: mocks.useDownloadStore,
}))

vi.mock('../api/client', () => ({
  api: {
    getConfig: mocks.getConfig,
    openFolder: mocks.openFolder,
  },
}))

import DownloadHistoryPage from './DownloadHistoryPage'
import { useConfigStore } from '../stores/configStore'
import { useToastStore } from '../stores/toastStore'

let mountedRoot: Root | null = null
let container: HTMLDivElement | null = null
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

function configSnapshot(fullTitle: TitleFormat): PublicConfigSnapshot {
  return {
    download: { fullTitle, defaultCoverIndex: 0, downloadPath: '' },
    logging: { retentionDays: 30, maxFileSizeMb: 100, maxTotalSizeMb: 200 },
    account: { username: '', hasPassword: false, hasCookies: false },
    health: { state: 'ok' },
  }
}

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
})

beforeEach(() => {
  useToastStore.getState().clear()
  useConfigStore.setState({
    snapshot: configSnapshot('FULL'),
    loadState: 'ready',
    error: null,
  })
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

  it('distinguishes loading and initialization failures from an empty history', async () => {
    const actions = {
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    }
    mocks.useDownloadStore.mockReturnValue({
      tasks: [],
      initialized: false,
      loading: true,
      error: undefined,
      ...actions,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))
    expect(container.textContent).toContain('正在同步下载记录')
    expect(container.textContent).not.toContain('暂无下载记录')

    mocks.useDownloadStore.mockReturnValue({
      tasks: [],
      initialized: true,
      loading: false,
      error: '下载记录暂时无法读取，请稍后重试。',
      ...actions,
    })
    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))
    expect(container.textContent).toContain('下载记录暂时无法读取，请稍后重试。')
    expect(container.textContent).not.toContain('暂无下载记录')
  })

  it('formats existing task titles with the current download setting', async () => {
    const actions = {
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    }
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-title-format',
        bookId: '3057',
        title: '败北女角太多了！(败犬女主太多了！)',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
      }],
      initialized: true,
      loading: false,
      error: undefined,
      ...actions,
    })
    useConfigStore.setState({ snapshot: configSnapshot('IN') })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))
    expect(container.textContent).toContain('败犬女主太多了！')
    expect(container.textContent).not.toContain('败北女角太多了！')

    await act(async () => {
      useConfigStore.setState({ snapshot: configSnapshot('OUT') })
    })
    expect(container.textContent).toContain('败北女角太多了！')
    expect(container.textContent).not.toContain('败犬女主太多了！')
  })

  it('loads the title format when download history is opened directly', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-cold-start',
        bookId: '3057',
        title: '败北女角太多了！(败犬女主太多了！)',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
      }],
      initialized: true,
      loading: false,
      error: undefined,
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    mocks.getConfig.mockResolvedValueOnce(configSnapshot('IN'))
    useConfigStore.setState({ snapshot: null, loadState: 'idle', error: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    await vi.waitFor(() => expect(container?.textContent).toContain('败犬女主太多了！'))
    expect(container.textContent).not.toContain('败北女角太多了！')
  })

  it('keeps the full title when the download setting cannot be loaded', async () => {
    const fullTitle = '败北女角太多了！(败犬女主太多了！)'
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-config-error',
        bookId: '3057',
        title: fullTitle,
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
      }],
      initialized: true,
      loading: false,
      error: undefined,
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    mocks.getConfig.mockRejectedValueOnce(new Error('配置暂时不可用'))
    useConfigStore.setState({ snapshot: null, loadState: 'idle', error: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    await vi.waitFor(() => expect(useConfigStore.getState().loadState).toBe('error'))
    expect(container.textContent).toContain(fullTitle)
  })

  it('shows a friendly toast after a completed task folder cannot be opened', async () => {
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
      cancelTask: vi.fn(),
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
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'error',
      title: '无法打开文件夹',
      message: '目录不存在',
    })
  })

  it('shows partial-success warnings on completed tasks', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-warning',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        warning: '封面未能下载，正文已正常保存。',
        createdAt: Date.now(),
      }],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => {
      mountedRoot?.render(createElement(DownloadHistoryPage))
    })

    expect(container.textContent).toContain('封面未能下载，正文已正常保存。')
  })

  it('never renders technical details from a failed task', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-failed',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'failed',
        progress: 0,
        error: 'Error: IPC failed at C:\\Users\\tester',
        createdAt: Date.now(),
      }],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => {
      mountedRoot?.render(createElement(DownloadHistoryPage))
    })

    expect(container.textContent).toContain('下载未能完成，请检查网络和下载设置后重试。')
    expect(container.textContent).not.toContain('IPC')
    expect(container.textContent).not.toContain('C:\\Users')
  })

  it('allows active tasks to be cancelled and disables repeated cancellation', async () => {
    const cancelTask = vi.fn()
    mocks.useDownloadStore.mockReturnValue({
      tasks: [
        {
          id: 'pending-task',
          bookId: '1',
          title: '等待作品',
          type: 'epub_full',
          status: 'pending',
          progress: 0,
          createdAt: Date.now(),
        },
        {
          id: 'downloading-task',
          bookId: '2',
          title: '下载作品',
          type: 'images',
          status: 'downloading',
          progress: 30,
          createdAt: Date.now(),
        },
        {
          id: 'cancelling-task',
          bookId: '3',
          title: '取消作品',
          type: 'images',
          status: 'cancelling',
          progress: 40,
          createdAt: Date.now(),
        },
      ],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))
    const pendingCancel = container.querySelector<HTMLButtonElement>(
      'button[aria-label="取消 等待作品 下载"]',
    )
    const downloadingCancel = container.querySelector<HTMLButtonElement>(
      'button[aria-label="取消 下载作品 下载"]',
    )
    const cancelling = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('正在取消'))

    expect(pendingCancel?.disabled).toBe(false)
    expect(downloadingCancel?.disabled).toBe(false)
    expect(cancelling?.hasAttribute('disabled')).toBe(true)
    await act(async () => pendingCancel?.click())
    expect(cancelTask).toHaveBeenCalledWith('pending-task')
  })

  it('shows cancelled and interrupted tasks as distinctly labelled retryable records', async () => {
    const retryTask = vi.fn()
    mocks.useDownloadStore.mockReturnValue({
      tasks: [
        {
          id: 'cancelled-task',
          bookId: '1',
          title: '已取消作品',
          type: 'epub_full',
          status: 'cancelled',
          progress: 10,
          createdAt: Date.now(),
        },
        {
          id: 'interrupted-task',
          bookId: '2',
          title: '已中断作品',
          type: 'images',
          status: 'interrupted',
          progress: 30,
          createdAt: Date.now(),
        },
      ],
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask,
      cancelTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    expect(container.textContent).toContain('已取消')
    expect(container.textContent).toContain('已中断')
    const retryButtons = [...container.querySelectorAll('button')]
      .filter((button) => button.textContent === '重试')
    expect(retryButtons).toHaveLength(2)
    await act(async () => retryButtons[1].click())
    expect(retryTask).toHaveBeenCalledWith('interrupted-task')
  })
})
