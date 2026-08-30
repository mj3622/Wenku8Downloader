// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  searchAuthor: vi.fn(),
  searchTitle: vi.fn(),
}))
vi.mock('../../api/client', () => ({ api: mocks }))

import SearchPage from '../SearchPage'
import { useSearchStore } from '../../stores/searchStore'
import { DEFAULT_CATALOG_QUERY, useCatalogStore } from '../../stores/catalogStore'
import { useToastStore } from '../../stores/toastStore'

function BookDetailStub() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>返回</button>
}

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
  mocks.searchAuthor.mockResolvedValue({
    status: 'ok', results: [], fetchedAt: 1, cached: false,
  })
  mocks.searchTitle.mockResolvedValue({
    status: 'ok', results: [], fetchedAt: 1, cached: false,
  })
  mocks.getCatalog.mockImplementation(async (query) => ({
    query,
    books: [],
    page: query.page,
    totalPages: 1,
    fetchedAt: 1,
    stale: false,
  }))
  useSearchStore.setState({
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
    lastType: null,
    lastQuery: null,
    retryAt: null,
    cached: false,
  })
  useToastStore.getState().clear()
  useCatalogStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

async function renderPage(entry = '/search'): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter
        initialEntries={[entry]}
      >
        <Routes>
          <Route path="/search" element={<SearchPage />} />
          <Route path="/book/:id" element={<BookDetailStub />} />
        </Routes>
      </MemoryRouter>,
    )
  })
}

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')]
    .find((element) => !element.closest('[hidden]') && element.textContent?.includes(text))
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

