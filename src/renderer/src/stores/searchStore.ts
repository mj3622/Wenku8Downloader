import { create } from 'zustand'
import type { SearchResult } from '../api/client'

type SearchType = 'id' | 'author' | 'title'

type SearchState = {
  results: SearchResult[]
  loading: boolean
  error: string | null
  searchType: SearchType
  search: (type: SearchType, query: string) => Promise<void>
  clear: () => void
}

export const useSearchStore = create<SearchState>((set) => ({
  results: [],
  loading: false,
  error: null,
  searchType: 'id',
  search: async (type, query) => {
    set({ loading: true, error: null, results: [], searchType: type })
    try {
      const { api } = await import('../api/client')
      if (type === 'author') {
        const data = await api.searchAuthor(query)
        set({ results: data.results, loading: false })
      } else if (type === 'title') {
        const data = await api.searchTitle(query)
        set({ results: data.results, loading: false })
      }
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },
  clear: () => set({ results: [], error: null }),
}))
