import { create } from 'zustand'
import type {
  DownloadConfig,
  LogConfig,
  PublicConfigSnapshot,
  UpdateCredentialsInput,
} from '../../../shared/config-types'
import { api } from '../api/client'

export type ConfigLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface ConfigState {
  snapshot: PublicConfigSnapshot | null
  loadState: ConfigLoadState
  error: string | null
  fetchConfig(): Promise<void>
  updateDownloadConfig(input: DownloadConfig): Promise<void>
  updateLogConfig(input: LogConfig): Promise<void>
  updateCredentials(input: UpdateCredentialsInput): Promise<void>
  resetCorruptConfig(): Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useConfigStore = create<ConfigState>((set) => {
  const runMutation = async (
    request: () => Promise<PublicConfigSnapshot>,
  ): Promise<void> => {
    set({ error: null })
    try {
      const snapshot = await request()
      set({ snapshot, loadState: 'ready', error: null })
    } catch (error) {
      const message = errorMessage(error)
      try {
        const snapshot = await api.getConfig()
        set({ snapshot, loadState: 'ready', error: message })
      } catch {
        set({ error: message })
      }
      throw error
    }
  }

  return {
    snapshot: null,
    loadState: 'idle',
    error: null,

    fetchConfig: async () => {
      set({ loadState: 'loading', error: null })
      try {
        const snapshot = await api.getConfig()
        set({ snapshot, loadState: 'ready', error: null })
      } catch (error) {
        set({ loadState: 'error', error: errorMessage(error) })
      }
    },

    updateDownloadConfig: (input) => runMutation(() => api.updateDownloadConfig(input)),
    updateLogConfig: (input) => runMutation(() => api.updateLogConfig(input)),
    updateCredentials: (input) => runMutation(() => api.updateCredentials(input)),
    resetCorruptConfig: () => runMutation(() => api.resetCorruptConfig()),
  }
})
