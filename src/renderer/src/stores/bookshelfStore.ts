import { create } from 'zustand'
import type { BookshelfPage } from '../../../shared/ipc-types'
import { api } from '../api/client'
import { getUserFeedback } from '../utils/userFeedback'
import { toast } from './toastStore'

interface BookshelfState {
  page: BookshelfPage | null
  loading: boolean
  error: string | null
  load: (refresh?: boolean) => Promise<void>
  clear: () => void
}

export const useBookshelfStore = create<BookshelfState>((set, get) => {
  let requestGeneration = 0

  return {
    page: null,
    loading: false,
    error: null,
    load: async (refresh = false) => {
      const generation = ++requestGeneration
      set({ loading: true, error: null })
      try {
        const page = await api.getBookshelf(refresh)
        if (generation !== requestGeneration) return
        set({ page, loading: false, error: null })
      } catch (error) {
        if (generation !== requestGeneration) return
        const feedback = getUserFeedback(error, 'bookshelf')
        set({ loading: false, error: feedback.message })
        toast.error(feedback)
      }
    },
    clear: () => {
      requestGeneration++
      if (get().page || get().loading || get().error) {
        set({ page: null, loading: false, error: null })
      }
    },
  }
})
