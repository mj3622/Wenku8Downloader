import { create } from 'zustand'
import type {
  DownloadHistoryScope,
  DownloadSnapshot,
  DownloadStateEvent,
  DownloadTask,
  EnqueueDownloadInput,
} from '../../../shared/ipc-types'
import { api } from '../api/client'
import { toast } from './toastStore'
import { getUserFeedback } from '../utils/userFeedback'

interface DownloadState {
  tasks: DownloadTask[]
  revision: number
  initialized: boolean
  loading: boolean
  error?: string
  storageWarning?: string
  lastTransitionRevision: number
  applySnapshot(snapshot: DownloadSnapshot): void
  applyEvent(event: DownloadStateEvent): void
  setInitializationError(error: unknown): void
  downloadEpub(bookId: string, title: string, cover?: string, volumeName?: string): void
  downloadImages(bookId: string, title: string, cover?: string, volumeName?: string): void
  downloadBatch(inputs: EnqueueDownloadInput[]): void
  cancelTask(id: string): void
  cancelBatch(id: string): void
  retryTask(id: string): void
  retryBatch(id: string): void
  removeTask(id: string): void
  clearCompleted(): Promise<void>
  clearHistory(): Promise<void>
}

function cloneTasks(tasks: DownloadTask[]): DownloadTask[] {
  return tasks.map((task) => ({
    ...task,
    ...(task.completedVersion === undefined
      ? {}
      : { completedVersion: { ...task.completedVersion } }),
    artifacts: task.artifacts.map(artifact => ({ ...artifact })),
  }))
}

function showStorageWarning(previous: string | undefined, snapshot: DownloadSnapshot): void {
  if (!snapshot.storageWarning || snapshot.storageWarning === previous) return
  toast.warning({
    title: '下载状态暂未保存',
    message: snapshot.storageWarning,
  })
}

function showTransition(event: DownloadStateEvent): void {
  const transition = event.transition
  if (!transition) return
  const task = event.snapshot.tasks.find((item) => item.id === transition.taskId)
  if (!task) return

  if (transition.to === 'pending') {
    toast.success({ title: '已加入下载队列', message: `${task.title} 将按顺序下载` })
  } else if (transition.to === 'completed') {
    if (task.warning) {
      toast.warning({ title: '下载完成，但有提醒', message: task.warning })
    } else {
      toast.success({ title: '下载完成', message: `${task.title} 已保存。` })
    }
  } else if (transition.to === 'failed') {
    toast.error(getUserFeedback(task.error, 'download'))
  } else if (transition.to === 'cancelled') {
    toast.info({ title: '下载已取消', message: `${task.title} 的下载任务已取消。` })
  } else if (transition.to === 'interrupted') {
    toast.warning({ title: '下载已中断', message: `${task.title} 可以从下载记录中重新加入队列。` })
  }
}

async function runCommand(operation: () => Promise<DownloadSnapshot>): Promise<void> {
  try {
    const snapshot = await operation()
    useDownloadStore.getState().applySnapshot(snapshot)
  } catch (error) {
    toast.error(getUserFeedback(error, 'download'))
  }
}

async function runEnqueue(
  operation: () => ReturnType<typeof api.enqueueDownload>,
  title: string,
): Promise<void> {
  try {
    const result = await operation()
    useDownloadStore.getState().applySnapshot(result.snapshot)
    if (result.status === 'duplicate') {
      toast.info({
        title: '任务已在下载中',
        message: `${title} 的相同下载任务不会重复加入队列`,
      })
    }
  } catch (error) {
    toast.error(getUserFeedback(error, 'download'))
  }
}

