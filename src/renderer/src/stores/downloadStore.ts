import { create } from 'zustand'
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
  error?: string
  createdAt: number
}

let nextId = 1
function uid(): string {
  return `dl-${Date.now()}-${nextId++}`
}

type DownloadState = {
  tasks: DownloadTask[]
  downloadEpub: (bookId: string, title: string, cover?: string, volumeName?: string) => Promise<void>
  downloadImages: (bookId: string, title: string, cover?: string, volumeName?: string) => Promise<void>
  removeTask: (id: string) => void
  clearCompleted: () => void
  clearHistory: () => void
  retryTask: (id: string) => void
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  tasks: [],

  downloadEpub: async (bookId, title, cover, volumeName) => {
    const id = uid()
    const task: DownloadTask = {
      id, bookId, title, cover,
      type: volumeName ? 'epub_volume' : 'epub_full',
      volume: volumeName,
      status: 'downloading',
      progress: 0,
      createdAt: Date.now(),
    }
    set((s) => ({ tasks: [task, ...s.tasks] }))
    try {
      await api.downloadEpub(bookId, volumeName)
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, status: 'completed' as const, progress: 100 } : t
        ),
      }))
    } catch (e) {
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, status: 'failed' as const, error: String(e) } : t
        ),
      }))
    }
  },

  downloadImages: async (bookId, title, cover, volumeName) => {
    const id = uid()
    const task: DownloadTask = {
      id, bookId, title, cover,
      type: 'images',
      volume: volumeName,
      status: 'downloading',
      progress: 0,
      createdAt: Date.now(),
    }
    set((s) => ({ tasks: [task, ...s.tasks] }))
    try {
      await api.downloadImages(bookId, volumeName)
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, status: 'completed' as const, progress: 100 } : t
        ),
      }))
    } catch (e) {
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.id === id ? { ...t, status: 'failed' as const, error: String(e) } : t
        ),
      }))
    }
  },

  removeTask: (id) => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
  },

  clearCompleted: () => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.status !== 'completed') }))
  },

  clearHistory: () => {
    set((s) => ({ tasks: s.tasks.filter((t) => t.status === 'downloading') }))
  },

  retryTask: (id) => {
    const task = get().tasks.find((t) => t.id === id)
    if (!task || task.status !== 'failed') return
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }))
    if (task.type === 'images') {
      get().downloadImages(task.bookId, task.title, task.cover, task.volume)
    } else {
      get().downloadEpub(task.bookId, task.title, task.cover, task.volume)
    }
  },
}))
