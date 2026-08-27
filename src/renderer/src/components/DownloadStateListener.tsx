import { useEffect } from 'react'
import { api } from '../api/client'
import { useDownloadStore } from '../stores/downloadStore'
import { toast } from '../stores/toastStore'

const LEGACY_DOWNLOAD_HISTORY_KEY = 'wenku8-download-history'
let connectionGeneration = 0

function legacyTasks(raw: string | null): unknown[] {
  if (raw === null) return []
  try {
    const document = JSON.parse(raw) as unknown
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new Error('旧下载历史格式无效')
    }
    const state = (document as Record<string, unknown>).state
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('旧下载历史格式无效')
    }
    const tasks = (state as Record<string, unknown>).tasks
    if (!Array.isArray(tasks)) throw new Error('旧下载历史格式无效')
    return tasks
  } catch (error) {
    throw new Error('旧下载历史无法读取，原记录已保留', { cause: error })
  }
}

function removeLegacyHistory(): void {
  try {
    localStorage.removeItem(LEGACY_DOWNLOAD_HISTORY_KEY)
  } catch {
    toast.warning({
      title: '旧下载记录未能清理',
      message: '不影响当前下载记录，下次启动时会再次尝试。',
    })
  }
}

export default function DownloadStateListener() {
  useEffect(() => {
    const generation = ++connectionGeneration
    let active = true
    const current = () => active && generation === connectionGeneration
    const unsubscribe = api.onDownloadStateChanged((event) => {
      if (current()) useDownloadStore.getState().applyEvent(event)
    })

    let storedHistory: string | null = null
    let storageReadError: unknown
    try {
      storedHistory = localStorage.getItem(LEGACY_DOWNLOAD_HISTORY_KEY)
    } catch (error) {
      storageReadError = error
    }

    void (async () => {
      try {
        const initial = await api.getDownloadSnapshot()
        if (!current()) return
        useDownloadStore.getState().applySnapshot(initial)

        if (!initial.legacyImportCompleted) {
          if (storageReadError !== undefined) throw storageReadError
          const imported = await api.importLegacyDownloadHistory(legacyTasks(storedHistory))
          if (!current()) return
          useDownloadStore.getState().applySnapshot(imported)
          if (imported.legacyImportCompleted) {
            removeLegacyHistory()
          }
        } else if (storedHistory !== null) {
          // The persisted marker is the acknowledgement from an earlier successful import.
          removeLegacyHistory()
        }
      } catch (error) {
        if (current()) useDownloadStore.getState().setInitializationError(error)
      }
    })()

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return null
}
