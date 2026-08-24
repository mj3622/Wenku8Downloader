import { create } from 'zustand'
import type { UserFeedback } from '../utils/userFeedback'

export type ToastTone = 'success' | 'info' | 'warning' | 'error'

export interface ToastInput extends UserFeedback {
  durationMs?: number
}

export interface ToastItem extends UserFeedback {
  id: string
  tone: ToastTone
  durationMs: number
  updatedAt: number
  dedupeKey: string
}

interface ToastState {
  items: ToastItem[]
  push: (tone: ToastTone, input: ToastInput) => string
  dismiss: (id: string) => void
  clear: () => void
}

const MAX_VISIBLE = 3
const DEDUPE_WINDOW_MS = 2_000
const DEFAULT_DURATION: Record<ToastTone, number> = {
  success: 4_000,
  info: 4_000,
  warning: 7_000,
  error: 7_000,
}

let nextId = 0

function dedupeKey(input: ToastInput): string {
  return [
    input.title,
    input.message,
    input.action?.label ?? '',
    input.action?.href ?? '',
  ].join('\u0000')
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (tone, input) => {
    const now = Date.now()
    const key = dedupeKey(input)
    const existing = get().items.find(
      (item) => item.dedupeKey === key && now - item.updatedAt <= DEDUPE_WINDOW_MS,
    )

    if (existing) {
      const refreshed: ToastItem = {
        ...existing,
        tone,
        durationMs: input.durationMs ?? DEFAULT_DURATION[tone],
        updatedAt: now,
      }
      set((state) => ({
        items: [refreshed, ...state.items.filter((item) => item.id !== existing.id)],
      }))
      return existing.id
    }

    nextId += 1
    const item: ToastItem = {
      ...input,
      id: `toast-${nextId}`,
      tone,
      durationMs: input.durationMs ?? DEFAULT_DURATION[tone],
      updatedAt: now,
      dedupeKey: key,
    }
    set((state) => ({ items: [item, ...state.items].slice(0, MAX_VISIBLE) }))
    return item.id
  },
  dismiss: (id) => set((state) => ({
    items: state.items.filter((item) => item.id !== id),
  })),
  clear: () => set({ items: [] }),
}))

function push(tone: ToastTone, input: ToastInput): string {
  return useToastStore.getState().push(tone, input)
}

export const toast = {
  success: (input: ToastInput) => push('success', input),
  info: (input: ToastInput) => push('info', input),
  warning: (input: ToastInput) => push('warning', input),
  error: (input: ToastInput) => push('error', input),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
}
