// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RankingPage as RankingPageData } from '../../../../shared/ipc-types'
import RankingPage from '../RankingPage'
import { rankingCacheKey, useDiscoveryStore } from '../../stores/discoveryStore'

const rankingBooks = Array.from({ length: 20 }, (_, index) => ({
  id: String(index + 101),
  title: `榜单作品${index + 1}`,
  cover: `https://example.com/${index + 101}.jpg`,
  rank: index + 21,
}))

const ranking: RankingPageData = {
  type: 'allvisit',
  title: '总排行榜',
  page: 2,
  totalPages: 9,
  books: rankingBooks,
  fetchedAt: Date.now(),
  stale: false,
}

const loadRanking = useDiscoveryStore.getState().loadRanking

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
  useDiscoveryStore.getState().clear()
  useDiscoveryStore.setState({
    loadRanking,
    rankings: {
      [rankingCacheKey('allvisit', 2)]: {
        data: ranking,
        loading: false,
        refreshing: false,
        error: null,
      },
    },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useDiscoveryStore.getState().clear()
})

describe('RankingPage', () => {
  it('shows all twenty books in the selected complete ranking with traditional pagination', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/discover/ranking/allvisit?page=2']}>
          <Routes>
            <Route path="/discover/ranking/:type" element={<RankingPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('总排行榜')
    expect(container.textContent).not.toContain('第 2 / 9 页')
    expect(container.textContent).not.toContain('本页 20 本')
    expect(container.querySelector('[data-ranking-grid]')?.querySelectorAll('a[href^="/book/"]')).toHaveLength(20)
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('2')
    expect(container.querySelector('a[aria-label="上一页"]')?.getAttribute('href')).toBe('/discover/ranking/allvisit?page=1')
    expect(container.querySelector('a[aria-label="下一页"]')?.getAttribute('href')).toBe('/discover/ranking/allvisit?page=3')
  })

  it('renders twenty placeholders while the fixed ranking page is loading', async () => {
    useDiscoveryStore.setState({
      loadRanking: async () => {},
      rankings: {
        [rankingCacheKey('allvisit', 2)]: {
          data: null,
          loading: true,
          refreshing: false,
          error: null,
        },
      },
    })

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/discover/ranking/allvisit?page=2']}>
          <Routes>
            <Route path="/discover/ranking/:type" element={<RankingPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    expect(container.querySelector('[data-ranking-skeleton]')?.children).toHaveLength(20)
  })

  it('keeps error, empty and disabled refresh states available', async () => {
    useDiscoveryStore.setState({
      loadRanking: async () => {},
      rankings: {
        [rankingCacheKey('allvisit', 2)]: {
          data: { ...ranking, books: [] },
          loading: false,
          refreshing: true,
          error: null,
        },
      },
    })

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/discover/ranking/allvisit?page=2']}>
          <Routes>
            <Route path="/discover/ranking/:type" element={<RankingPage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    expect(container.textContent).toContain('这一页暂时没有作品')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="刷新当前排行榜"]')?.disabled)
      .toBe(true)

    useDiscoveryStore.setState({
      rankings: {
        [rankingCacheKey('allvisit', 2)]: {
          data: null,
          loading: false,
          refreshing: false,
          error: '排行榜加载失败',
        },
      },
    })

    await act(async () => {})

    expect(container.textContent).toContain('排行榜加载失败')
    expect(container.textContent).toContain('重试')
  })
})
