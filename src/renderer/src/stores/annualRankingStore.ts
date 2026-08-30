import { create } from 'zustand'
import {
  isAnnualRankingFresh,
  type AnnualRankingPage,
} from '../../../shared/ipc-types'
import { api } from '../api/client'
import { getUserFeedback } from '../utils/userFeedback'
import { toast } from './toastStore'

export interface AnnualRankingStateEntry {
  data: AnnualRankingPage | null
  loading: boolean
  refreshing: boolean
  error: string | null
}

interface AnnualRankingState {
  entries: Record<number, AnnualRankingStateEntry>
  load: (year: number, refresh?: boolean) => Promise<void>
  clear: () => void
}

export const useAnnualRankingStore = create<AnnualRankingState>((set, get) => {
  let resetGeneration = 0
  const generations = new Map<number, number>()

  return {
    entries: {},
    load: async (year, refresh = false) => {
      const current = get().entries[year]
      if (!refresh && (
        current?.loading
        || current?.refreshing
        || (current?.data && isAnnualRankingFresh(current.data.fetchedAt))
      )) return
      if (refresh && current?.refreshing) return

      const generation = (generations.get(year) ?? 0) + 1
      generations.set(year, generation)
      const reset = resetGeneration
      set(state => ({
        entries: {
          ...state.entries,
          [year]: {
            data: current?.data ?? null,
            loading: !current?.data,
            refreshing: Boolean(current?.data),
            error: null,
          },
        },
      }))
      try {
        const data = await api.getAnnualRanking(year, refresh)
        if (generations.get(year) !== generation || reset !== resetGeneration) return
        set(state => ({
          entries: {
            ...state.entries,
            [year]: { data, loading: false, refreshing: false, error: null },
          },
        }))
        if (data.stale) {
          toast.warning({
            title: '正在使用缓存',
            message: '网络更新失败，当前显示最近缓存的年度榜单',
          })
        }
      } catch (error) {
        if (generations.get(year) !== generation || reset !== resetGeneration) return
        const feedback = getUserFeedback(error, 'discovery')
        set(state => ({
          entries: {
            ...state.entries,
            [year]: {
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
      resetGeneration += 1
      generations.clear()
      set({ entries: {} })
    },
  }
})
