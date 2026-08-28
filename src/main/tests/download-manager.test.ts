import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  DownloadSnapshot,
  DownloadTask,
  EnqueueDownloadInput,
} from '../../shared/ipc-types'

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
} from '../download-executor'
import { DownloadManager } from '../download-manager'
import type { PersistedDownloadState } from '../download-task-store'

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

function storedTask(overrides: Partial<DownloadTask> = {}): DownloadTask {
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
    ...overrides,
  }
}

function setup(initial: PersistedDownloadState = {
  revision: 0,
  tasks: [],
  legacyImportCompleted: false,
}) {
  const saved: PersistedDownloadState[] = []
  const store = {
    load: vi.fn(() => structuredClone(initial)),
    save: vi.fn((state: PersistedDownloadState) => {
      saved.push(structuredClone(state))
    }),
  }
  const executor = { execute: vi.fn<(
    task: DownloadTask,
    context: DownloadExecutionContext,
  ) => Promise<DownloadExecutionResult>>() }
  let nextId = 1
  let now = 10_000
  const manager = new DownloadManager({
    store,
    executor,
    createId: () => `123e4567-e89b-42d3-a456-42661417400${nextId++}`,
    now: () => now++,
  })
  manager.initialize()
  return { manager, store, executor, saved }
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

    first.resolve({ warnings: [] })
    await vi.waitFor(() => expect(executor.execute).toHaveBeenCalledTimes(2))
    expect(executor.execute.mock.calls[1][0].bookId).toBe('200')

    second.resolve({ warnings: [] })
    await vi.waitFor(() => expect(manager.hasActiveTasks()).toBe(false))
  })

  it('publishes cloned snapshots with increasing revisions', () => {
    const { manager, executor } = setup()
    executor.execute.mockReturnValue(new Promise(() => undefined))
    const revisions: number[] = []
    const unsubscribe = manager.subscribe((event) => revisions.push(event.snapshot.revision))

    const first = manager.enqueue(input())
    expect(() => { first.tasks[0].title = 'mutated' }).toThrow()
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

    execution.resolve({ warnings: [] })
    await vi.runAllTimersAsync()
  })

  it('cancels a queued task without executing it', async () => {
    const first = deferred<DownloadExecutionResult>()
    const { manager, executor } = setup()
    executor.execute.mockImplementation(() => first.promise)
    manager.enqueue(input({ bookId: '100' }))
    const second = manager.enqueue(input({ bookId: '200' })).tasks.find((task) => task.bookId === '200')!

    manager.cancel(second.id)
    first.resolve({ warnings: [] })
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
    const id = manager.enqueue(input()).tasks[0].id

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
    const id = manager.enqueue(input()).tasks[0].id

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
    const id = manager.enqueue(input()).tasks[0].id

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
    const id = manager.enqueue(input()).tasks[0].id

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
    const id = manager.enqueue(input()).tasks[0].id

    manager.cancel(id)
    execution.resolve({ warnings: [] })

    await vi.waitFor(() => expect(manager.getSnapshot().tasks[0].status).toBe('completed'))
  })
})

describe('DownloadManager recovery and persistence', () => {
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
      completed,
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
      executor.execute.mockResolvedValue({ warnings: [] })

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

    execution.resolve({ warnings: [] })
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

    execution.resolve({ warnings: [] })
    await vi.waitFor(() => expect(manager.getSnapshot().storageWarning).toBeDefined())

    await expect(manager.shutdown()).rejects.toThrow('任务状态无法保存')
    expect(() => manager.enqueue(input({ bookId: '200' }))).toThrow('下载管理器正在关闭')
    store.save.mockImplementation(() => undefined)
    await expect(manager.shutdown()).resolves.toBeUndefined()
    expect(manager.getSnapshot().storageWarning).toBeUndefined()
  })
})
