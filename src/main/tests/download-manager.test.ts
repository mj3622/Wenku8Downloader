import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { realpathSync } from 'fs'
import { resolve } from 'path'
import type {
  DownloadSnapshot,
  DownloadTask,
  EnqueueDownloadInput,
} from '../../shared/ipc-types'
import { ACTIVE_DOWNLOAD_STATUSES } from '../../shared/ipc-types'

const logMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('../logging/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logMocks.error,
  },
}))

import { DownloadCancelledError } from '../download-cancellation'
import type {
  DownloadExecutionContext,
  DownloadExecutionResult,
  DownloadExecutionTask,
} from '../download-executor'
import { DownloadManager } from '../download-manager'
import type { PersistedDownloadState } from '../download-task-store'
import type { PersistedDownloadTask } from '../download-task-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function input(overrides: Partial<EnqueueDownloadInput> = {}): EnqueueDownloadInput {
  return {
    bookId: '100',
    title: '测试作品',
    type: 'epub_full',
    ...overrides,
  }
}

function storedTask(overrides: Partial<PersistedDownloadTask> = {}): PersistedDownloadTask {
  return {
    id: 'dl-1720000000000-1',
    bookId: '100',
    title: '测试作品',
    type: 'epub_full',
    status: 'completed',
    progress: 100,
    phase: '下载完成',
    createdAt: 1000,
    updatedAt: 2000,
    artifacts: [],
    downloadRoot: '/downloads',
    ...overrides,
  }
}

function setup(initial: PersistedDownloadState = {
  revision: 0,
  tasks: [],
  legacyImportCompleted: false,
}, options: { getDownloadRoot?: () => string } = {}) {
  const saved: PersistedDownloadState[] = []
  const store = {
    load: vi.fn(() => structuredClone(initial)),
    save: vi.fn((state: PersistedDownloadState) => {
      saved.push(structuredClone(state))
    }),
  }
  const executor = { execute: vi.fn<(
    task: DownloadExecutionTask,
    context: DownloadExecutionContext,
  ) => Promise<DownloadExecutionResult>>() }
  let nextId = 1
  let now = 10_000
  const manager = new DownloadManager({
    store,
    executor,
    ...options,
    createId: () => `123e4567-e89b-42d3-a456-42661417400${nextId++}`,
    now: () => now++,
  })
  manager.initialize()
  return { manager, store, executor, saved }
}

function completedExecution(): DownloadExecutionResult {
  return { warnings: [], artifacts: [] }
}

function taskByBook(snapshot: DownloadSnapshot, bookId: string): DownloadTask {
  const task = snapshot.tasks.find((item) => item.bookId === bookId)
  if (!task) throw new Error(`Missing task for ${bookId}`)
  return task
}

beforeEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DownloadManager scheduling', () => {
  it('persists pending before starting the executor', () => {
    const { manager, store, executor } = setup()
    executor.execute.mockReturnValue(new Promise(() => undefined))

    manager.enqueue(input())

    expect(store.save.mock.calls[1]?.[0].tasks[0].status).toBe('pending')
    expect(store.save.mock.calls[2]?.[0].tasks[0].status).toBe('downloading')
    expect(store.save.mock.invocationCallOrder[1])
      .toBeLessThan(executor.execute.mock.invocationCallOrder[0])
  })

  it('captures the configured download root when a task is created', () => {
    let downloadRoot = '/downloads/first'
    const { manager, executor, saved } = setup(undefined, {
      getDownloadRoot: () => downloadRoot,
    })
    executor.execute.mockReturnValue(new Promise(() => undefined))

    manager.enqueue(input())
    downloadRoot = '/downloads/second'

    expect(executor.execute.mock.calls[0][0].downloadRoot).toBe('/downloads/first')
    expect(saved[1].tasks[0].downloadRoot).toBe('/downloads/first')
    expect(manager.getSnapshot().tasks[0]).not.toHaveProperty('downloadRoot')
  })

  it('returns the active task instead of enqueueing an exact duplicate', () => {
    const { manager, executor } = setup()
    executor.execute.mockReturnValue(new Promise(() => undefined))

    const first = manager.enqueue(input({ type: 'images', volume: ' 第一卷 ' }))
    const duplicate = manager.enqueue(input({ type: 'images', volume: '第一卷' }))

    expect(first.status).toBe('enqueued')
    expect(duplicate).toMatchObject({
      status: 'duplicate',
      taskId: first.taskId,
    })
    expect(duplicate.snapshot.tasks).toHaveLength(1)
    expect(executor.execute).toHaveBeenCalledTimes(1)
  })

  it('does not confuse different volumes or download types', () => {
    const { manager, executor } = setup()
    executor.execute.mockReturnValue(new Promise(() => undefined))

    const firstVolume = manager.enqueue(input({ type: 'images', volume: '第一卷' }))
    const secondVolume = manager.enqueue(input({ type: 'images', volume: '第二卷' }))
    const epub = manager.enqueue(input({ type: 'epub_volume', volume: '第一卷' }))

    expect([firstVolume.status, secondVolume.status, epub.status])
      .toEqual(['enqueued', 'enqueued', 'enqueued'])
    expect(manager.getSnapshot().tasks).toHaveLength(3)
  })

  it('executes queued tasks strictly in FIFO order', async () => {
    const first = deferred<DownloadExecutionResult>()
    const second = deferred<DownloadExecutionResult>()
    const { manager, executor } = setup()
    executor.execute
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    manager.enqueue(input({ bookId: '100' }))
    manager.enqueue(input({ bookId: '200' }))
    expect(executor.execute).toHaveBeenCalledTimes(1)
    expect(executor.execute.mock.calls[0][0].bookId).toBe('100')

    first.resolve(completedExecution())
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledTimes(2))
    expect(executor.execute.mock.calls[1][0].bookId).toBe('200')

    second.resolve(completedExecution())
    await vi.waitFor(() => expect(manager.hasActiveTasks()).toBe(false))
  })

  it('publishes cloned snapshots with increasing revisions', () => {
    const { manager, executor } = setup()
    executor.execute.mockReturnValue(new Promise(() => undefined))
    const revisions: number[] = []
    const unsubscribe = manager.subscribe((event) => revisions.push(event.snapshot.revision))

    const first = manager.enqueue(input())
    expect(() => { first.snapshot.tasks[0].title = 'mutated' }).toThrow()
    unsubscribe()

    expect(revisions.length).toBeGreaterThanOrEqual(2)
    expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1]))
      .toBe(true)
    expect(manager.getSnapshot().tasks[0].title).toBe('测试作品')
  })

  it('coalesces frequent progress snapshot publications', async () => {
    vi.useFakeTimers()
    const execution = deferred<DownloadExecutionResult>()
    const { manager, executor } = setup()
    let context: DownloadExecutionContext | undefined
    executor.execute.mockImplementation((_task, value) => {
      context = value
      return execution.promise
    })
    const listener = vi.fn()
    manager.subscribe(listener)
    manager.enqueue(input())
    listener.mockClear()

    context?.onProgress({ current: 1, total: 10, phase: '下载中' })
    context?.onProgress({ current: 2, total: 10, phase: '下载中' })

    expect(listener).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].snapshot.tasks[0]).toMatchObject({
      progress: 20,
      phase: '下载中',
    })

    execution.resolve(completedExecution())
    await vi.runAllTimersAsync()
  })

  it('persists an active task cover as task metadata immediately', () => {
    const execution = deferred<DownloadExecutionResult>()
    const { manager, executor, saved } = setup()
    let context: DownloadExecutionContext | undefined
    executor.execute.mockImplementation((_task, value) => {
      context = value
      return execution.promise
    })
    manager.enqueue(input({
      type: 'epub_volume',
      volume: '第九卷',
      cover: 'https://example.com/book-cover.jpg',
    }))

    context?.onVolumeCover?.('https://example.com/volume-9-cover.jpg')

    expect(manager.getSnapshot().tasks[0].cover)
      .toBe('https://example.com/volume-9-cover.jpg')
    expect(saved.at(-1)?.tasks[0].cover)
      .toBe('https://example.com/volume-9-cover.jpg')
  })

  it('cancels a queued task without executing it', async () => {
    const first = deferred<DownloadExecutionResult>()
    const { manager, executor } = setup()
    executor.execute.mockImplementation(() => first.promise)
    manager.enqueue(input({ bookId: '100' }))
    const second = manager.enqueue(input({ bookId: '200' })).snapshot.tasks.find((task) => task.bookId === '200')!

    manager.cancel(second.id)
    first.resolve(completedExecution())
    await vi.waitFor(() => expect(manager.hasActiveTasks()).toBe(false))

    expect(executor.execute).toHaveBeenCalledTimes(1)
    expect(taskByBook(manager.getSnapshot(), '200').status).toBe('cancelled')
  })

  it('aborts a running task and reaches cancelled', async () => {
    const { manager, executor } = setup()
    let receivedSignal: AbortSignal | undefined
    executor.execute.mockImplementation((_task, context) => {
      receivedSignal = context.signal
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new DownloadCancelledError()), { once: true })
      })
    })
    const id = manager.enqueue(input()).snapshot.tasks[0].id

    expect(manager.cancel(id).tasks[0].status).toBe('cancelling')
    expect(receivedSignal?.aborted).toBe(true)
    await vi.waitFor(() => expect(manager.getSnapshot().tasks[0].status).toBe('cancelled'))
  })

  it('treats a native rejection after its abort signal as cancelled', async () => {
    const { manager, executor } = setup()
    executor.execute.mockImplementation((_task, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener(
        'abort',
        () => reject(new DOMException('aborted', 'AbortError')),
        { once: true },
      )
    }))
    const id = manager.enqueue(input()).snapshot.tasks[0].id

    manager.cancel(id)

    await vi.waitFor(() => expect(manager.getSnapshot().tasks[0].status).toBe('cancelled'))
  })

  it('keeps a real execution failure when it races with cancellation', async () => {
    const { manager, executor } = setup()
    executor.execute.mockImplementation((_task, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener(
        'abort',
        () => reject(new Error('ENOSPC: no space left on device')),
        { once: true },
      )
    }))
    const id = manager.enqueue(input()).snapshot.tasks[0].id

    manager.cancel(id)

    await vi.waitFor(() => expect(manager.getSnapshot().tasks[0]).toMatchObject({
      status: 'failed',
      error: '请清理磁盘空间或更换下载目录后重试。',
    }))
  })

  it('keeps the cancelling phase when late progress arrives', () => {
    const execution = deferred<DownloadExecutionResult>()
    const { manager, executor } = setup()
    let context: DownloadExecutionContext | undefined
    executor.execute.mockImplementation((_task, value) => {
      context = value
      return execution.promise
    })
    const id = manager.enqueue(input()).snapshot.tasks[0].id

    manager.cancel(id)
    context?.onProgress({ current: 5, total: 10, phase: '正在下载正文' })

    expect(manager.getSnapshot().tasks[0]).toMatchObject({
      status: 'cancelling',
      progress: 50,
      phase: '正在取消...',
    })
  })

  it('preserves completed when execution resolves during a cancel race', async () => {
    const execution = deferred<DownloadExecutionResult>()
    const { manager, executor } = setup()
    executor.execute.mockReturnValue(execution.promise)
    const id = manager.enqueue(input()).snapshot.tasks[0].id

    manager.cancel(id)
    execution.resolve(completedExecution())

    await vi.waitFor(() => expect(manager.getSnapshot().tasks[0].status).toBe('completed'))
  })

  it('persists private artifact paths but only publishes public summaries', async () => {
    const execution = deferred<DownloadExecutionResult>()
    const { manager, executor, saved } = setup()
    executor.execute.mockReturnValue(execution.promise)
    manager.enqueue(input())

    execution.resolve({
      warnings: [],
      artifacts: [{
        id: 'primary',
        name: 'book.epub',
        kind: 'file',
        path: '/downloads/novels/book.epub',
        rootPath: '/downloads',
      }],
    })

    await vi.waitFor(() => expect(manager.getSnapshot().tasks[0].status).toBe('completed'))
    expect(saved.at(-1)?.tasks[0].artifacts[0]).toMatchObject({
      path: '/downloads/novels/book.epub',
      rootPath: '/downloads',
    })
    const artifact = manager.getSnapshot().tasks[0].artifacts[0]
    expect(artifact).toEqual({
      id: 'primary',
      name: 'book.epub',
      kind: 'file',
      available: false,
    })
    expect(artifact).not.toHaveProperty('path')
    expect(artifact).not.toHaveProperty('rootPath')
    expect(JSON.stringify(manager.getSnapshot())).not.toContain('/downloads')
  })
})

