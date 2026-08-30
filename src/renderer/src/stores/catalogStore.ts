import { create } from 'zustand'
import type { CatalogPage, CatalogQuery } from '../../../shared/ipc-types'
import { api } from '../api/client'
import { getUserFeedback } from '../utils/userFeedback'
import { toast } from './toastStore'

export const DEFAULT_CATALOG_QUERY: CatalogQuery = {
  status: 'all',
  animation: 'all',
  sort: 'lastupdate',
  page: 1,
}

type CatalogFilters = Partial<Omit<CatalogQuery, 'page'>>

type CatalogState = {
  query: CatalogQuery
  page: number
  result: CatalogPage | null
  loading: boolean
  error: string | null
  hasLoaded: boolean
  load: (query?: CatalogQuery, refresh?: boolean) => Promise<void>
  setQuery: (query: CatalogQuery) => void
  setFilters: (filters: CatalogFilters) => void
  setPage: (page: number) => void
  clear: () => void
}

function cloneQuery(query: CatalogQuery): CatalogQuery {
  return {
    ...(query.publisher === undefined ? {} : { publisher: query.publisher }),
    ...(query.initial === undefined ? {} : { initial: query.initial }),
    ...(query.tag === undefined ? {} : { tag: query.tag }),
    status: query.status,
    animation: query.animation,
    sort: query.sort,
    page: query.page,
  }
}

function queryKey(query: CatalogQuery): string {
  return JSON.stringify([
    query.publisher ?? '',
    query.initial ?? '',
    query.tag ?? '',
    query.status,
    query.animation,
    query.sort,
    query.page,
  ])
}

export const useCatalogStore = create<CatalogState>((set, get) => {
  let requestGeneration = 0

  return {
    query: { ...DEFAULT_CATALOG_QUERY },
    page: 1,
    result: null,
    loading: false,
    error: null,
    hasLoaded: false,
    load: async (requested, refresh = false) => {
      const nextQuery = cloneQuery(requested ?? get().query)
      const current = get()
      const generation = ++requestGeneration
      const sameQuery = queryKey(current.query) === queryKey(nextQuery)
      set({
        query: nextQuery,
        page: nextQuery.page,
        result: sameQuery ? current.result : null,
        loading: true,
        error: null,
        hasLoaded: true,
      })
      try {
        const result = await api.getCatalog(nextQuery, refresh)
        if (generation !== requestGeneration) return
        set({
          query: cloneQuery(result.query),
          page: result.page,
          result,
          loading: false,
          error: null,
          hasLoaded: true,
        })
        if (result.stale) {
          toast.warning({
            title: '正在使用缓存',
            message: '网络更新失败，当前显示最近缓存的找书结果。',
          })
        }
      } catch (error) {
        if (generation !== requestGeneration) return
        const feedback = getUserFeedback(error, 'catalog')
        set({ loading: false, error: feedback.message, hasLoaded: true })
        toast.error(feedback)
      }
    },
    setQuery: (query) => {
      requestGeneration++
      const next = cloneQuery(query)
      set({
        query: next,
        page: next.page,
        result: null,
        loading: false,
        error: null,
        hasLoaded: false,
      })
    },
    setFilters: (filters) => {
      requestGeneration++
      const next = cloneQuery({ ...get().query, ...filters, page: 1 })
      set({
        query: next,
        page: 1,
        result: null,
        loading: false,
        error: null,
        hasLoaded: false,
      })
    },
    setPage: (page) => {
      requestGeneration++
      const nextPage = Number.isSafeInteger(page) && page >= 1 && page <= 500 ? page : 1
      set((state) => ({
        query: { ...state.query, page: nextPage },
        page: nextPage,
        result: null,
        loading: false,
        error: null,
        hasLoaded: false,
      }))
    },
    clear: () => {
      requestGeneration++
      set({
        query: { ...DEFAULT_CATALOG_QUERY },
        page: 1,
        result: null,
        loading: false,
        error: null,
        hasLoaded: false,
      })
    },
  }
})
