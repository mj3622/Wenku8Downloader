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
  openDownloadArtifact: vi.fn(),
  revealDownloadArtifact: vi.fn(),
  useDownloadStore: vi.fn(),
}))

vi.mock('../stores/downloadStore', () => ({
  useDownloadStore: mocks.useDownloadStore,
}))

vi.mock('../api/client', () => ({
  api: {
    getConfig: mocks.getConfig,
    openFolder: mocks.openFolder,
    openDownloadArtifact: mocks.openDownloadArtifact,
    revealDownloadArtifact: mocks.revealDownloadArtifact,
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

  it('offers a direct path to search when download history is empty', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [],
      initialized: true,
      loading: false,
      error: undefined,
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    const searchLink = container.querySelector<HTMLAnchorElement>('a[href="#/search"]')
    expect(searchLink?.textContent).toContain('前往找书')
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

  it('opens exact artifacts and falls back when a saved target is unavailable', async () => {
    const actions = {
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    }
    mocks.useDownloadStore.mockReturnValue({
      tasks: [
        {
          id: 'dl-artifact-file',
          bookId: '3057',
          title: '测试 EPUB',
          type: 'epub_full',
          status: 'completed',
          progress: 100,
          createdAt: Date.now(),
          artifacts: [{
            id: 'primary',
            name: '3057_测试作品.epub',
            kind: 'file',
            available: true,
          }, {
            id: 'illustrations',
            name: '3057_测试作品插图',
            kind: 'directory',
            available: true,
          }],
        },
        {
          id: 'dl-artifact-missing',
          bookId: '3058',
          title: '测试插图',
          type: 'images',
          status: 'completed',
          progress: 100,
          createdAt: Date.now(),
          artifacts: [{
            id: 'primary',
            name: '3058_测试插图',
            kind: 'directory',
            available: false,
          }],
        },
      ],
      initialized: true,
      loading: false,
      error: undefined,
      ...actions,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))
    const open = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 3057_测试作品.epub"]',
    )
    const reveal = container.querySelector<HTMLButtonElement>(
      'button[aria-label="在文件夹中显示 3057_测试作品.epub"]',
    )
    await act(async () => {
      open?.click()
      reveal?.click()
    })

    expect(mocks.openDownloadArtifact).toHaveBeenCalledWith('dl-artifact-file', 'primary')
    expect(mocks.revealDownloadArtifact).toHaveBeenCalledWith('dl-artifact-file', 'primary')
    const openSecond = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 3057_测试作品插图"]',
    )
    await act(async () => openSecond?.click())
    expect(mocks.openDownloadArtifact).toHaveBeenCalledWith(
      'dl-artifact-file',
      'illustrations',
    )
    expect(container.textContent).toContain('文件已移动或删除')
    const fallback = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 测试插图 的下载目录"]',
    )
    await act(async () => fallback?.click())
    expect(mocks.openFolder).toHaveBeenCalledWith('pics')
  })

  it('places history clearing actions in the page header', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-header-actions',
        bookId: '3057',
        title: '测试作品',
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
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    const header = container.querySelector('header')
    const clearCompleted = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('清空已完成'))
    const clearHistory = [...container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('清空全部历史'))
    expect(header?.contains(clearCompleted ?? null)).toBe(true)
    expect(header?.contains(clearHistory ?? null)).toBe(true)
  })

  it('confirms bulk clearing and disables both actions while it is pending', async () => {
    let finishClearing!: () => void
    const clearCompleted = vi.fn(() => new Promise<void>((resolve) => {
      finishClearing = resolve
    }))
    const clearHistory = vi.fn().mockResolvedValue(undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'dl-confirm-clear',
        bookId: '3057',
        title: '测试作品',
        type: 'epub_full',
        status: 'completed',
        progress: 100,
        createdAt: Date.now(),
      }],
      initialized: true,
      loading: false,
      error: undefined,
      removeTask: vi.fn(),
      clearCompleted,
      clearHistory,
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))
    const findButton = (text: string) => [...container!.querySelectorAll('button')]
      .find((button) => button.textContent?.includes(text))

    await act(async () => findButton('清空已完成')?.click())
    expect(clearCompleted).not.toHaveBeenCalled()

    await act(async () => {
      findButton('清空已完成')?.click()
      await Promise.resolve()
    })
    expect(clearCompleted).toHaveBeenCalledOnce()
    expect(findButton('正在清空')?.disabled).toBe(true)
    expect(findButton('清空全部历史')?.disabled).toBe(true)

    await act(async () => finishClearing())
    expect(findButton('清空已完成')?.disabled).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('renders completed history in batches of one hundred', async () => {
    mocks.useDownloadStore.mockReturnValue({
      tasks: Array.from({ length: 150 }, (_, index) => ({
        id: `dl-completed-${index}`,
        bookId: String(index + 1),
        title: `测试作品 ${index + 1}`,
        type: 'epub_full' as const,
        status: 'completed' as const,
        progress: 100,
        createdAt: Date.now() - index,
      })),
      initialized: true,
      loading: false,
      error: undefined,
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    expect(container.querySelectorAll('button[title="删除记录"]')).toHaveLength(100)
    expect(container.textContent).toContain('已显示 100/150 项')

    const loadMore = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === '加载更多')
    await act(async () => loadMore?.click())

    expect(container.querySelectorAll('button[title="删除记录"]')).toHaveLength(150)
    expect(container.textContent).not.toContain('加载更多')
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
      'button[title="打开下载目录"]',
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
    expect(container.textContent).not.toContain('清空全部历史')
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

  it('groups completed batch tasks with equal-weight progress and collapsed details', async () => {
    const actions = {
      removeTask: vi.fn(),
      clearCompleted: vi.fn(),
      clearHistory: vi.fn(),
      retryTask: vi.fn(),
      cancelTask: vi.fn(),
      retryBatch: vi.fn(),
      cancelBatch: vi.fn(),
    }
    mocks.useDownloadStore.mockReturnValue({
      tasks: ['第一卷', '第二卷'].map((volume, index) => ({
        id: `batch-completed-${index}`,
        batchId: 'batch-completed',
        bookId: '3057',
        title: '批次测试作品',
        type: 'epub_volume' as const,
        volume,
        status: 'completed' as const,
        progress: 100,
        createdAt: 1000 + index,
        updatedAt: 2000 + index,
        artifacts: index === 0 ? [{
          id: 'primary', name: `${volume}.epub`, kind: 'file' as const, available: true,
        }] : [],
      })),
      initialized: true,
      loading: false,
      error: undefined,
      ...actions,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    expect(container.textContent).toContain('批次测试作品')
    expect(container.textContent).toContain('分卷 EPUB · 2 卷')
    expect(container.textContent).toContain('100%')
    expect(container.textContent).not.toContain('第一卷')

    const details = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('详情'))
    await act(async () => details?.click())
    expect(container.textContent).toContain('第一卷')
    expect(container.textContent).toContain('第二卷')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[aria-label="打开 第一卷.epub"]')?.click()
      container?.querySelector<HTMLButtonElement>('button[aria-label="在文件夹中显示 第一卷.epub"]')?.click()
      container?.querySelector<HTMLButtonElement>('button[aria-label="打开 第二卷 的下载目录"]')?.click()
    })
    expect(mocks.openDownloadArtifact).toHaveBeenCalledWith('batch-completed-0', 'primary')
    expect(mocks.revealDownloadArtifact).toHaveBeenCalledWith('batch-completed-0', 'primary')
    expect(mocks.openFolder).toHaveBeenCalledWith('novels')
  })

  it('auto-expands problem batches and preserves group and item controls', async () => {
    const cancelBatch = vi.fn()
    const retryBatch = vi.fn()
    const cancelTask = vi.fn()
    const retryTask = vi.fn()
    mocks.useDownloadStore.mockReturnValue({
      tasks: [{
        id: 'batch-failed', batchId: 'problem-batch', bookId: '3057', title: '问题批次',
        type: 'epub_volume', volume: '失败卷', status: 'failed', progress: 25,
        error: 'Error: IPC failed', createdAt: 1, updatedAt: 2, artifacts: [],
      }, {
        id: 'batch-active', batchId: 'problem-batch', bookId: '3057', title: '问题批次',
        type: 'epub_volume', volume: '下载卷', status: 'downloading', progress: 75,
        phase: '正在下载正文', createdAt: 1, updatedAt: 2, artifacts: [],
      }],
      initialized: true,
      loading: false,
      error: undefined,
      removeTask: vi.fn(), clearCompleted: vi.fn(), clearHistory: vi.fn(),
      retryTask, cancelTask, retryBatch, cancelBatch,
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    mountedRoot = createRoot(container)

    await act(async () => mountedRoot?.render(createElement(DownloadHistoryPage)))

    expect(container.textContent).toContain('50%')
    expect(container.textContent).toContain('已完成 0')
    expect(container.textContent).toContain('进行中 1')
    expect(container.textContent).toContain('失败 1')
    expect(container.textContent).toContain('失败卷')
    expect(container.textContent).toContain('下载未能完成，请检查网络和下载设置后重试。')
    expect(container.textContent).not.toContain('IPC')

    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[aria-label="取消 问题批次 下载批次"]')?.click()
      container?.querySelector<HTMLButtonElement>('button[aria-label="重试 问题批次 未完成下载"]')?.click()
      container?.querySelector<HTMLButtonElement>('button[aria-label="取消 下载卷 下载"]')?.click()
      container?.querySelector<HTMLButtonElement>('button[aria-label="重试 失败卷 下载"]')?.click()
    })
    expect(cancelBatch).toHaveBeenCalledWith('problem-batch')
    expect(retryBatch).toHaveBeenCalledWith('problem-batch')
    expect(cancelTask).toHaveBeenCalledWith('batch-active')
    expect(retryTask).toHaveBeenCalledWith('batch-failed')
  })
})