async function setValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SearchPage', () => {
  it('orders find-book modes by browse, title, author, and id with browse selected by default', async () => {
    await renderPage()

    const group = container.querySelector('[role="tablist"][aria-label="找书方式"]')
    expect(group).not.toBeNull()
    expect([...group!.querySelectorAll('button')].map((element) => element.textContent)).toEqual([
      '浏览',
      '书名',
      '作者',
      '编号',
    ])
    expect(button('浏览').getAttribute('aria-selected')).toBe('true')
    expect(button('作者').getAttribute('aria-selected')).toBe('false')
    expect(mocks.getCatalog).toHaveBeenCalledWith(DEFAULT_CATALOG_QUERY, false)
  })

  it('shows the same initial guidance on the id search tab', async () => {
    await renderPage()
    await act(async () => button('编号').click())

    expect(container.textContent).toContain('输入作品编号开始检索')
    expect(container.textContent).toContain('例如：3057')
  })

  it('shows inline validation for empty author searches', async () => {
    await renderPage()
    await act(async () => button('作者').click())
    await act(async () => button('查询').click())

    expect(container.textContent).toContain('请输入作者名')
    expect(mocks.searchAuthor).not.toHaveBeenCalled()
  })

  it('distinguishes a completed zero-result search from the initial prompt', async () => {
    await renderPage()
    await act(async () => button('书名').click())
    const input = container.querySelector('input[placeholder="例如：败犬"]') as HTMLInputElement
    await setValue(input, '不存在的作品')
    await act(async () => {
      button('查询').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.searchTitle).toHaveBeenCalledWith('不存在的作品')
    expect(container.textContent).toContain('没有找到与“不存在的作品”相关的作品')
    expect(container.textContent).not.toContain('输入书名开始搜索')
  })

  it('keeps zero-result copy tied to the last submitted search', async () => {
    await renderPage()
    await act(async () => button('书名').click())
    const input = container.querySelector('input[placeholder="例如：败犬"]') as HTMLInputElement
    await setValue(input, '第一次搜索')
    await act(async () => {
      button('查询').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    await setValue(input, '尚未提交的新内容')

    expect(container.textContent).toContain('没有找到与“第一次搜索”相关的作品')
    expect(container.textContent).not.toContain('没有找到与“尚未提交的新内容”相关的作品')
  })

  it('restores the previous result page after returning from book details', async () => {
    mocks.searchTitle.mockResolvedValue({
      status: 'ok',
      results: [{ id: '3057', title: '败北女角太多了！', cover: '' }],
      fetchedAt: 1,
      cached: false,
    })
    await renderPage()
    await act(async () => button('书名').click())
    const input = container.querySelector('input[placeholder="例如：败犬"]') as HTMLInputElement
    await setValue(input, '败犬女主')
    await act(async () => {
      button('查询').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => button('查看详情').click())

    expect(container.textContent).toBe('返回')
    await act(async () => button('返回').click())

    expect(button('书名').getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('败北女角太多了！')
    expect((container.querySelector('input[placeholder="例如：败犬"]') as HTMLInputElement).value)
      .toBe('败犬女主')
  })

  it('restores the id search tab after returning from book details', async () => {
    await renderPage()
    await act(async () => button('编号').click())
    const input = container.querySelector(
      'input[placeholder^="例如：3057"]',
    ) as HTMLInputElement
    await setValue(input, '3057')
    await act(async () => button('查询').click())

    expect(container.textContent).toBe('返回')
    await act(async () => button('返回').click())

    expect(button('编号').getAttribute('aria-selected')).toBe('true')
  })

  it('warns and returns to the default tab for an invalid route tab', async () => {
    await renderPage('/search?tab=unsupported')

    expect(button('浏览').getAttribute('aria-selected')).toBe('true')
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '找书条件已调整',
    })
  })

  it('restores and runs an author search from a detail-page route', async () => {
    await renderPage('/search?tab=author&q=%E6%B5%8B%E8%AF%95%E4%BD%9C%E8%80%85')

    expect(button('作者').getAttribute('aria-selected')).toBe('true')
    expect(mocks.searchAuthor).toHaveBeenCalledWith('测试作者')
    expect((container.querySelector('input[placeholder="例如：三上库太"]') as HTMLInputElement).value)
      .toBe('测试作者')
  })

  it('does not submit another search from Enter while a request is pending', async () => {
    mocks.searchTitle.mockReturnValue(new Promise(() => undefined))
    await renderPage()
    await act(async () => button('书名').click())
    const input = container.querySelector('input[placeholder="例如：败犬"]') as HTMLInputElement
    await setValue(input, '测试作品')
    await act(async () => button('查询').click())

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(mocks.searchTitle).toHaveBeenCalledTimes(1)
    expect(input.disabled).toBe(true)
  })

  it('disables search with an accessible countdown until the cooldown expires', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    useSearchStore.setState({ retryAt: 12_500, lastType: 'title' })
    await renderPage('/search?tab=title')

    expect(button('3 秒后重试').disabled).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent)
      .toContain('原站限制了搜索频率')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(button('查询').disabled).toBe(false)
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('restores catalog filters and pagination from the route query', async () => {
    await renderPage('/search?publisher=10&initial=A&status=completed&animation=all&sort=lastupdate&page=2')

    expect(mocks.getCatalog).toHaveBeenCalledWith({
      publisher: '10',
      initial: 'A',
      status: 'completed',
      animation: 'all',
      sort: 'lastupdate',
      page: 2,
    }, false)
    expect((container.querySelector('#catalog-publisher') as HTMLSelectElement).value).toBe('10')
    expect((container.querySelector('#catalog-initial') as HTMLSelectElement).value).toBe('A')
  })

  it('accepts detail-page browse mode and restores a tag filter', async () => {
    await renderPage('/search?mode=browse&tag=%E6%A0%A1%E5%9B%AD')

    expect(button('浏览').getAttribute('aria-selected')).toBe('true')
    expect(mocks.getCatalog).toHaveBeenCalledWith({
      ...DEFAULT_CATALOG_QUERY,
      tag: '校园',
    }, false)
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('shows catalog metadata, empty results, and a retry action', async () => {
    mocks.getCatalog.mockResolvedValueOnce({
      query: DEFAULT_CATALOG_QUERY,
      books: [{
        id: '3057', title: '败北女角太多了！', cover: '', author: '雨森焚火',
        tags: '校园 青春 恋爱', desc: '平常担任班上背景人物的我',
      }],
      page: 1,
      totalPages: 1,
      fetchedAt: 1,
      stale: false,
    })
    await renderPage()
    expect(container.textContent).toContain('校园')
    expect(container.textContent).toContain('平常担任班上背景人物的我')

    mocks.getCatalog.mockRejectedValueOnce(new Error('offline'))
    await act(async () => button('刷新结果').click())
    expect(container.textContent).toContain('重新加载')
  })

  it('normalizes invalid route values and warns only once', async () => {
    await renderPage('/search?publisher=999&sort=unknown&page=0')

    expect(mocks.getCatalog).toHaveBeenCalledWith(DEFAULT_CATALOG_QUERY, false)
    expect(useToastStore.getState().items.filter(item => item.title === '找书条件已调整'))
      .toHaveLength(1)
  })
})
