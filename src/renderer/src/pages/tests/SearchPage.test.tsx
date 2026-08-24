// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  searchAuthor: vi.fn(),
  searchTitle: vi.fn(),
}))
vi.mock('../../api/client', () => ({ api: mocks }))

import SearchPage from '../SearchPage'
import { useSearchStore } from '../../stores/searchStore'
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
  mocks.searchAuthor.mockResolvedValue({ results: [] })
  mocks.searchTitle.mockResolvedValue({ results: [] })
  useSearchStore.setState({
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
    lastQuery: null,
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
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <SearchPage />
      </MemoryRouter>,
    )
  })
}

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
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
    const input = container.querySelector('input[placeholder="例如：败犬女主"]') as HTMLInputElement
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
    const input = container.querySelector('input[placeholder="例如：败犬女主"]') as HTMLInputElement
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

  it('warns and returns to the default tab for an invalid route tab', async () => {
    await renderPage('/search?tab=unsupported')

    expect(container.textContent).toContain('编号检索')
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '检索方式无效',
    })
  })

  it('does not submit another search from Enter while a request is pending', async () => {
    mocks.searchTitle.mockReturnValue(new Promise(() => undefined))
    await renderPage()
    await act(async () => button('书名检索').click())
    const input = container.querySelector('input[placeholder="例如：败犬女主"]') as HTMLInputElement
    await setValue(input, '测试作品')
    await act(async () => button('查询').click())

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(mocks.searchTitle).toHaveBeenCalledTimes(1)
    expect(input.disabled).toBe(true)
  })
})
