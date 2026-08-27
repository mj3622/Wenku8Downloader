import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DownloadSnapshot,
  DownloadStateEvent,
  DownloadTask,
} from '../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({
  enqueueDownload: vi.fn(),
  cancelDownload: vi.fn(),
  retryDownload: vi.fn(),
  removeDownload: vi.fn(),
  clearDownloadHistory: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: {
    enqueueDownload: mocks.enqueueDownload,
    cancelDownload: mocks.cancelDownload,
    retryDownload: mocks.retryDownload,
    removeDownload: mocks.removeDownload,
    clearDownloadHistory: mocks.clearDownloadHistory,
  },
}))

import { useDownloadStore } from './downloadStore'
import { useToastStore } from './toastStore'

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    bookId: '100',
    title: '测试作品',
    type: 'epub_full',
    status: 'pending',
    progress: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

function snapshot(
  revision: number,
  tasks: DownloadTask[] = [],
  overrides: Partial<DownloadSnapshot> = {},
): DownloadSnapshot {
  return {
    revision,
    tasks,
    legacyImportCompleted: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useToastStore.getState().clear()
  useDownloadStore.setState({
    tasks: [],
    revision: -1,
    initialized: false,
    loading: true,
    error: undefined,
    storageWarning: undefined,
    lastTransitionRevision: -1,
  })
})

describe('downloadStore projection', () => {
  it('ignores an out-of-order snapshot revision', () => {
    const newerTask = task({ title: '新状态' })
    const olderTask = task({ title: '旧状态' })

    useDownloadStore.getState().applySnapshot(snapshot(4, [newerTask]))
    useDownloadStore.getState().applySnapshot(snapshot(3, [olderTask]))

    expect(useDownloadStore.getState().tasks).toEqual([newerTask])
  })

  it('does not emit terminal toasts for initial snapshots', () => {
    useDownloadStore.getState().applySnapshot(snapshot(1, [
      task({ status: 'completed', progress: 100 }),
      task({ id: '123e4567-e89b-42d3-a456-426614174001', status: 'failed' }),
    ]))

    expect(useToastStore.getState().items).toEqual([])
  })

  it('emits one toast for a live completion transition', () => {
    useDownloadStore.getState().applySnapshot(snapshot(1, [task({ status: 'downloading' })]))
    const event: DownloadStateEvent = {
      snapshot: snapshot(2, [task({ status: 'completed', progress: 100 })]),
      transition: {
        taskId: '123e4567-e89b-42d3-a456-426614174000',
        from: 'downloading',
        to: 'completed',
      },
    }

    useDownloadStore.getState().applyEvent(event)
    useDownloadStore.getState().applyEvent(event)

    expect(useToastStore.getState().items).toHaveLength(1)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'success',
      title: '下载完成',
    })
  })

  it('confirms a task was added when a live pending transition arrives', () => {
    useDownloadStore.getState().applySnapshot(snapshot(1))
    useDownloadStore.getState().applyEvent({
      snapshot: snapshot(2, [task()]),
      transition: {
        taskId: '123e4567-e89b-42d3-a456-426614174000',
        to: 'pending',
      },
    })

    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'info',
      title: '已加入下载队列',
    })
  })

  it('applies a same-revision transition once when its command snapshot arrived first', () => {
    const completedTask = task({ status: 'completed', progress: 100 })
    const event: DownloadStateEvent = {
      snapshot: snapshot(2, [completedTask]),
      transition: {
        taskId: completedTask.id,
        from: 'downloading',
        to: 'completed',
      },
    }
    useDownloadStore.getState().applySnapshot(event.snapshot)

    useDownloadStore.getState().applyEvent(event)
    useDownloadStore.getState().applyEvent(event)

    expect(useToastStore.getState().items).toHaveLength(1)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'success',
      title: '下载完成',
    })
  })

  it('shows a storage warning only when it changes', () => {
    useDownloadStore.getState().applySnapshot(snapshot(1, [], { storageWarning: '状态保存失败' }))
    useDownloadStore.getState().applySnapshot(snapshot(1, [], { storageWarning: '状态保存失败' }))
    useDownloadStore.getState().applySnapshot(snapshot(1, [], { storageWarning: '仍然无法保存' }))

    expect(useToastStore.getState().items).toHaveLength(2)
    expect(useToastStore.getState().items[0].tone).toBe('warning')
  })

  it('keeps synchronized tasks visible when legacy migration later fails', () => {
    const currentTask = task({ status: 'completed', progress: 100 })
    useDownloadStore.getState().applySnapshot(snapshot(1, [currentTask]))

    useDownloadStore.getState().setInitializationError(new Error('旧下载历史无法读取'))

    expect(useDownloadStore.getState().tasks).toEqual([currentTask])
    expect(useDownloadStore.getState().error).toBeUndefined()
    expect(useToastStore.getState().items[0]).toMatchObject({ tone: 'error' })
  })
})

describe('downloadStore commands', () => {
  it('enqueues EPUB and image tasks with the correct type', async () => {
    mocks.enqueueDownload.mockResolvedValue(snapshot(1))

    useDownloadStore.getState().downloadEpub('100', '测试作品', undefined, '第一卷')
    useDownloadStore.getState().downloadImages('100', '测试作品')

    await vi.waitFor(() => expect(mocks.enqueueDownload).toHaveBeenCalledTimes(2))
    expect(mocks.enqueueDownload).toHaveBeenNthCalledWith(1, {
      bookId: '100',
      title: '测试作品',
      type: 'epub_volume',
      volume: '第一卷',
    })
    expect(mocks.enqueueDownload).toHaveBeenNthCalledWith(2, {
      bookId: '100',
      title: '测试作品',
      type: 'images',
    })
  })

  it('forwards task and history commands', async () => {
    const response = snapshot(2)
    mocks.cancelDownload.mockResolvedValue(response)
    mocks.retryDownload.mockResolvedValue(response)
    mocks.removeDownload.mockResolvedValue(response)
    mocks.clearDownloadHistory.mockResolvedValue(response)

    const store = useDownloadStore.getState()
    store.cancelTask('task-1')
    store.retryTask('task-2')
    store.removeTask('task-3')
    store.clearCompleted()
    store.clearHistory()

    await vi.waitFor(() => expect(mocks.clearDownloadHistory).toHaveBeenCalledTimes(2))
    expect(mocks.cancelDownload).toHaveBeenCalledWith('task-1')
    expect(mocks.retryDownload).toHaveBeenCalledWith('task-2')
    expect(mocks.removeDownload).toHaveBeenCalledWith('task-3')
    expect(mocks.clearDownloadHistory.mock.calls).toEqual([['completed'], ['terminal']])
  })

  it('surfaces rejected commands without mutating task state', async () => {
    useDownloadStore.getState().applySnapshot(snapshot(1, [task()]))
    mocks.cancelDownload.mockRejectedValue(
      new Error("Error invoking remote method 'download:cancel': internal"),
    )

    useDownloadStore.getState().cancelTask('123e4567-e89b-42d3-a456-426614174000')

    await vi.waitFor(() => expect(useToastStore.getState().items).toHaveLength(1))
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'error',
      title: '下载失败',
    })
    expect(useDownloadStore.getState().tasks[0].status).toBe('pending')
  })
})
