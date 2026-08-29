// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { RankingPage as RankingPageData } from '../../../../shared/ipc-types'
import RankingPage from '../RankingPage'
import { rankingCacheKey, useDiscoveryStore } from '../../stores/discoveryStore'

const ranking: RankingPageData = {
  type: 'allvisit',
  title: '总排行榜',
  page: 2,
  totalPages: 9,
  books: [{ id: '101', title: '榜单作品', cover: 'https://example.com/101.jpg', rank: 21 }],
  fetchedAt: 1,
  stale: false,
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
  useDiscoveryStore.getState().clear()
  useDiscoveryStore.setState({
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
  it('shows the selected complete ranking with traditional pagination', async () => {
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
    expect(container.textContent).toContain('榜单作品')
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('2')
    expect(container.querySelector('a[aria-label="上一页"]')?.getAttribute('href')).toBe('/discover/ranking/allvisit?page=1')
    expect(container.querySelector('a[aria-label="下一页"]')?.getAttribute('href')).toBe('/discover/ranking/allvisit?page=3')
  })
})
