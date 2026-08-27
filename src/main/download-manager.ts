import { randomUUID } from 'crypto'
import type {
  DownloadHistoryScope,
  DownloadSnapshot,
  DownloadStateEvent,
  DownloadTask,
  DownloadTaskStatus,
  DownloadTransition,
  EnqueueDownloadInput,
} from '../shared/ipc-types'
import {
  ACTIVE_DOWNLOAD_STATUSES,
  RETRYABLE_DOWNLOAD_STATUSES,
  TERMINAL_DOWNLOAD_STATUSES,
} from '../shared/ipc-types'
import { DownloadCancelledError } from './download-cancellation'
import {
  toSafeDownloadErrorMessage,
  toSafeDownloadWarningMessage,
  type DownloadExecutionResult,
  type DownloadExecutor,
} from './download-executor'
import {
  normalizeStoredDownloadTask,
  type DownloadTaskStore,
  type PersistedDownloadState,
} from './download-task-store'
import { logger } from './logging/logger'

interface DownloadTaskPersistence {
  load: DownloadTaskStore['load']
  save: DownloadTaskStore['save']
}

interface ActiveDownload {
  taskId: string
  controller: AbortController
  promise: Promise<void>
}

const ACTIVE_STATUSES = new Set<DownloadTaskStatus>(ACTIVE_DOWNLOAD_STATUSES)
const RETRYABLE_STATUSES = new Set<DownloadTaskStatus>(RETRYABLE_DOWNLOAD_STATUSES)
const TERMINAL_STATUSES = new Set<DownloadTaskStatus>(TERMINAL_DOWNLOAD_STATUSES)
const STORAGE_WARNING = '任务状态暂时无法保存，将自动重试。'
const REQUIRED_STORAGE_ERROR = '任务状态无法保存，请检查磁盘后重试'

function cloneTask(task: DownloadTask): DownloadTask {
  return { ...task }
}

function freezeSnapshot(snapshot: DownloadSnapshot): DownloadSnapshot {
  const tasks = snapshot.tasks.map((task) => Object.freeze(cloneTask(task)))
  Object.freeze(tasks)
  return Object.freeze({ ...snapshot, tasks }) as DownloadSnapshot
}

function timerUnref(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref()
}

