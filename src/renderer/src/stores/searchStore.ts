import { create } from 'zustand'
import type { SearchType } from '../../../shared/ipc-types'
import { api, type SearchResult } from '../api/client'
import { toast } from './toastStore'
import { getUserFeedback } from '../utils/userFeedback'

type SearchState = {
  results: SearchResult[]
  loading: boolean
  error: string | null
  hasSearched: boolean
  lastType: SearchType | null
  lastQuery: string | null
  retryAt: number | null
  cached: boolean
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
    lastType: null,
    lastQuery: null,
    retryAt: null,
    cached: false,
    search: async (type, query) => {
      if (type !== 'author' && type !== 'title') {
        requestGeneration++
        set({
          loading: false,
          error: null,
          results: [],
          hasSearched: false,
          lastType: null,
          lastQuery: null,
          retryAt: null,
          cached: false,
        })
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
        set({
          loading: false,
          error: message,
          results: [],
          hasSearched: false,
          lastType: null,
          lastQuery: null,
          retryAt: null,
          cached: false,
        })
        toast.warning({ title: '请检查搜索内容', message })
        return
      }

      const currentGeneration = ++requestGeneration
      set({
        loading: true,
        error: null,
        results: [],
        hasSearched: true,
        lastType: type,
        lastQuery: normalizedQuery,
        retryAt: null,
        cached: false,
      })
      try {
        const response = type === 'author'
          ? await api.searchAuthor(normalizedQuery)
          : await api.searchTitle(normalizedQuery)
        if (currentGeneration !== requestGeneration) return
        if (response.status === 'cooldown') {
          const cachedResults = response.cachedResults ?? []
          const seconds = Math.max(1, Math.ceil((response.retryAt - Date.now()) / 1_000))
          set({
            results: cachedResults,
            loading: false,
            hasSearched: true,
            retryAt: response.retryAt,
            cached: cachedResults.length > 0,
          })
          toast.warning({
            title: '搜索需要稍等',
            message: `原站限制了搜索频率，请在 ${seconds} 秒后重试`,
          })
        } else {
          set({
            results: response.results,
            loading: false,
            hasSearched: true,
            retryAt: null,
            cached: response.cached,
          })
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
        lastType: null,
        lastQuery: null,
        retryAt: null,
        cached: false,
      })
    },
  }
})
