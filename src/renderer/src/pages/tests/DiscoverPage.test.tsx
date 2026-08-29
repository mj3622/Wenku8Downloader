// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveryHome } from '../../../../shared/ipc-types'
import DiscoverPage from '../DiscoverPage'
import { useDiscoveryStore } from '../../stores/discoveryStore'

const home: DiscoveryHome = {
  sections: [
    {
      key: 'new-books',
      title: '新书风云榜',
      moreRanking: 'postdate',
      books: [{ id: '101', title: '新作', cover: 'https://example.com/101.jpg' }],
    },
    {
      key: 'daily-hot',
      title: '今日热榜',
      moreRanking: 'dayvisit',
      books: [{ id: '202', title: '热门作', cover: 'https://example.com/202.jpg', rank: 1 }],
    },
  ],
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
  useDiscoveryStore.setState({ home })
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
  it('uses compact cover shelves and sends each more action to a full ranking', async () => {
    await act(async () => {
      root.render(<MemoryRouter><DiscoverPage /></MemoryRouter>)
    })

    expect(container.textContent).toContain('发现')
    expect(container.textContent).toContain('新书风云榜')
    expect(container.textContent).toContain('今日热榜')
    expect(container.querySelector('a[href="/discover/ranking/postdate?page=1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/discover/ranking/dayvisit?page=1"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-horizontal-shelf]')).toHaveLength(2)
  })
})
