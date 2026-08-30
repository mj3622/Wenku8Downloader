import { randomUUID } from 'crypto'
import { resolve } from 'path'
import type {
  DownloadHistoryScope,
  DownloadSnapshot,
  DownloadStateEvent,
  DownloadTask,
  DownloadTaskCore,
  DownloadTaskStatus,
  DownloadTransition,
  EnqueueDownloadBatchResult,
  EnqueueDownloadResult,
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
  resolveDownloadArtifactTarget,
  toDownloadArtifact,
  type ResolvedDownloadArtifactTarget,
} from './download-artifacts'
import {
  normalizeStoredDownloadTask,
  type DownloadTaskStore,
  type PersistedDownloadTask,
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
const PROGRESS_PUBLISH_INTERVAL_MS = 500

function clonePersistedTask(task: PersistedDownloadTask): PersistedDownloadTask {
  return {
    ...task,
    ...(task.completedVersion === undefined
      ? {}
      : { completedVersion: { ...task.completedVersion } }),
    artifacts: task.artifacts.map(artifact => ({ ...artifact })),
  }
}

function toPublicTask(task: PersistedDownloadTask): DownloadTask {
  const publicTask = { ...task }
  delete (publicTask as Partial<PersistedDownloadTask>).downloadRoot
  return {
    ...publicTask,
    artifacts: task.artifacts.map(toDownloadArtifact),
  }
}

function freezeSnapshot(snapshot: DownloadSnapshot): DownloadSnapshot {
  const tasks = snapshot.tasks.map((task) => {
    const artifacts = task.artifacts.map(artifact => Object.freeze({ ...artifact }))
    Object.freeze(artifacts)
    const completedVersion = task.completedVersion
      ? Object.freeze({ ...task.completedVersion })
      : undefined
    return Object.freeze({
      ...task,
      ...(completedVersion === undefined ? {} : { completedVersion }),
      artifacts,
    })
  })
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

function downloadTaskKey(task: Pick<DownloadTaskCore, 'bookId' | 'type' | 'volume'>): string {
  return JSON.stringify([
    task.bookId,
    task.type,
    task.volume?.normalize('NFKC').trim() ?? '',
  ])
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
  private progressPublishTimer: ReturnType<typeof setTimeout> | undefined
  private persistenceRetryTimer: ReturnType<typeof setTimeout> | undefined
  private drainRetryTimer: ReturnType<typeof setTimeout> | undefined
  private shutdownPromise: Promise<void> | undefined
  private persistenceFailureLogged = false

  constructor(private readonly options: {
    store: DownloadTaskPersistence
    executor: DownloadExecutor
    createId?: () => string
    createBatchId?: () => string
    getDownloadRoot?: () => string
    now?: () => number
  }) {}

  private get now(): () => number {
    return this.options.now ?? Date.now
  }

  private get createId(): () => string {
    return this.options.createId ?? randomUUID
  }

  private get createBatchId(): () => string {
    return this.options.createBatchId ?? randomUUID
  }

  private get downloadRoot(): string {
    return resolve(this.options.getDownloadRoot?.() ?? '/downloads')
  }

  initialize(): DownloadSnapshot {
    if (this.initialized) return this.getSnapshot()
    const loaded: PersistedDownloadState = this.options.store.load()
    const now = this.now()
    let restoredActive = false
    const tasks = loaded.tasks.map((task) => {
      if (!ACTIVE_STATUSES.has(task.status)) return clonePersistedTask(task)
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
      tasks: this.state.tasks.map(toPublicTask),
      ...(this.storageWarning === undefined ? {} : { storageWarning: this.storageWarning }),
      legacyImportCompleted: this.state.legacyImportCompleted,
    })
  }

  subscribe(listener: (event: DownloadStateEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(input: EnqueueDownloadInput): EnqueueDownloadResult {
    this.ensureAccepting()
    const duplicate = this.findActiveDuplicate(input)
    if (duplicate) {
      return {
        status: 'duplicate',
        taskId: duplicate.id,
        snapshot: this.getSnapshot(),
      }
    }
    const task = this.createPendingTask(input)
    const next = this.nextState([task, ...this.state.tasks])
    this.commitRequired(next)
    this.queue.push(task.id)
    this.publish({ taskId: task.id, to: 'pending' })
    void this.drain()
    return {
      status: 'enqueued',
      taskId: task.id,
      snapshot: this.getSnapshot(),
    }
  }

  enqueueBatch(inputs: EnqueueDownloadInput[]): EnqueueDownloadBatchResult {
    this.ensureAccepting()
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) {
      throw new Error('每个下载批次需要包含 1 到 100 项任务')
    }

    const activeByKey = new Map<string, { id: string }>()
    for (const task of this.state.tasks) {
      if (ACTIVE_STATUSES.has(task.status)) activeByKey.set(downloadTaskKey(task), task)
    }
    const accepted: Array<{ input: EnqueueDownloadInput; taskId: string }> = []
    const skippedDuplicates: EnqueueDownloadBatchResult['skippedDuplicates'] = []
    for (const input of inputs) {
      const key = downloadTaskKey(input)
      const duplicate = activeByKey.get(key)
      if (duplicate) {
        skippedDuplicates.push({
          taskId: duplicate.id,
          bookId: input.bookId,
          type: input.type,
          ...(input.volume === undefined ? {} : { volume: input.volume }),
        })
        continue
      }
      const taskId = this.createId()
      accepted.push({ input, taskId })
      activeByKey.set(key, { id: taskId })
    }

    if (accepted.length === 0) {
      return {
        batchId: null,
        acceptedTaskIds: [],
        skippedDuplicates,
        snapshot: this.getSnapshot(),
      }
    }

    const batchId = this.createBatchId()
    const timestamp = this.now()
    const tasks = accepted.map(({ input, taskId }) => (
      this.createPendingTask(input, batchId, timestamp, taskId)
    ))
    const next = this.nextState([...tasks, ...this.state.tasks])
    this.commitRequired(next)
    this.queue.push(...tasks.map(task => task.id))
    this.publish()
    void this.drain()
    return {
      batchId,
      acceptedTaskIds: tasks.map(task => task.id),
      skippedDuplicates,
      snapshot: this.getSnapshot(),
    }
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

  cancelBatch(batchId: string): DownloadSnapshot {
    const batch = this.state.tasks.filter(task => task.batchId === batchId)
    if (batch.length === 0) throw new Error('下载批次不存在，请刷新页面后重试')
    const timestamp = this.now()
    const abortTaskIds = new Set<string>()
    const pendingTaskIds = new Set<string>()
    let changed = false
    const tasks = this.state.tasks.map((task) => {
      if (task.batchId !== batchId) return task
      if (task.status === 'pending') {
        changed = true
        pendingTaskIds.add(task.id)
        return { ...task, status: 'cancelled' as const, phase: '已取消', updatedAt: timestamp }
      }
      if (task.status === 'downloading') {
        changed = true
        abortTaskIds.add(task.id)
        return { ...task, status: 'cancelling' as const, phase: '正在取消...', updatedAt: timestamp }
      }
      return task
    })
    if (!changed) return this.getSnapshot()
    this.commitRequired(this.nextState(tasks))
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (pendingTaskIds.has(this.queue[index])) this.queue.splice(index, 1)
    }
    this.publish()
    if (this.active && abortTaskIds.has(this.active.taskId) && !this.active.controller.signal.aborted) {
      this.active.controller.abort()
    }
    return this.getSnapshot()
  }

  retry(taskId: string): DownloadSnapshot {
    this.ensureAccepting()
    const task = this.requireTask(taskId)
    if (!RETRYABLE_STATUSES.has(task.status)) {
      throw new Error('当前下载任务无法重试')
    }
    if (this.findActiveDuplicate(task)) return this.getSnapshot()
    const retried: PersistedDownloadTask = {
      ...task,
      status: 'pending',
      progress: 0,
      phase: '等待下载...',
      error: undefined,
      warning: undefined,
      updatedAt: this.now(),
      artifacts: [],
      downloadRoot: this.downloadRoot,
    }
    const next = this.nextState(this.state.tasks.map((item) => item.id === taskId ? retried : item))
    this.commitRequired(next)
    this.queue.push(taskId)
    this.publish({ taskId, from: task.status, to: 'pending' })
    void this.drain()
    return this.getSnapshot()
  }

  retryBatch(batchId: string): DownloadSnapshot {
    this.ensureAccepting()
    const batch = this.state.tasks.filter(task => task.batchId === batchId)
    if (batch.length === 0) throw new Error('下载批次不存在，请刷新页面后重试')
    const activeKeys = new Set(
      this.state.tasks.filter(task => ACTIVE_STATUSES.has(task.status)).map(downloadTaskKey),
    )
    const retryIds: string[] = []
    const timestamp = this.now()
    const tasks = this.state.tasks.map((task) => {
      if (task.batchId !== batchId || !RETRYABLE_STATUSES.has(task.status)) return task
      const key = downloadTaskKey(task)
      if (activeKeys.has(key)) return task
      activeKeys.add(key)
      retryIds.push(task.id)
      return {
        ...task,
        status: 'pending' as const,
        progress: 0,
        phase: '等待下载...',
        error: undefined,
        warning: undefined,
        updatedAt: timestamp,
        artifacts: [],
        downloadRoot: this.downloadRoot,
      }
    })
    if (retryIds.length === 0) return this.getSnapshot()
    this.commitRequired(this.nextState(tasks))
    this.queue.push(...retryIds)
    this.publish()
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
    const imported: PersistedDownloadTask[] = []
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

  async getArtifactTarget(
    taskId: string,
    artifactId: string,
  ): Promise<ResolvedDownloadArtifactTarget> {
    const task = this.requireTask(taskId)
    if (task.status !== 'completed') throw new Error('下载任务尚未完成')
    const artifact = task.artifacts.find(item => item.id === artifactId)
    if (!artifact) throw new Error('下载产物不存在，请刷新后重试')
    return resolveDownloadArtifactTarget(artifact)
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
    if (this.progressPublishTimer) clearTimeout(this.progressPublishTimer)
    if (this.persistenceRetryTimer) clearTimeout(this.persistenceRetryTimer)
    this.progressTimer = undefined
    this.progressPublishTimer = undefined
    this.persistenceRetryTimer = undefined
  }

  private ensureAccepting(): void {
    if (!this.accepting) throw new Error('下载管理器正在关闭')
  }

  private createPendingTask(
    input: EnqueueDownloadInput,
    batchId?: string,
    timestamp = this.now(),
    taskId = this.createId(),
  ): PersistedDownloadTask {
    return {
      id: taskId,
      bookId: input.bookId,
      title: input.title,
      ...(input.cover === undefined ? {} : { cover: input.cover }),
      type: input.type,
      ...(input.volume === undefined ? {} : { volume: input.volume }),
      ...(batchId === undefined ? {} : { batchId }),
      status: 'pending',
      progress: 0,
      phase: '等待下载...',
      createdAt: timestamp,
      updatedAt: timestamp,
      artifacts: [],
      downloadRoot: this.downloadRoot,
    }
  }

  private requireTask(taskId: string): PersistedDownloadTask {
    const task = this.state.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error('下载任务不存在，请刷新后重试')
    return task
  }

  private nextState(tasks: PersistedDownloadTask[]): PersistedDownloadState {
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
    this.cancelProgressPublish()
    this.state = next
    this.publish(transition)
    this.cancelProgressSave()
    this.persistRuntimeNow()
  }

  private updateRuntimeTask(
    taskId: string,
    patch: Partial<PersistedDownloadTask>,
    transition?: DownloadTransition,
  ): void {
    const tasks = this.state.tasks.map((task) => (
      task.id === taskId ? { ...task, ...patch } : task
    ))
    this.applyRuntimeState(this.nextState(tasks), transition)
  }

  private updateProgress(
    taskId: string,
    current: number,
    total: number,
    phase: string,
  ): void {
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
    this.scheduleProgressPublish()
    this.scheduleProgressSave()
  }

  private scheduleProgressPublish(): void {
    if (this.progressPublishTimer) return
    this.progressPublishTimer = setTimeout(() => {
      this.progressPublishTimer = undefined
      this.publish()
    }, PROGRESS_PUBLISH_INTERVAL_MS)
    timerUnref(this.progressPublishTimer)
  }

  private cancelProgressPublish(): void {
    if (!this.progressPublishTimer) return
    clearTimeout(this.progressPublishTimer)
    this.progressPublishTimer = undefined
  }

  private updateTaskCover(taskId: string, cover: string): void {
    const task = this.state.tasks.find((item) => item.id === taskId)
    if (!task || task.cover === cover) return
    this.updateRuntimeTask(taskId, {
      cover,
      updatedAt: this.now(),
    })
    logger.debug('download.task-cover.updated', '下载任务封面已更新', { taskId })
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
        const startedTask: PersistedDownloadTask = {
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
            onVolumeCover: (cover) => this.updateTaskCover(taskId, cover),
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
      completedVersion: { ...result.versionFields },
      artifacts: result.artifacts.map(artifact => ({ ...artifact })),
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

  private findActiveDuplicate(
    input: Pick<DownloadTaskCore, 'bookId' | 'type' | 'volume'>,
  ): PersistedDownloadTask | undefined {
    const key = downloadTaskKey(input)
    return this.state.tasks.find(task => (
      ACTIVE_STATUSES.has(task.status) && downloadTaskKey(task) === key
    ))
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
