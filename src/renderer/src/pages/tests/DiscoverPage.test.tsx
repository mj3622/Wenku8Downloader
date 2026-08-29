// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveryBook, DiscoveryHome, RankingType } from '../../../../shared/ipc-types'
import DiscoverPage from '../DiscoverPage'
import { useDiscoveryStore } from '../../stores/discoveryStore'

function books(prefix: string, count: number, ranked = false): DiscoveryBook[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    title: `${prefix}作品${index + 1}`,
    cover: `https://example.com/${prefix}${index + 1}.jpg`,
    ...(ranked ? { rank: index + 1 } : {}),
  }))
}

function section(
  key: string,
  title: string,
  moreRanking: RankingType,
  count: number,
  ranked = false,
) {
  return { key, title, moreRanking, books: books(key, count, ranked) }
}

const home: DiscoveryHome = {
  sections: [
    section('new-books', '新书风云榜', 'postdate', 8),
    section('weekly-recommendations', '本周会员推荐榜', 'weekvote', 8),
    section('daily-hot', '今日热榜', 'dayvisit', 10, true),
    section('monthly-hot', '本月热点', 'monthvisit', 10, true),
    section('most-followed', '最受关注', 'goodnum', 10, true),
    section('recent-updates', '最近更新', 'lastupdate', 8),
    section('animated', '已动画化', 'anime', 8),
    section('latest', '最新入库', 'postdate', 8),
  ],
  fetchedAt: Date.now(),
  stale: false,
}

const loadHome = useDiscoveryStore.getState().loadHome

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
  useDiscoveryStore.setState({ home, loadHome })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  useDiscoveryStore.getState().clear()
})

describe('DiscoverPage', () => {
  it('places the three-column ranking band before the full-width cover grids', async () => {
    await act(async () => {
      root.render(<MemoryRouter><DiscoverPage /></MemoryRouter>)
    })

    expect(container.textContent).toContain('发现')
    expect(container.textContent).toContain('新书风云榜')
    expect(container.textContent).toContain('今日热榜')
    expect(container.querySelector('a[href="/discover/ranking/postdate?page=1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/discover/ranking/dayvisit?page=1"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-discovery-cover-section]')).toHaveLength(5)
    expect(container.querySelectorAll('[data-discovery-ranking-section]')).toHaveLength(3)
    expect(container.querySelectorAll('a[href^="/book/"]')).toHaveLength(70)
    expect(container.querySelector('[data-horizontal-shelf]')).toBeNull()
    const content = container.querySelector('[data-discovery-content]')
    expect(content?.firstElementChild?.hasAttribute('data-discovery-ranking-band')).toBe(true)
  })

  it('matches the fixed layout in loading state', async () => {
    useDiscoveryStore.setState({
      home: null,
      homeLoading: true,
      homeRefreshing: false,
      homeError: null,
      loadHome: async () => {},
    })

    await act(async () => {
      root.render(<MemoryRouter><DiscoverPage /></MemoryRouter>)
    })

    expect(container.querySelector('[aria-label="正在加载发现内容"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-discovery-cover-skeleton]')).toHaveLength(2)
    const skeleton = container.querySelector('[aria-label="正在加载发现内容"]')
    expect(skeleton?.firstElementChild?.hasAttribute('data-discovery-ranking-skeleton')).toBe(true)
  })

  it('keeps error, empty and disabled refresh states available', async () => {
    useDiscoveryStore.setState({
      home: { ...home, sections: [] },
      homeRefreshing: true,
      loadHome: async () => {},
    })

    await act(async () => {
      root.render(<MemoryRouter><DiscoverPage /></MemoryRouter>)
    })

    expect(container.textContent).toContain('暂时没有可展示的发现内容')
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="刷新发现内容"]')?.disabled)
      .toBe(true)

    useDiscoveryStore.setState({
      home: null,
      homeLoading: false,
      homeRefreshing: false,
      homeError: '发现内容加载失败',
    })

    await act(async () => {})

    expect(container.textContent).toContain('发现内容加载失败')
    expect(container.textContent).toContain('重试')
  })
})
