import { create } from 'zustand'
import { api } from '../api/client'

type ConfigState = {
  config: Record<string, unknown> | null
  loading: boolean
  fetchConfig: () => Promise<void>
  setConfig: (section: string, key: string, value: unknown) => Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => ({
  config: null,
  loading: false,
  fetchConfig: async () => {
    set({ loading: true })
    try {
      const config = await api.getConfig()
      set({ config, loading: false })
    } catch {
      set({ loading: false })
    }
  },
  setConfig: async (section, key, value) => {
    await api.setConfig(section, key, value)
    const config = await api.getConfig()
    set({ config })
  },
}))