async function runBatchEnqueue(inputs: EnqueueDownloadInput[]): Promise<void> {
  try {
    const result = await api.enqueueDownloadBatch(inputs)
    useDownloadStore.getState().applySnapshot(result.snapshot)
    const accepted = result.acceptedTaskIds.length
    const skipped = result.skippedDuplicates.length
    if (accepted === 0) {
      toast.info({
        title: '任务已在下载中',
        message: `已跳过 ${skipped} 项重复任务`,
      })
    } else if (skipped > 0) {
      toast.success({
        title: '下载批次已加入',
        message: `已加入 ${accepted} 项，跳过 ${skipped} 项`,
      })
    } else {
      toast.success({
        title: '下载批次已加入',
        message: `已加入 ${accepted} 项任务`,
      })
    }
  } catch (error) {
    toast.error(getUserFeedback(error, 'download'))
  }
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],
  revision: -1,
  initialized: false,
  loading: true,
  error: undefined,
  storageWarning: undefined,
  lastTransitionRevision: -1,

  applySnapshot: (snapshot) => {
    if (snapshot.revision < get().revision) return
    if (snapshot.revision === get().revision) {
      const previousWarning = get().storageWarning
      if (snapshot.storageWarning !== previousWarning) {
        set({ storageWarning: snapshot.storageWarning })
        showStorageWarning(previousWarning, snapshot)
      }
      return
    }
    const previousWarning = get().storageWarning
    set({
      tasks: cloneTasks(snapshot.tasks),
      revision: snapshot.revision,
      initialized: true,
      loading: false,
      error: undefined,
      storageWarning: snapshot.storageWarning,
    })
    showStorageWarning(previousWarning, snapshot)
  },

  applyEvent: (event) => {
    const current = get()
    if (event.snapshot.revision < current.revision) return
    const shouldShowTransition = event.transition !== undefined
      && event.snapshot.revision > current.lastTransitionRevision
    if (event.snapshot.revision === current.revision) {
      const previousWarning = current.storageWarning
      if (event.snapshot.storageWarning !== previousWarning) {
        set({ storageWarning: event.snapshot.storageWarning })
        showStorageWarning(previousWarning, event.snapshot)
      }
      if (shouldShowTransition) {
        set({ lastTransitionRevision: event.snapshot.revision })
        showTransition(event)
      }
      return
    }
    const previousWarning = current.storageWarning
    set({
      tasks: cloneTasks(event.snapshot.tasks),
      revision: event.snapshot.revision,
      initialized: true,
      loading: false,
      error: undefined,
      storageWarning: event.snapshot.storageWarning,
      lastTransitionRevision: shouldShowTransition
        ? event.snapshot.revision
        : current.lastTransitionRevision,
    })
    showStorageWarning(previousWarning, event.snapshot)
    if (shouldShowTransition) showTransition(event)
  },

  setInitializationError: (error) => {
    const feedback = getUserFeedback(error, 'download')
    const hasSynchronizedTasks = get().initialized && get().tasks.length > 0
    set({
      initialized: true,
      loading: false,
      error: hasSynchronizedTasks ? undefined : feedback.message,
    })
    toast.error(feedback)
  },

  downloadEpub: (bookId, title, cover, volumeName) => {
    const input: EnqueueDownloadInput = {
      bookId,
      title,
      ...(cover === undefined ? {} : { cover }),
      type: volumeName ? 'epub_volume' : 'epub_full',
      ...(volumeName === undefined ? {} : { volume: volumeName }),
    }
    void runEnqueue(() => api.enqueueDownload(input), title)
  },

  downloadImages: (bookId, title, cover, volumeName) => {
    const input: EnqueueDownloadInput = {
      bookId,
      title,
      ...(cover === undefined ? {} : { cover }),
      type: 'images',
      ...(volumeName === undefined ? {} : { volume: volumeName }),
    }
    void runEnqueue(() => api.enqueueDownload(input), title)
  },

  downloadBatch: (inputs) => { void runBatchEnqueue(inputs) },

  cancelTask: (id) => { void runCommand(() => api.cancelDownload(id)) },
  cancelBatch: (id) => { void runCommand(() => api.cancelDownloadBatch(id)) },
  retryTask: (id) => { void runCommand(() => api.retryDownload(id)) },
  retryBatch: (id) => { void runCommand(() => api.retryDownloadBatch(id)) },
  removeTask: (id) => { void runCommand(() => api.removeDownload(id)) },
  clearCompleted: () => runCommand(() => api.clearDownloadHistory('completed')),
  clearHistory: () => {
    const scope: DownloadHistoryScope = 'terminal'
    return runCommand(() => api.clearDownloadHistory(scope))
  },
}))