function summaryWarning(warnings: string[]): string | undefined {
  const normalized = [...new Set(warnings.map(toSafeDownloadWarningMessage))]
  if (normalized.length === 0) return undefined
  if (normalized.length === 1) return normalized[0]
  return `${normalized[0]} 另外还有 ${normalized.length - 1} 项内容未能完整保存。`
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export class DownloadManager {
  private state: PersistedDownloadState = {
    revision: 0,
    tasks: [],
    legacyImportCompleted: false,
  }
  private storageWarning: string | undefined
  private readonly queue: string[] = []
  private readonly listeners = new Set<(event: DownloadStateEvent) => void>()
  private active: ActiveDownload | undefined
  private initialized = false
  private draining = false
  private accepting = true
  private dirty = false
  private progressTimer: ReturnType<typeof setTimeout> | undefined
  private persistenceRetryTimer: ReturnType<typeof setTimeout> | undefined
  private drainRetryTimer: ReturnType<typeof setTimeout> | undefined
  private shutdownPromise: Promise<void> | undefined
  private persistenceFailureLogged = false

  constructor(private readonly options: {
    store: DownloadTaskPersistence
    executor: DownloadExecutor
    createId?: () => string
    now?: () => number
  }) {}

  private get now(): () => number {
    return this.options.now ?? Date.now
  }

  private get createId(): () => string {
    return this.options.createId ?? randomUUID
  }

  initialize(): DownloadSnapshot {
    if (this.initialized) return this.getSnapshot()
    const loaded: PersistedDownloadState = this.options.store.load()
    const now = this.now()
    let restoredActive = false
    const tasks = loaded.tasks.map((task) => {
      if (!ACTIVE_STATUSES.has(task.status)) return cloneTask(task)
      restoredActive = true
      return {
        ...task,
        status: 'interrupted' as const,
        phase: '下载已中断',
        updatedAt: now,
      }
    })
    this.state = {
      revision: loaded.revision + (restoredActive ? 1 : 0),
      tasks,
      legacyImportCompleted: loaded.legacyImportCompleted,
    }
    this.initialized = true

    try {
      // Rewrites states normalized by the store, including work interrupted by a restart.
      this.options.store.save(this.state)
    } catch (error) {
      this.markDirty(error, 'initialize')
    }
    return this.getSnapshot()
  }

  getSnapshot(): DownloadSnapshot {
    return freezeSnapshot({
      revision: this.state.revision,
      tasks: this.state.tasks,
      ...(this.storageWarning === undefined ? {} : { storageWarning: this.storageWarning }),
      legacyImportCompleted: this.state.legacyImportCompleted,
    })
  }

  subscribe(listener: (event: DownloadStateEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(input: EnqueueDownloadInput): DownloadSnapshot {
    this.ensureAccepting()
    const timestamp = this.now()
    const task: DownloadTask = {
      id: this.createId(),
      bookId: input.bookId,
      title: input.title,
      ...(input.cover === undefined ? {} : { cover: input.cover }),
      type: input.type,
      ...(input.volume === undefined ? {} : { volume: input.volume }),
      status: 'pending',
      progress: 0,
      phase: '等待下载...',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const next = this.nextState([task, ...this.state.tasks])
    this.commitRequired(next)
    this.queue.push(task.id)
    this.publish({ taskId: task.id, to: 'pending' })
    void this.drain()
    return this.getSnapshot()
  }

  cancel(taskId: string): DownloadSnapshot {
    const task = this.requireTask(taskId)
    if (task.status === 'cancelling' || TERMINAL_STATUSES.has(task.status)) {
      return this.getSnapshot()
    }
    if (task.status === 'pending') {
      const queueIndex = this.queue.indexOf(taskId)
      if (queueIndex >= 0) this.queue.splice(queueIndex, 1)
      this.updateRuntimeTask(taskId, {
        status: 'cancelled',
        phase: '已取消',
        updatedAt: this.now(),
      }, { taskId, from: 'pending', to: 'cancelled' })
      return this.getSnapshot()
    }
    if (task.status === 'downloading') {
      this.updateRuntimeTask(taskId, {
        status: 'cancelling',
        phase: '正在取消...',
        updatedAt: this.now(),
      }, { taskId, from: 'downloading', to: 'cancelling' })
      if (this.active?.taskId === taskId && !this.active.controller.signal.aborted) {
        this.active.controller.abort()
      }
    }
    return this.getSnapshot()
  }

  retry(taskId: string): DownloadSnapshot {
    this.ensureAccepting()
    const task = this.requireTask(taskId)
    if (!RETRYABLE_STATUSES.has(task.status)) {
      throw new Error('当前下载任务无法重试')
    }
    const retried: DownloadTask = {
      id: task.id,
      bookId: task.bookId,
      title: task.title,
      ...(task.cover === undefined ? {} : { cover: task.cover }),
      type: task.type,
      ...(task.volume === undefined ? {} : { volume: task.volume }),
      status: 'pending',
      progress: 0,
      phase: '等待下载...',
      createdAt: task.createdAt,
      updatedAt: this.now(),
    }
    const next = this.nextState(this.state.tasks.map((item) => item.id === taskId ? retried : item))
    this.commitRequired(next)
    this.queue.push(taskId)
    this.publish({ taskId, from: task.status, to: 'pending' })
    void this.drain()
    return this.getSnapshot()
  }

  remove(taskId: string): DownloadSnapshot {
    const task = this.requireTask(taskId)
    if (!TERMINAL_STATUSES.has(task.status)) {
      throw new Error('只能删除已结束的下载任务')
    }
    this.applyRuntimeState(this.nextState(this.state.tasks.filter((item) => item.id !== taskId)))
    return this.getSnapshot()
  }

  clearHistory(scope: DownloadHistoryScope): DownloadSnapshot {
    const tasks = this.state.tasks.filter((task) => (
      scope === 'completed'
        ? task.status !== 'completed'
        : !TERMINAL_STATUSES.has(task.status)
    ))
    if (tasks.length !== this.state.tasks.length) {
      this.applyRuntimeState(this.nextState(tasks))
    }
    return this.getSnapshot()
  }

  importLegacyHistory(values: unknown[]): DownloadSnapshot {
    if (this.state.legacyImportCompleted) return this.getSnapshot()
    const knownIds = new Set(this.state.tasks.map((task) => task.id))
    const imported: DownloadTask[] = []
    for (const value of values) {
      const task = normalizeStoredDownloadTask(value, 'legacy')
      if (!task || knownIds.has(task.id)) continue
      knownIds.add(task.id)
      imported.push({
        ...task,
        phase: this.safePhaseFor(task.status),
        ...(task.error === undefined
          ? {}
          : { error: toSafeDownloadErrorMessage(task.error) }),
        ...(task.warning === undefined
          ? {}
          : { warning: toSafeDownloadWarningMessage(task.warning) }),
      })
    }
    const tasks = [...this.state.tasks, ...imported]
      .sort((left, right) => right.createdAt - left.createdAt)
    const next: PersistedDownloadState = {
      revision: this.state.revision + 1,
      tasks,
      legacyImportCompleted: true,
    }
    this.commitRequired(next)
    this.publish()
    return this.getSnapshot()
  }

  hasActiveTasks(): boolean {
    return this.state.tasks.some((task) => ACTIVE_STATUSES.has(task.status))
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shutdownPromise = this.performShutdown().catch((error) => {
      this.shutdownPromise = undefined
      throw error
    })
    return this.shutdownPromise
  }

  private async performShutdown(): Promise<void> {
    this.accepting = false
    if (this.drainRetryTimer) clearTimeout(this.drainRetryTimer)
    this.drainRetryTimer = undefined
    this.queue.length = 0

    const timestamp = this.now()
    let changed = false
    const tasks = this.state.tasks.map((task) => {
      if (!ACTIVE_STATUSES.has(task.status)) return task
      changed = true
      return {
        ...task,
        status: 'interrupted' as const,
        phase: '下载已中断',
        updatedAt: timestamp,
      }
    })
    if (changed) this.applyRuntimeState(this.nextState(tasks))

    const active = this.active
    if (active && !active.controller.signal.aborted) active.controller.abort()
    if (active) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      await Promise.race([
        active.promise,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 5_000)
        }),
      ])
      if (timeout) clearTimeout(timeout)
    }

    if (this.dirty) {
      this.persistRuntimeNow()
      if (this.dirty) throw new Error(REQUIRED_STORAGE_ERROR)
    }
    if (this.progressTimer) clearTimeout(this.progressTimer)
    if (this.persistenceRetryTimer) clearTimeout(this.persistenceRetryTimer)
    this.progressTimer = undefined
    this.persistenceRetryTimer = undefined
  }

  private ensureAccepting(): void {
    if (!this.accepting) throw new Error('下载管理器正在关闭')
  }

  private requireTask(taskId: string): DownloadTask {
    const task = this.state.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error('下载任务不存在，请刷新后重试')
    return task
  }

  private nextState(tasks: DownloadTask[]): PersistedDownloadState {
    return {
      revision: this.state.revision + 1,
      tasks,
      legacyImportCompleted: this.state.legacyImportCompleted,
    }
  }

  private commitRequired(next: PersistedDownloadState): void {
    try {
      this.options.store.save(next)
    } catch (error) {
      this.logPersistenceFailure(error, 'command')
      throw new Error(REQUIRED_STORAGE_ERROR, { cause: error })
    }
    this.state = next
    this.persistenceRecovered()
  }

  private applyRuntimeState(
    next: PersistedDownloadState,
    transition?: DownloadTransition,
  ): void {
    this.state = next
    this.publish(transition)
    this.cancelProgressSave()
    this.persistRuntimeNow()
  }

  private updateRuntimeTask(
    taskId: string,
    patch: Partial<DownloadTask>,
    transition?: DownloadTransition,
  ): void {
    const tasks = this.state.tasks.map((task) => (
      task.id === taskId ? { ...task, ...patch } : task
    ))
    this.applyRuntimeState(this.nextState(tasks), transition)
  }

  private updateProgress(taskId: string, current: number, total: number, phase: string): void {
    const task = this.state.tasks.find((item) => item.id === taskId)
    if (!task || (task.status !== 'downloading' && task.status !== 'cancelling')) return
    const progress = total > 0
      ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
      : 0
    if (task.progress === progress && task.phase === phase) return
    const tasks = this.state.tasks.map((item) => item.id === taskId
      ? {
          ...item,
          progress,
          phase: task.status === 'cancelling' ? '正在取消...' : phase.slice(0, 500),
          updatedAt: this.now(),
        }
      : item)
    this.state = this.nextState(tasks)
    this.publish()
    this.scheduleProgressSave()
  }

  private publish(transition?: DownloadTransition): void {
    if (this.listeners.size === 0) return
    const event: DownloadStateEvent = {
      snapshot: this.getSnapshot(),
      ...(transition === undefined ? {} : { transition: { ...transition } }),
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A renderer listener must not stop the scheduler.
      }
    }
  }

  private async drain(): Promise<void> {
    if (this.draining || this.active || !this.accepting) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const taskId = this.queue[0]
        const task = this.state.tasks.find((item) => item.id === taskId)
        if (!task || task.status !== 'pending') {
          this.queue.shift()
          continue
        }
        const startedTask: DownloadTask = {
          ...task,
          status: 'downloading',
          phase: '开始下载...',
          updatedAt: this.now(),
        }
        const next = this.nextState(this.state.tasks.map((item) => (
          item.id === taskId ? startedTask : item
        )))
        try {
          this.options.store.save(next)
        } catch (error) {
          this.storageWarning = STORAGE_WARNING
          this.logPersistenceFailure(error, 'start-task')
          this.publish()
          this.scheduleDrainRetry()
          return
        }
        this.queue.shift()
        this.state = next
        this.persistenceRecovered()
        this.publish({ taskId, from: 'pending', to: 'downloading' })

        const controller = new AbortController()
        const active: ActiveDownload = {
          taskId,
          controller,
          promise: Promise.resolve(),
        }
        this.active = active
        let execution: Promise<DownloadExecutionResult>
        try {
          execution = this.options.executor.execute(startedTask, {
            signal: controller.signal,
            onProgress: (progress) => this.updateProgress(
              taskId,
              progress.current,
              progress.total,
              progress.phase,
            ),
          })
        } catch (error) {
          execution = Promise.reject(error)
        }
        active.promise = execution.then(
          (result) => this.finishSuccess(taskId, result),
          (error) => this.finishFailure(taskId, error),
        ).finally(() => {
          if (this.active === active) this.active = undefined
          void this.drain()
        })
        return
      }
    } finally {
      this.draining = false
    }
  }

  private finishSuccess(taskId: string, result: DownloadExecutionResult): void {
    const task = this.state.tasks.find((item) => item.id === taskId)
    if (!task) return
    const warning = summaryWarning(result.warnings)
    this.updateRuntimeTask(taskId, {
      status: 'completed',
      progress: 100,
      phase: warning ? '下载完成，但有部分内容缺失' : '下载完成',
      error: undefined,
      warning,
      updatedAt: this.now(),
    }, { taskId, from: task.status, to: 'completed' })
  }

  private finishFailure(taskId: string, error: unknown): void {
    const task = this.state.tasks.find((item) => item.id === taskId)
    if (!task) return
    const interrupted = !this.accepting
    const cancelled = error instanceof DownloadCancelledError
      || (
        this.active?.taskId === taskId
        && this.active.controller.signal.aborted
        && isAbortError(error)
      )
    if (interrupted) {
      if (task.status === 'interrupted') return
      this.updateRuntimeTask(taskId, {
        status: 'interrupted',
        phase: '下载已中断',
        updatedAt: this.now(),
      }, { taskId, from: task.status, to: 'interrupted' })
      return
    }
    if (cancelled) {
      this.updateRuntimeTask(taskId, {
        status: 'cancelled',
        phase: '已取消',
        error: undefined,
        warning: undefined,
        updatedAt: this.now(),
      }, { taskId, from: task.status, to: 'cancelled' })
      return
    }
    this.updateRuntimeTask(taskId, {
      status: 'failed',
      phase: '下载失败',
      error: toSafeDownloadErrorMessage(error),
      warning: undefined,
      updatedAt: this.now(),
    }, { taskId, from: task.status, to: 'failed' })
  }

  private scheduleProgressSave(): void {
    if (this.progressTimer) return
    this.progressTimer = setTimeout(() => {
      this.progressTimer = undefined
      this.persistRuntimeNow()
    }, 1_000)
    timerUnref(this.progressTimer)
  }

  private cancelProgressSave(): void {
    if (!this.progressTimer) return
    clearTimeout(this.progressTimer)
    this.progressTimer = undefined
  }

  private persistRuntimeNow(): void {
    try {
      this.options.store.save(this.state)
      this.persistenceRecovered(true)
    } catch (error) {
      this.markDirty(error, 'runtime')
    }
  }

  private markDirty(error: unknown, operation: string): void {
    this.dirty = true
    this.logPersistenceFailure(error, operation)
    const warningChanged = this.storageWarning !== STORAGE_WARNING
    this.storageWarning = STORAGE_WARNING
    if (warningChanged) this.publish()
    this.schedulePersistenceRetry()
  }

  private persistenceRecovered(publish = false): void {
    const warningCleared = this.storageWarning !== undefined
    this.dirty = false
    this.persistenceFailureLogged = false
    this.storageWarning = undefined
    if (this.persistenceRetryTimer) clearTimeout(this.persistenceRetryTimer)
    this.persistenceRetryTimer = undefined
    if (warningCleared && publish) this.publish()
  }

  private logPersistenceFailure(error: unknown, operation: string): void {
    if (this.persistenceFailureLogged) return
    this.persistenceFailureLogged = true
    logger.error(
      'download.state.persist-failed',
      '下载任务状态保存失败',
      error,
      { operation },
    )
  }

  private schedulePersistenceRetry(): void {
    if (this.persistenceRetryTimer) return
    this.persistenceRetryTimer = setTimeout(() => {
      this.persistenceRetryTimer = undefined
      if (this.dirty) this.persistRuntimeNow()
    }, 5_000)
    timerUnref(this.persistenceRetryTimer)
  }

  private scheduleDrainRetry(): void {
    if (this.drainRetryTimer || !this.accepting) return
    this.drainRetryTimer = setTimeout(() => {
      this.drainRetryTimer = undefined
      void this.drain()
    }, 5_000)
    timerUnref(this.drainRetryTimer)
  }

  private safePhaseFor(status: DownloadTaskStatus): string {
    switch (status) {
      case 'completed': return '下载完成'
      case 'failed': return '下载失败'
      case 'cancelled': return '已取消'
      case 'interrupted': return '下载已中断'
      case 'pending': return '等待下载...'
      case 'downloading': return '开始下载...'
      case 'cancelling': return '正在取消...'
    }
  }
}
