import { create } from 'zustand'
import { api, type BookInfo } from '../api/client'

type BookState = {
  book: BookInfo | null
  loading: boolean
  error: string | null
  fetchBook: (id: string) => Promise<void>
  clear: () => void
}

export const useBookStore = create<BookState>((set) => ({
  book: null,
  loading: false,
  error: null,
  fetchBook: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const book = await api.getBook(id)
      set({ book, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },
  clear: () => set({ book: null, error: null }),
}))
