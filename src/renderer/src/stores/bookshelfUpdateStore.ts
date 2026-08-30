import { create } from 'zustand'
import type { BookshelfEntry, BookshelfPage } from '../../../shared/ipc-types'
import { api } from '../api/client'
import { toast } from './toastStore'

interface BookshelfUpdateState {
  updateCount: number
  checking: boolean
  check(): Promise<void>
  syncPage(page: BookshelfPage, notify?: boolean): void
  clear(): void
}

function updateEntries(page: BookshelfPage): BookshelfEntry[] {
  return page.entries.filter(entry => entry.updateAvailable)
}

function updateKey(entry: BookshelfEntry): string {
  return [entry.bookId, entry.updatedAt ?? '', entry.latestChapter ?? ''].join('\u0000')
}

export const useBookshelfUpdateStore = create<BookshelfUpdateState>((set) => {
  let inflight: Promise<void> | null = null
  let generation = 0
  const announced = new Set<string>()

  const applyPage = (page: BookshelfPage, notify = false): void => {
    const updates = updateEntries(page)
    const unseen = updates.filter(entry => !announced.has(updateKey(entry)))
    set({ updateCount: updates.length })
    if (notify && unseen.length > 0) {
      toast.info({
        title: '书架发现更新',
        message: updates.length === 1
          ? `《${updates[0].title}》有新内容可下载`
          : `书架中有 ${updates.length} 部作品出现新内容`,
        action: { label: '查看书架', href: '#/bookshelf' },
      })
    }
    for (const entry of updates) announced.add(updateKey(entry))
  }

  const syncPage = (page: BookshelfPage, notify = false): void => {
    generation++
    applyPage(page, notify)
    set({ checking: false })
  }

  return {
    updateCount: 0,
    checking: false,
    check: async () => {
      if (inflight) return inflight
      const requestGeneration = generation
      const request = (async () => {
        set({ checking: true })
        try {
          const config = await api.getConfig()
          if (requestGeneration !== generation) return
          if (!config.account.hasCookies) {
            announced.clear()
            set({ updateCount: 0 })
            return
          }
          const page = await api.getBookshelf()
          if (requestGeneration !== generation) return
          applyPage(page, !page.stale)
        } catch {
          // Automatic checks stay silent and keep the last known indicator.
        } finally {
          if (requestGeneration === generation) set({ checking: false })
        }
      })().finally(() => {
        if (inflight === request) inflight = null
      })
      inflight = request
      return request
    },
    syncPage,
    clear: () => {
      generation++
      inflight = null
      announced.clear()
      set({ updateCount: 0, checking: false })
    },
  }
})
