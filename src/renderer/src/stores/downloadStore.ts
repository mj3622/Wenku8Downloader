import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api } from '../api/client'

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
  createdAt: number
  hasArtifact?: boolean
}

let nextId = 1
function uid(): string {
  return `dl-${Date.now()}-${nextId++}`
}

type TaskUpdatePatch = Partial<Pick<DownloadTask, 'status' | 'progress' | 'phase' | 'error'>>

type DownloadState = {
  tasks: DownloadTask[]
  downloadEpub: (bookId: string, title: string, cover?: string, volumeName?: string) => void
  downloadImages: (bookId: string, title: string, cover?: string, volumeName?: string) => void
  removeTask: (id: string) => void
  clearCompleted: () => void
  clearHistory: () => void
  retryTask: (id: string) => void
  updateTask: (id: string, patch: TaskUpdatePatch) => void
}

// 模块级队列和调度锁
const pendingQueue: DownloadTask[] = []
let isExecuting = false

async function executeNext(): Promise<void> {
  if (isExecuting || pendingQueue.length === 0) return
  isExecuting = true

  const task = pendingQueue.shift()!
  const store = useDownloadStore.getState()
  store.updateTask(task.id, { status: 'downloading', phase: '开始下载...' })

  try {
    if (task.type === 'images') {
      await api.downloadImages(task.bookId, task.volume, task.id)
    } else {
      await api.downloadEpub(task.bookId, task.volume, task.id)
    }
    store.updateTask(task.id, { status: 'completed', progress: 100, phase: '下载完成' })
  } catch (e) {
    store.updateTask(task.id, { status: 'failed', error: String(e) })
  } finally {
    isExecuting = false
    void executeNext()
  }
}

// 注册一次进度事件监听（模块加载时）
let progressRegistered = false
let webTasksRegistered = false

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => {
      if (api.target === 'electron' && !progressRegistered) {
        progressRegistered = true
        api.getDownloadProgress((data) => {
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === data.taskId
                ? { ...t, progress: data.total > 0 ? Math.round((data.current / data.total) * 100) : 0, phase: data.phase }
                : t
            ),
          }))
        })
      }
      if (api.target === 'web' && !webTasksRegistered) {
        webTasksRegistered = true
        api.onTasks((tasks) => set({ tasks }))
        void api.getTasks().then(({ tasks }) => set({ tasks }))
      }

      return {
        tasks: [],

        updateTask: (id: string, patch: TaskUpdatePatch) => {
          set((s) => ({
            tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          }))
        },

        downloadEpub: (bookId, title, cover, volumeName) => {
          if (api.target === 'web') {
            void api.downloadEpub(bookId, volumeName, undefined, title)
              .then((result) => {
                if ('task' in result) {
                  set((state) => ({
                    tasks: [result.task, ...state.tasks.filter((item) => item.id !== result.task.id)],
                  }))
                }
              })
            return
          }
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
          void executeNext()
        },

        downloadImages: (bookId, title, cover, volumeName) => {
          if (api.target === 'web') {
            void api.downloadImages(bookId, volumeName, undefined, title)
              .then((result) => {
                if ('task' in result) {
                  set((state) => ({
                    tasks: [result.task, ...state.tasks.filter((item) => item.id !== result.task.id)],
                  }))
                }
              })
            return
          }
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
          void executeNext()
        },

        removeTask: (id) => {
          if (api.target === 'web') {
            void api.removeWebTask(id).then(() => {
              set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }))
            })
            return
          }
          const idx = pendingQueue.findIndex((t) => t.id === id)
          if (idx >= 0) pendingQueue.splice(idx, 1)
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
        },

        clearCompleted: () => {
          if (api.target === 'web') {
            const completedIds = get().tasks
              .filter((task) => task.status === 'completed')
              .map((task) => task.id)
            void Promise.all(completedIds.map((id) => api.removeWebTask(id))).then(() => {
              set((state) => ({
                tasks: state.tasks.filter((task) => task.status !== 'completed'),
              }))
            })
            return
          }
          set((s) => ({ tasks: s.tasks.filter((t) => t.status !== 'completed') }))
        },

        clearHistory: () => {
          if (api.target === 'web') {
            void api.clearWebTasks().then(() => {
              set((state) => ({
                tasks: state.tasks.filter(
                  (task) => task.status === 'pending' || task.status === 'downloading',
                ),
              }))
            })
            return
          }
          set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'downloading') }))
        },

        retryTask: (id) => {
          const task = get().tasks.find((t) => t.id === id)
          if (!task || task.status !== 'failed') return
          if (api.target === 'web') {
            void api.retryTask(id).then(({ task: nextTask }) => {
              set((state) => ({
                tasks: state.tasks.map((item) => item.id === id ? nextTask : item),
              }))
            })
            return
          }
          set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
          if (task.type === 'images') {
            get().downloadImages(task.bookId, task.title, task.cover, task.volume)
          } else {
            get().downloadEpub(task.bookId, task.title, task.cover, task.volume)
          }
        },
      }
    },
    {
      name: 'wenku8-download-history',
      // 只持久化已完成和失败的任务（运行中的任务重启后不恢复）
      partialize: (state) => ({
        tasks: state.tasks.filter((t) => t.status === 'completed' || t.status === 'failed'),
      }),
    },
  ),
)
