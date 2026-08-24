import { create } from 'zustand'
import { api, type BookInfo } from '../api/client'
import { toast } from './toastStore'
import { getUserFeedback } from '../utils/userFeedback'

type BookState = {
  book: BookInfo | null
  loading: boolean
  error: string | null
  fetchBook: (id: string) => Promise<void>
  clear: () => void
}

export const useBookStore = create<BookState>((set) => {
  let requestGeneration = 0

  return {
    book: null,
    loading: false,
    error: null,
    fetchBook: async (id: string) => {
      if (!/^\d{1,12}$/.test(id)) {
        requestGeneration++
        const feedback = {
          title: '无法打开作品',
          message: '作品编号无效，请返回搜索页重新输入。',
          action: { label: '返回检索', href: '#/search' as const },
        }
        set({ book: null, loading: false, error: feedback.message })
        toast.warning(feedback)
        return
      }

      const currentGeneration = ++requestGeneration
      set({ loading: true, error: null })
      try {
        const book = await api.getBook(id)
        if (currentGeneration !== requestGeneration) return
        set({ book, loading: false })
      } catch (e) {
        if (currentGeneration !== requestGeneration) return
        const feedback = getUserFeedback(e, 'book')
        set({ book: null, error: feedback.message, loading: false })
        toast.error(feedback)
      }
    },
    clear: () => {
      requestGeneration++
      set({ book: null, error: null, loading: false })
    },
  }
})
