// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getAnnualRanking: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import AnnualRankingPage from '../AnnualRankingPage'
import { useAnnualRankingStore } from '../../stores/annualRankingStore'
import { useToastStore } from '../../stores/toastStore'

function HistoryBackButton() {
  const navigate = useNavigate()
  return <button type="button" data-history-back onClick={() => navigate(-1)}>后退</button>
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
  useAnnualRankingStore.getState().clear()
  useToastStore.getState().clear()
  mocks.getAnnualRanking.mockResolvedValue({
    year: 2026,
    categories: {
      bunko: [{
        rank: 1,
        title: '这是一个用于验证长标题不会撑破年度榜单布局的文库作品名称'.repeat(4),
        bookId: '3057',
      }],
      tankobon: [{ rank: 1, title: '<script>原站缺失作品</script>' }],
    },
    fetchedAt: Date.now(),
    stale: false,
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useAnnualRankingStore.getState().clear()
})

async function renderPage(path = '/discover/annual/2026') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/discover/annual/:year" element={<><AnnualRankingPage /><HistoryBackButton /></>} />
        </Routes>
      </MemoryRouter>,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('AnnualRankingPage', () => {
  it('loads only the selected year and switches categories without another request', async () => {
    await renderPage()

    expect(mocks.getAnnualRanking).toHaveBeenCalledOnce()
    expect(mocks.getAnnualRanking).toHaveBeenCalledWith(2026, false)
    expect(container.querySelector('a[href="/book/3057"]')).not.toBeNull()
    expect(container.textContent).toContain('原站暂无封面')
    expect(container.textContent).toContain('这是一个用于验证长标题')
    const tankobonTab = [...container.querySelectorAll('[role="tab"]')]
      .find(element => element.textContent === '单行本部门')
    await act(async () => {
      tankobonTab?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.getAnnualRanking).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('<script>原站缺失作品</script>')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelectorAll('a[href^="/book/"]')).toHaveLength(0)
    expect(tankobonTab?.getAttribute('aria-selected')).toBe('true')
    expect(tankobonTab?.getAttribute('tabindex')).toBe('0')
  })

  it('switches tabs with the keyboard and moves focus with the active tab', async () => {
    await renderPage()
    const bunkoTab = container.querySelector<HTMLButtonElement>('#annual-ranking-tab-bunko')!
    const tankobonTab = container.querySelector<HTMLButtonElement>('#annual-ranking-tab-tankobon')!
    bunkoTab.focus()

    await act(async () => {
      bunkoTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(tankobonTab.getAttribute('aria-selected')).toBe('true')
    expect(tankobonTab.getAttribute('aria-controls')).toBe('annual-ranking-panel')
    expect(document.activeElement).toBe(tankobonTab)
    expect(container.textContent).toContain('<script>原站缺失作品</script>')
  })

  it('rejects unsupported years before invoking the API', async () => {
    await renderPage('/discover/annual/2027')

    expect(container.textContent).toContain('这个年度榜单不存在')
    expect(mocks.getAnnualRanking).not.toHaveBeenCalled()
  })

  it('keeps loading, error and empty states usable', async () => {
    mocks.getAnnualRanking.mockReturnValueOnce(new Promise(() => {}))
    await renderPage()
    expect(container.querySelector('[aria-label="正在加载年度榜单"]')).not.toBeNull()
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="刷新当前年度榜单"]')?.disabled)
      .toBe(true)

    await act(async () => root.unmount())
    root = createRoot(container)
    useAnnualRankingStore.getState().clear()
    mocks.getAnnualRanking.mockRejectedValueOnce(new Error('年度榜单暂时不可用'))
    await renderPage()
    expect(container.textContent).toContain('年度榜单暂时不可用')
    expect(container.textContent).toContain('重试')

    await act(async () => root.unmount())
    root = createRoot(container)
    useAnnualRankingStore.getState().clear()
    mocks.getAnnualRanking.mockResolvedValueOnce({
      year: 2026,
      categories: { bunko: [], tankobon: [] },
      fetchedAt: Date.now(),
      stale: false,
    })
    await renderPage()
    expect(container.textContent).toContain('这个部门暂时没有可展示的作品')
  })

  it('updates the route by year and restores fresh state when navigating back', async () => {
    mocks.getAnnualRanking.mockImplementation(async (year: number) => ({
      year,
      categories: { bunko: [{ rank: 1, title: `${year} 年作品` }], tankobon: [] },
      fetchedAt: Date.now(),
      stale: false,
    }))
    await renderPage()
    const select = container.querySelector<HTMLSelectElement>('#annual-ranking-year')!
    await act(async () => {
      select.value = '2025'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('这本轻小说真厉害！2025')
    expect(mocks.getAnnualRanking).toHaveBeenCalledWith(2025, false)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-history-back]')?.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('这本轻小说真厉害！2026')
    expect(mocks.getAnnualRanking.mock.calls.filter(([year]) => year === 2026)).toHaveLength(1)
  })
})
