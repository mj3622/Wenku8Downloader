// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchBook: vi.fn(),
  clear: vi.fn(),
  downloadEpub: vi.fn(),
  downloadImages: vi.fn(),
}))

vi.mock('../../stores/bookStore', () => ({
  useBookStore: () => ({
    book: {
      book_id: '3057',
      basic_info: { 标题: '测试作品', 作者: '测试作者', cover: '' },
      volumes: {},
    },
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
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('BookDetailPage empty volumes', () => {
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
    expect(mocks.fetchBook).toHaveBeenCalledTimes(2)

    const backToSearch = [...container.querySelectorAll('button')]
      .find((item) => item.textContent === '返回检索')
    await act(async () => backToSearch?.click())
    expect(container.textContent).toContain('检索页')
    expect(useToastStore.getState().items).toHaveLength(1)
  })
})
