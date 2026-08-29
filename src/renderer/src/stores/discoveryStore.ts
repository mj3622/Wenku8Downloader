import { create } from 'zustand'
import type {
  DiscoveryHome,
  RankingPage,
  RankingType,
} from '../../../shared/ipc-types'
import { isDiscoveryFresh } from '../../../shared/ipc-types'
import { api } from '../api/client'
import { getUserFeedback } from '../utils/userFeedback'
import { toast } from './toastStore'

export type RankingEntry = {
  data: RankingPage | null
  loading: boolean
  refreshing: boolean
  error: string | null
}

type DiscoveryState = {
  home: DiscoveryHome | null
  homeLoading: boolean
  homeRefreshing: boolean
  homeError: string | null
  rankings: Record<string, RankingEntry>
  loadHome: (refresh?: boolean) => Promise<void>
  loadRanking: (type: RankingType, page: number, refresh?: boolean) => Promise<void>
  clear: () => void
}

export function rankingCacheKey(type: RankingType, page: number): string {
  return `${type}:${page}`
}

function warnAboutStaleContent(): void {
  toast.warning({
    title: '正在使用缓存',
    message: '网络更新失败，当前显示最近缓存的推荐和榜单。',
  })
}

export const useDiscoveryStore = create<DiscoveryState>((set, get) => {
  let homeGeneration = 0
  let resetGeneration = 0
  const rankingGenerations = new Map<string, number>()

  return {
    home: null,
    homeLoading: false,
    homeRefreshing: false,
    homeError: null,
    rankings: {},
    loadHome: async (refresh = false) => {
      const current = get()
      if (!refresh && (
        current.homeLoading
        || current.homeRefreshing
        || (current.home && isDiscoveryFresh(current.home.fetchedAt))
      )) return
      if (refresh && current.homeRefreshing) return

      const generation = ++homeGeneration
      const reset = resetGeneration
      set({
        homeLoading: !current.home,
        homeRefreshing: Boolean(current.home),
        homeError: null,
      })
      try {
        const data = await api.getDiscoveryHome(refresh)
        if (generation !== homeGeneration || reset !== resetGeneration) return
        set({ home: data, homeLoading: false, homeRefreshing: false, homeError: null })
        if (data.stale) warnAboutStaleContent()
      } catch (error) {
        if (generation !== homeGeneration || reset !== resetGeneration) return
        const feedback = getUserFeedback(error, 'discovery')
        set({ homeLoading: false, homeRefreshing: false, homeError: feedback.message })
        toast.error(feedback)
      }
    },
    loadRanking: async (type, page, refresh = false) => {
      const key = rankingCacheKey(type, page)
      const current = get().rankings[key]
      if (!refresh && (
        current?.loading
        || current?.refreshing
        || (current?.data && isDiscoveryFresh(current.data.fetchedAt))
      )) return
      if (refresh && current?.refreshing) return

      const generation = (rankingGenerations.get(key) ?? 0) + 1
      rankingGenerations.set(key, generation)
      const reset = resetGeneration
      set((state) => ({
        rankings: {
          ...state.rankings,
          [key]: {
            data: current?.data ?? null,
            loading: !current?.data,
            refreshing: Boolean(current?.data),
            error: null,
          },
        },
      }))
      try {
        const data = await api.getRanking(type, page, refresh)
        if (rankingGenerations.get(key) !== generation || reset !== resetGeneration) return
        set((state) => ({
          rankings: {
            ...state.rankings,
            [key]: { data, loading: false, refreshing: false, error: null },
          },
        }))
        if (data.stale) warnAboutStaleContent()
      } catch (error) {
        if (rankingGenerations.get(key) !== generation || reset !== resetGeneration) return
        const feedback = getUserFeedback(error, 'discovery')
        set((state) => ({
          rankings: {
            ...state.rankings,
            [key]: {
              data: current?.data ?? null,
              loading: false,
              refreshing: false,
              error: feedback.message,
            },
          },
        }))
        toast.error(feedback)
      }
    },
    clear: () => {
      homeGeneration++
      resetGeneration++
      rankingGenerations.clear()
      set({
        home: null,
        homeLoading: false,
        homeRefreshing: false,
        homeError: null,
        rankings: {},
      })
    },
  }
})
