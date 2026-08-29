// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  book: {
    book_id: '3057',
    basic_info: { 标题: '测试作品', 作者: '测试作者', cover: 'https://example.com/book.jpg' },
    volumes: {} as Record<string, unknown[]>,
  },
  fetchBook: vi.fn(),
  clear: vi.fn(),
  downloadEpub: vi.fn(),
  downloadImages: vi.fn(),
  getVolumeCovers: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock('../../stores/bookStore', () => ({
  useBookStore: () => ({
    book: mocks.book,
    loading: false,
    error: null,
    fetchBook: mocks.fetchBook,
    clear: mocks.clear,
  }),
}))

vi.mock('../../stores/downloadStore', () => ({
  useDownloadStore: () => ({
    downloadEpub: mocks.downloadEpub,
    downloadImages: mocks.downloadImages,
  }),
}))

vi.mock('../../api/client', () => ({
  api: {
    getVolumeCovers: mocks.getVolumeCovers,
    openExternal: mocks.openExternal,
  },
}))

import BookDetailPage from '../BookDetailPage'
import { useToastStore } from '../../stores/toastStore'

let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.book.volumes = {}
  mocks.getVolumeCovers.mockResolvedValue({ covers: {} })
  mocks.openExternal.mockResolvedValue(undefined)
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('BookDetailPage', () => {
  it('opens the corresponding original detail page through the external-link boundary', async () => {
    await act(async () => root.render(
      <MemoryRouter
        initialEntries={['/book/3057']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/book/:id" element={<BookDetailPage />} />
        </Routes>
      </MemoryRouter>,
    ))

    const sourceLink = [...container.querySelectorAll('a')]
      .find((item) => item.textContent?.includes('在原网站查看'))
    expect(sourceLink?.getAttribute('href')).toBe('https://www.wenku8.net/book/3057.htm')

    await act(async () => {
      sourceLink?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(mocks.openExternal).toHaveBeenCalledWith('https://www.wenku8.net/book/3057.htm')
  })

  it('shows one warning and offers deterministic retry and search actions', async () => {
    await act(async () => root.render(
      <MemoryRouter
        initialEntries={['/book/3057']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/book/:id" element={<BookDetailPage />} />
          <Route path="/search" element={<div>检索页</div>} />
        </Routes>
      </MemoryRouter>,
    ))

    expect(container.textContent).toContain('该作品暂未提供可下载的分卷')
    expect(useToastStore.getState().items).toHaveLength(1)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '暂无可下载分卷',
    })

    const retry = [...container.querySelectorAll('button')]
      .find((item) => item.textContent === '重新加载')
    await act(async () => retry?.click())
    expect(mocks.fetchBook).toHaveBeenNthCalledWith(1, '3057')
    expect(mocks.fetchBook).toHaveBeenNthCalledWith(2, '3057', { revalidate: true })

    const backToSearch = [...container.querySelectorAll('button')]
      .find((item) => item.textContent === '返回检索')
    await act(async () => backToSearch?.click())
    expect(container.textContent).toContain('检索页')
    expect(useToastStore.getState().items).toHaveLength(1)
  })

  it('enqueues selected volumes immediately and lets each task resolve its cover later', async () => {
    mocks.book.volumes = { '第一卷': [], '第二卷': [] }
    mocks.getVolumeCovers.mockResolvedValue({
      covers: {
        '第一卷': 'https://example.com/volume-1.jpg',
        '第二卷': 'https://example.com/volume-2.jpg',
      },
    })
    await act(async () => root.render(
      <MemoryRouter
        initialEntries={['/book/3057']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/book/:id" element={<BookDetailPage />} />
          <Route path="/download" element={<div>下载页</div>} />
        </Routes>
      </MemoryRouter>,
    ))

    const dividedTab = [...container.querySelectorAll('button')]
      .find((item) => item.textContent === '分卷下载')
    await act(async () => dividedTab?.click())
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    await act(async () => checkboxes.forEach((checkbox) => checkbox.click()))
    const download = [...container.querySelectorAll('button')]
      .find((item) => item.textContent?.includes('下载选中的 2 卷'))
    await act(async () => {
      download?.click()
      await Promise.resolve()
    })

    expect(mocks.getVolumeCovers).not.toHaveBeenCalled()
    expect(mocks.downloadEpub.mock.calls).toEqual([
      ['3057', '测试作品', 'https://example.com/book.jpg', '第一卷'],
      ['3057', '测试作品', 'https://example.com/book.jpg', '第二卷'],
    ])
    expect(container.textContent).toContain('下载页')
  })
})