describe('DownloadManager recovery and persistence', () => {
  it('resolves artifacts only through their owning completed task', async () => {
    const rootPath = realpathSync(process.cwd())
    const path = resolve(rootPath, 'package.json')
    const completed = storedTask({
      artifacts: [{
        id: 'primary',
        name: 'package.json',
        kind: 'file',
        path,
        rootPath,
      }],
      downloadRoot: rootPath,
    })
    const other = storedTask({
      id: 'dl-1720000000000-2',
      artifacts: [{
        id: 'secondary',
        name: 'package.json',
        kind: 'file',
        path,
        rootPath,
      }],
      downloadRoot: rootPath,
    })
    const { manager } = setup({
      revision: 1,
      tasks: [completed, other],
      legacyImportCompleted: true,
    })

    await expect(manager.getArtifactTarget(completed.id, 'primary'))
      .resolves.toEqual({ path, kind: 'file' })
    await expect(manager.getArtifactTarget(completed.id, 'secondary'))
      .rejects.toThrow('下载产物不存在')
    await expect(manager.getArtifactTarget('dl-1720000000000-9', 'primary'))
      .rejects.toThrow('下载任务不存在')
  })

  it('converts persisted active tasks to interrupted and keeps terminal records', () => {
    const active = storedTask({ status: 'downloading', progress: 30 })
    const completed = storedTask({ id: 'dl-1720000000000-2' })
    const { manager, store } = setup({
      revision: 5,
      tasks: [active, completed],
      legacyImportCompleted: false,
    })

    expect(manager.getSnapshot().tasks).toEqual([
      expect.objectContaining({ id: active.id, status: 'interrupted', phase: '下载已中断' }),
      expect.objectContaining({ id: completed.id, status: 'completed' }),
    ])
    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ revision: 6 }))
  })

  it.each(['failed', 'cancelled', 'interrupted'] as const)(
    'retries %s with the same record ID at the queue tail',
    async (status) => {
      const existing = storedTask({ status, progress: 40, error: '旧错误', warning: '旧提醒' })
      const { manager, executor } = setup({
        revision: 1,
        tasks: [existing],
        legacyImportCompleted: false,
      })
      executor.execute.mockResolvedValue(completedExecution())

      const retried = manager.retry(existing.id)
      expect(retried.tasks[0]).toMatchObject({
        id: existing.id,
        status: 'downloading',
        progress: 0,
      })
      expect(retried.tasks[0].error).toBeUndefined()
      expect(retried.tasks[0].warning).toBeUndefined()
      await vi.waitFor(() => expect(manager.getSnapshot().tasks[0].status).toBe('completed'))
    },
  )

  it('does not retry an old record while an equivalent task is active', () => {
    const failed = storedTask({ status: 'failed', progress: 20 })
    const { manager, executor } = setup({
      revision: 1,
      tasks: [failed],
      legacyImportCompleted: false,
    })
    executor.execute.mockReturnValue(new Promise(() => undefined))
    manager.enqueue(input())

    const snapshot = manager.retry(failed.id)

    expect(snapshot.tasks.find(task => task.id === failed.id)?.status).toBe('failed')
    expect(snapshot.tasks.filter(task => ACTIVE_DOWNLOAD_STATUSES.includes(task.status)))
      .toHaveLength(1)
    expect(executor.execute).toHaveBeenCalledTimes(1)
  })

  it('rejects enqueue without changing memory when required persistence fails', () => {
    const { manager, store, executor } = setup()
    store.save.mockImplementationOnce(() => { throw new Error('disk') })

    expect(() => manager.enqueue(input())).toThrow('任务状态无法保存，请检查磁盘后重试')
    expect(manager.getSnapshot().tasks).toEqual([])
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('debounces progress persistence and retries a dirty write after five seconds', async () => {
    vi.useFakeTimers()
    const execution = deferred<DownloadExecutionResult>()
    const { manager, store, executor } = setup()
    let context: DownloadExecutionContext | undefined
    executor.execute.mockImplementation((_task, value) => {
      context = value
      return execution.promise
    })
    manager.enqueue(input())
    const savesBeforeProgress = store.save.mock.calls.length
    store.save
      .mockImplementationOnce(() => { throw new Error('disk') })
      .mockImplementationOnce(() => { throw new Error('still unavailable') })

    context!.onProgress({ current: 1, total: 10, phase: '下载中' })
    context!.onProgress({ current: 2, total: 10, phase: '下载中' })
    expect(store.save).toHaveBeenCalledTimes(savesBeforeProgress)

    await vi.advanceTimersByTimeAsync(1000)
    expect(store.save).toHaveBeenCalledTimes(savesBeforeProgress + 1)
    expect(manager.getSnapshot().storageWarning).toBeDefined()

    await vi.advanceTimersByTimeAsync(5000)
    expect(store.save).toHaveBeenCalledTimes(savesBeforeProgress + 2)
    expect(manager.getSnapshot().storageWarning).toBeDefined()
    expect(logMocks.error).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(store.save).toHaveBeenCalledTimes(savesBeforeProgress + 3)
    expect(manager.getSnapshot().storageWarning).toBeUndefined()

    execution.resolve(completedExecution())
    await vi.runAllTimersAsync()
  })

  it('imports legacy history once and sanitizes stored feedback', () => {
    const { manager } = setup()
    const imported = manager.importLegacyHistory([
      {
        ...storedTask({
          status: 'failed',
          error: 'C:\\Users\\tester\\secret',
          warning: 'https://example.com/?token=secret',
        }),
        updatedAt: undefined,
      },
      { invalid: true },
    ])

    expect(imported.legacyImportCompleted).toBe(true)
    expect(imported.tasks[0]).toMatchObject({
      error: '下载未能完成，请检查网络和下载设置后重试。',
      warning: '部分附加内容未能保存，正文或其他已完成内容仍然可用。',
    })
    expect(manager.importLegacyHistory([storedTask({ id: 'dl-1720000000000-2' })]))
      .toEqual(imported)
  })

  it('interrupts active work during shutdown and rejects new work', async () => {
    const { manager, executor } = setup()
    executor.execute.mockImplementation((_task, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => reject(new DownloadCancelledError()), { once: true })
    }))
    manager.enqueue(input())

    await manager.shutdown()

    expect(manager.getSnapshot().tasks[0].status).toBe('interrupted')
    expect(() => manager.enqueue(input({ bookId: '200' }))).toThrow('下载管理器正在关闭')
  })

  it('retries shutdown persistence without reopening the queue', async () => {
    const execution = deferred<DownloadExecutionResult>()
    const { manager, store, executor } = setup()
    executor.execute.mockReturnValue(execution.promise)
    manager.enqueue(input())
    store.save.mockImplementation(() => { throw new Error('disk unavailable') })

    execution.resolve(completedExecution())
    await vi.waitFor(() => expect(manager.getSnapshot().storageWarning).toBeDefined())

    await expect(manager.shutdown()).rejects.toThrow('任务状态无法保存')
    expect(() => manager.enqueue(input({ bookId: '200' }))).toThrow('下载管理器正在关闭')
    store.save.mockImplementation(() => undefined)
    await expect(manager.shutdown()).resolves.toBeUndefined()
    expect(manager.getSnapshot().storageWarning).toBeUndefined()
  })
})
