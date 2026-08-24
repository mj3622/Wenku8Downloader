import { create } from 'zustand'

export type LoginOperationKind = 'idle' | 'saving' | 'clearing' | 'refreshing'
export type LoginCookieState = 'idle' | 'loading' | 'valid' | 'error'

interface LoginOperationState {
  generation: number
  kind: LoginOperationKind
  loginOperationId: string | null
  cookieState: LoginCookieState
  cookieMessage: string
  lastRefresh: number | null
  suppressSnapshotSync: boolean
  begin(kind: Exclude<LoginOperationKind, 'idle'>, hasCookies: boolean): number
  isCurrent(generation: number): boolean
  startLogin(generation: number): string | null
  updateProgress(operationId: string, message: string): void
  markSubscriptionError(message: string): void
  setCookieResult(
    generation: number,
    state: Exclude<LoginCookieState, 'loading'>,
    message: string,
    lastRefresh?: number | null,
  ): void
  syncFromSnapshot(hasCookies: boolean): void
  preserveResultThroughSnapshotSync(generation: number): void
  finish(generation: number): void
  reset(): void
}

const INITIAL_STATE = {
  generation: 0,
  kind: 'idle' as const,
  loginOperationId: null,
  cookieState: 'idle' as const,
  cookieMessage: '',
  lastRefresh: null,
  suppressSnapshotSync: false,
}

let nextGeneration = 0
let nextLoginAttempt = 0

export const useLoginOperationStore = create<LoginOperationState>((set, get) => ({
  ...INITIAL_STATE,

  begin: (kind, hasCookies) => {
    const generation = ++nextGeneration
    set((state) => ({
      generation,
      kind,
      loginOperationId: null,
      cookieState: hasCookies ? 'valid' : 'idle',
      cookieMessage: '',
      lastRefresh: hasCookies ? state.lastRefresh : null,
      suppressSnapshotSync: false,
    }))
    return generation
  },

  isCurrent: (generation) => get().generation === generation,

  startLogin: (generation) => {
    if (!get().isCurrent(generation)) return null
    const operationId = `login-${Date.now()}-${nextLoginAttempt++}`
    set({
      loginOperationId: operationId,
      cookieState: 'loading',
      cookieMessage: '正在登录...',
    })
    return operationId
  },

  updateProgress: (operationId, message) => {
    if (get().loginOperationId !== operationId) return
    set({ cookieMessage: message })
  },

  markSubscriptionError: (cookieMessage) => {
    set({ cookieState: 'error', cookieMessage })
  },

  setCookieResult: (generation, cookieState, cookieMessage, lastRefresh) => {
    if (!get().isCurrent(generation)) return
    set((state) => ({
      cookieState,
      cookieMessage,
      lastRefresh: lastRefresh === undefined ? state.lastRefresh : lastRefresh,
    }))
  },

  syncFromSnapshot: (hasCookies) => {
    const state = get()
    if (state.suppressSnapshotSync) {
      if (state.loginOperationId === null) {
        set({ suppressSnapshotSync: false })
      }
      return
    }
    if (state.loginOperationId !== null) return
    set({
      cookieState: hasCookies ? 'valid' : 'idle',
      cookieMessage: '',
      lastRefresh: hasCookies ? state.lastRefresh : null,
    })
  },

  preserveResultThroughSnapshotSync: (generation) => {
    if (!get().isCurrent(generation)) return
    set({ suppressSnapshotSync: true })
  },

  finish: (generation) => {
    if (!get().isCurrent(generation)) return
    set({ kind: 'idle', loginOperationId: null })
  },

  reset: () => set(INITIAL_STATE),
}))
