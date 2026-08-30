// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  searchAuthor: vi.fn(),
  searchTitle: vi.fn(),
}))
vi.mock('../../api/client', () => ({ api: mocks }))

import SearchPage from '../SearchPage'
import { useSearchStore } from '../../stores/searchStore'
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
    .find((element) => element.textContent?.includes(text))
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
  it('orders search methods by title, author, and id with title selected by default', async () => {
    await renderPage()

    const group = container.querySelector('[role="group"][aria-label="检索方式"]')
    expect(group).not.toBeNull()
    expect([...group!.querySelectorAll('button')].map((element) => element.textContent)).toEqual([
      '书名检索',
      '作者检索',
      '编号检索',
    ])
    expect(button('书名检索').getAttribute('aria-pressed')).toBe('true')
    expect(button('作者检索').getAttribute('aria-pressed')).toBe('false')
  })

  it('shows the same initial guidance on the id search tab', async () => {
    await renderPage()
    await act(async () => button('编号检索').click())

    expect(container.textContent).toContain('输入作品编号开始检索')
    expect(container.textContent).toContain('例如：3057')
  })

  it('shows inline validation for empty author searches', async () => {
    await renderPage()
    await act(async () => button('作者检索').click())
    await act(async () => button('查询').click())

    expect(container.textContent).toContain('请输入作者名')
    expect(mocks.searchAuthor).not.toHaveBeenCalled()
  })

  it('distinguishes a completed zero-result search from the initial prompt', async () => {
    await renderPage()
    await act(async () => button('书名检索').click())
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
    await act(async () => button('书名检索').click())
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
    await act(async () => button('书名检索').click())
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

    expect(button('书名检索').getAttribute('aria-pressed')).toBe('true')
    expect(container.textContent).toContain('败北女角太多了！')
    expect((container.querySelector('input[placeholder="例如：败犬"]') as HTMLInputElement).value)
      .toBe('败犬女主')
  })

  it('restores the id search tab after returning from book details', async () => {
    await renderPage()
    await act(async () => button('编号检索').click())
    const input = container.querySelector(
      'input[placeholder^="例如：3057"]',
    ) as HTMLInputElement
    await setValue(input, '3057')
    await act(async () => button('查询').click())

    expect(container.textContent).toBe('返回')
    await act(async () => button('返回').click())

    expect(button('编号检索').getAttribute('aria-pressed')).toBe('true')
  })

  it('warns and returns to the default tab for an invalid route tab', async () => {
    await renderPage('/search?tab=unsupported')

    expect(button('书名检索').getAttribute('aria-pressed')).toBe('true')
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '检索方式无效',
    })
  })

  it('does not submit another search from Enter while a request is pending', async () => {
    mocks.searchTitle.mockReturnValue(new Promise(() => undefined))
    await renderPage()
    await act(async () => button('书名检索').click())
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
    useSearchStore.setState({ retryAt: 12_500 })
    await renderPage()

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
})
