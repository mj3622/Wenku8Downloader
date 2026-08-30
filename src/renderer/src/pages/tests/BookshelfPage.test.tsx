// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getBookshelf: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import BookshelfPage from '../BookshelfPage'
import { useBookshelfStore } from '../../stores/bookshelfStore'
import { useToastStore } from '../../stores/toastStore'

const ENTRY = {
  bookId: '101',
  title: '一个很长但可以正常换行的测试作品名称'.repeat(3),
  author: '林间笔记',
  latestChapter: '第十二章 晚风与远方的灯火'.repeat(2),
  bookmark: '第三章',
  updatedAt: '2026-08-20',
  localState: 'update' as const,
  updateAvailable: true,
}

let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})

beforeEach(() => {
  vi.clearAllMocks()
  useBookshelfStore.getState().clear()
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/bookshelf']}>
        <Routes>
          <Route path="/bookshelf" element={<BookshelfPage />} />
          <Route path="/book/:id" element={<div>作品详情</div>} />
          <Route path="/config" element={<div>配置页</div>} />
        </Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
  })
}

describe('BookshelfPage', () => {
  it('renders long readonly entries and opens the corresponding detail page', async () => {
    mocks.getBookshelf.mockResolvedValue({ entries: [ENTRY], fetchedAt: 1, stale: false })
    await render()

    expect(container.textContent).toContain('本地状态')
    expect(container.textContent).toContain('有更新')
    const row = container.querySelector('section[aria-label="原站书架"] button')
    await act(async () => (row as HTMLButtonElement).click())
    expect(container.textContent).toContain('作品详情')
  })

  it('shows stale and empty states without blocking refresh', async () => {
    mocks.getBookshelf.mockResolvedValue({ entries: [], fetchedAt: 1, stale: true })
    await render()

    expect(container.textContent).toContain('最近缓存的书架')
    expect(container.textContent).toContain('原站书架暂无收藏')
    expect([...container.querySelectorAll('button')].some(button => button.textContent?.includes('刷新书架')))
      .toBe(true)
  })

  it('offers the configuration route when login status is missing', async () => {
    mocks.getBookshelf.mockRejectedValue(new Error('请先刷新登录状态'))
    await render()

    const config = [...container.querySelectorAll('button')]
      .find(button => button.textContent?.includes('前往配置'))
    expect(config).toBeDefined()
    await act(async () => config?.click())
    expect(container.textContent).toContain('配置页')
  })
})
