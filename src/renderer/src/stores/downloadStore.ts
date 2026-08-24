import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/client'
import { toast } from './toastStore'
import { getUserFeedback } from '../utils/userFeedback'

export type DownloadTask = {
  id: string
  bookId: string
  title: string
  cover?: string
  type: 'epub_full' | 'epub_volume' | 'images'
  volume?: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  phase?: string
  error?: string
  warning?: string
  createdAt: number
}

let nextId = 1
function uid(): string {
  return `dl-${Date.now()}-${nextId++}`
}

type TaskUpdatePatch = Partial<Pick<
  DownloadTask,
  'status' | 'progress' | 'phase' | 'error' | 'warning'
>>

type DownloadState = {
  tasks: DownloadTask[]
  downloadEpub: (bookId: string, title: string, cover?: string, volumeName?: string) => void
  downloadImages: (bookId: string, title: string, cover?: string, volumeName?: string) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  clearHistory: () => void
  retryTask: (id: string) => boolean
  updateTask: (id: string, patch: TaskUpdatePatch) => void
}

// 模块级队列和调度锁
const pendingQueue: DownloadTask[] = []
let isExecuting = false

function summarizeWarnings(warnings: string[] | undefined): string | undefined {
  if (!warnings?.length) return undefined
  const safeWarnings = [...new Set(
    warnings.map((warning) => getUserFeedback(warning, 'download-warning').message),
  )]
  if (safeWarnings.length === 0) return undefined
  if (safeWarnings.length === 1) return safeWarnings[0]
  return `${safeWarnings[0]} 另外还有 ${safeWarnings.length - 1} 项内容未能完整保存。`
}

function sanitizePersistedTask(value: unknown): DownloadTask | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const task = value as DownloadTask
  return {
    ...task,
    error: task.error
      ? getUserFeedback(task.error, 'download').message
      : undefined,
    warning: task.warning
      ? getUserFeedback(task.warning, 'download-warning').message
      : undefined,
  }
}

async function executeNext(): Promise<void> {
  if (isExecuting || pendingQueue.length === 0) return
  isExecuting = true

  const task = pendingQueue.shift()!
  const store = useDownloadStore.getState()
  store.updateTask(task.id, { status: 'downloading', phase: '开始下载...' })

  try {
    const result = task.type === 'images'
      ? await api.downloadImages(task.bookId, task.volume, task.id)
      : await api.downloadEpub(task.bookId, task.volume, task.id)
    const warning = summarizeWarnings(result.warnings)
    store.updateTask(task.id, {
      status: 'completed',
      progress: 100,
      phase: warning ? '下载完成，但有部分内容缺失' : '下载完成',
      error: undefined,
      warning,
    })
    if (warning) {
      toast.warning({ title: '下载完成，但有提醒', message: warning })
    } else {
      toast.success({ title: '下载完成', message: `${task.title} 已保存。` })
    }
  } catch (e) {
    const feedback = getUserFeedback(e, 'download')
    store.updateTask(task.id, {
      status: 'failed',
      phase: '下载失败',
      error: feedback.message,
      warning: undefined,
    })
    toast.error(feedback)
  } finally {
    isExecuting = false
    void executeNext()
  }
}

// 注册一次进度事件监听（模块加载时）
let progressRegistered = false

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => {
      if (!progressRegistered) {
        progressRegistered = true
        try {
          api.getDownloadProgress((data) => {
            set((s) => ({
              tasks: s.tasks.map((t) =>
                t.id === data.taskId
                  ? { ...t, progress: data.total > 0 ? Math.round((data.current / data.total) * 100) : 0, phase: data.phase }
                  : t
              ),
            }))
          })
        } catch (error) {
          progressRegistered = false
          toast.error(getUserFeedback(error, 'download'))
        }
      }

      return {
        tasks: [],

        updateTask: (id: string, patch: TaskUpdatePatch) => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          }))
        },

        downloadEpub: (bookId, title, cover, volumeName) => {
          const task: DownloadTask = {
            id: uid(),
            bookId,
            title,
            cover,
            type: volumeName ? 'epub_volume' : 'epub_full',
            volume: volumeName,
            status: 'pending',
            progress: 0,
            phase: '等待下载...',
            createdAt: Date.now(),
          }
          set((s) => ({ tasks: [task, ...s.tasks] }))
          pendingQueue.push(task)
          toast.info({ title: '已加入下载队列', message: `${title} 将按顺序下载。` })
          void executeNext()
        },

        downloadImages: (bookId, title, cover, volumeName) => {
          const task: DownloadTask = {
            id: uid(),
            bookId,
            title,
            cover,
            type: 'images',
            volume: volumeName,
            status: 'pending',
            progress: 0,
            phase: '等待下载...',
            createdAt: Date.now(),
          }
          set((s) => ({ tasks: [task, ...s.tasks] }))
          pendingQueue.push(task)
          toast.info({ title: '已加入下载队列', message: `${title} 的插图将按顺序下载。` })
          void executeNext()
        },

        removeTask: (id) => {
          const idx = pendingQueue.findIndex((t) => t.id === id)
          if (idx >= 0) pendingQueue.splice(idx, 1)
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
        },

        clearCompleted: () => {
          set((s) => ({ tasks: s.tasks.filter((t) => t.status !== 'completed') }))
        },

        clearHistory: () => {
          set((s) => ({
            tasks: s.tasks.filter((t) => t.status === 'pending' || t.status === 'downloading'),
          }))
        },

        retryTask: (id) => {
          const task = get().tasks.find((t) => t.id === id)
          if (!task || task.status !== 'failed') {
            toast.warning({
              title: '无法重试下载',
              message: '这条记录不存在或当前状态不需要重试。',
            })
            return false
          }
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
          if (task.type === 'images') {
            get().downloadImages(task.bookId, task.title, task.cover, task.volume)
          } else {
            get().downloadEpub(task.bookId, task.title, task.cover, task.volume)
          }
          return true
        },
      }
    },
    {
      name: 'wenku8-download-history',
      // 只持久化已完成和失败的任务（运行中的任务重启后不恢复）
      partialize: (state) => ({
        tasks: state.tasks.filter((t) => t.status === 'completed' || t.status === 'failed'),
      }),
      version: 2,
      migrate: (persistedState) => {
        const state = persistedState as { tasks?: unknown[] }
        return {
          ...state,
          tasks: Array.isArray(state.tasks)
            ? state.tasks.map(sanitizePersistedTask).filter((task): task is DownloadTask => task !== null)
            : [],
        }
      },
    },
  ),
)
