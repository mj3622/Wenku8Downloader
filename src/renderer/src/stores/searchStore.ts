import { create } from 'zustand'
import { api, type SearchResult } from '../api/client'
import { toast } from './toastStore'
import { getUserFeedback } from '../utils/userFeedback'

type SearchType = 'author' | 'title'

type SearchState = {
  results: SearchResult[]
  loading: boolean
  error: string | null
  hasSearched: boolean
  lastQuery: string | null
  search: (type: SearchType, query: string) => Promise<void>
  clear: () => void
}

export const useSearchStore = create<SearchState>((set) => {
  let requestGeneration = 0

  return {
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
    lastQuery: null,
    search: async (type, query) => {
      if (type !== 'author' && type !== 'title') {
        requestGeneration++
        set({ loading: false, error: null, results: [], hasSearched: false, lastQuery: null })
        toast.warning({
          title: '搜索方式不可用',
          message: '请重新选择作者检索或书名检索。',
        })
        return
      }

      const normalizedQuery = query.trim()
      if (!normalizedQuery || normalizedQuery.length > 100) {
        requestGeneration++
        const message = normalizedQuery
          ? '搜索内容不能超过 100 个字。'
          : '请输入要搜索的内容。'
        set({ loading: false, error: message, results: [], hasSearched: false, lastQuery: null })
        toast.warning({ title: '请检查搜索内容', message })
        return
      }

      const currentGeneration = ++requestGeneration
      set({
        loading: true,
        error: null,
        results: [],
        hasSearched: true,
        lastQuery: normalizedQuery,
      })
      try {
        if (type === 'author') {
          const data = await api.searchAuthor(normalizedQuery)
          if (currentGeneration !== requestGeneration) return
          set({ results: data.results, loading: false, hasSearched: true })
        } else {
          const data = await api.searchTitle(normalizedQuery)
          if (currentGeneration !== requestGeneration) return
          set({ results: data.results, loading: false, hasSearched: true })
        }
      } catch (e) {
        if (currentGeneration !== requestGeneration) return
        const feedback = getUserFeedback(e, 'search')
        set({ error: feedback.message, loading: false, hasSearched: true })
        toast.error(feedback)
      }
    },
    clear: () => {
      requestGeneration++
      set({
        results: [],
        error: null,
        loading: false,
        hasSearched: false,
        lastQuery: null,
      })
    },
  }
})
