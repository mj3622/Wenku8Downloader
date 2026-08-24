import { create } from 'zustand'
import type {
  DownloadConfig,
  LogConfig,
  PublicConfigSnapshot,
  UpdateCredentialsInput,
} from '../../../shared/config-types'
import { api } from '../api/client'
import { toast } from './toastStore'
import {
  getUserFeedback,
  toUserFacingError,
  type FeedbackContext,
} from '../utils/userFeedback'

export type ConfigLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface ConfigOperationOptions {
  isCurrent?: () => boolean
  context?: FeedbackContext
}

export interface ConfigState {
  snapshot: PublicConfigSnapshot | null
  loadState: ConfigLoadState
  error: string | null
  fetchConfig(options?: ConfigOperationOptions): Promise<boolean>
  updateDownloadConfig(input: DownloadConfig): Promise<void>
  updateLogConfig(input: LogConfig): Promise<void>
  updateCredentials(
    input: UpdateCredentialsInput,
    options?: ConfigOperationOptions,
  ): Promise<void>
  resetCorruptConfig(): Promise<void>
}

export const useConfigStore = create<ConfigState>((set) => {
  const runMutation = async (
    request: () => Promise<PublicConfigSnapshot>,
    context: FeedbackContext,
    options: ConfigOperationOptions = {},
  ): Promise<void> => {
    const isCurrent = options.isCurrent ?? (() => true)
    if (isCurrent()) set({ error: null })
    try {
      const snapshot = await request()
      if (isCurrent()) set({ snapshot, loadState: 'ready', error: null })
    } catch (error) {
      const message = getUserFeedback(error, context).message
      if (!isCurrent()) throw toUserFacingError(error, context)
      try {
        const snapshot = await api.getConfig()
        if (isCurrent()) set({ snapshot, loadState: 'ready', error: message })
      } catch {
        // Reconciliation is an internal best-effort read; the original action
        // failure is still rethrown and shown by the initiating page.
        if (isCurrent()) set({ error: message })
      }
      throw toUserFacingError(error, context)
    }
  }

  return {
    snapshot: null,
    loadState: 'idle',
    error: null,

    fetchConfig: async (options = {}) => {
      const isCurrent = options.isCurrent ?? (() => true)
      const context = options.context ?? 'config-load'
      if (!isCurrent()) return false
      set({ loadState: 'loading', error: null })
      try {
        const snapshot = await api.getConfig(context)
        if (!isCurrent()) return false
        set({ snapshot, loadState: 'ready', error: null })
        return true
      } catch (error) {
        if (!isCurrent()) return false
        const feedback = getUserFeedback(error, context)
        set({ loadState: 'error', error: feedback.message })
        toast.error(feedback)
        return false
      }
    },

    updateDownloadConfig: (input) => runMutation(
      () => api.updateDownloadConfig(input),
      'config-save',
    ),
    updateLogConfig: (input) => runMutation(
      () => api.updateLogConfig(input),
      'log-save',
    ),
    updateCredentials: (input, options) => runMutation(
      () => api.updateCredentials(input),
      'account-save',
      options,
    ),
    resetCorruptConfig: () => runMutation(
      () => api.resetCorruptConfig(),
      'config-reset',
    ),
  }
})
