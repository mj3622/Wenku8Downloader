import { create } from 'zustand'
import { api } from '../api/client'

type DownloadState = {
  downloading: boolean
  error: string | null
  success: string | null
  downloadEpub: (bookId: string, volumeName?: string) => Promise<void>
  downloadImages: (bookId: string, volumeName?: string) => Promise<void>
  clear: () => void
}

export const useDownloadStore = create<DownloadState>((set) => ({
  downloading: false,
  error: null,
  success: null,
  downloadEpub: async (bookId, volumeName) => {
    set({ downloading: true, error: null, success: null })
    try {
      await api.downloadEpub(bookId, volumeName)
      set({ downloading: false, success: 'EPUB 下载完成' })
    } catch (e) {
      set({ downloading: false, error: String(e) })
    }
  },
  downloadImages: async (bookId, volumeName) => {
    set({ downloading: true, error: null, success: null })
    try {
      await api.downloadImages(bookId, volumeName)
      set({ downloading: false, success: '插图下载完成' })
    } catch (e) {
      set({ downloading: false, error: String(e) })
    }
  },
  clear: () => set({ error: null, success: null }),
}))
