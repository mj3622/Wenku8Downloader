// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveryBook, DiscoverySection } from '../../../../shared/ipc-types'
import {
  DiscoveryCoverSection,
  DiscoveryRankingSection,
} from '../DiscoverySection'

function books(count: number, ranked = false): DiscoveryBook[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `作品${index + 1}`,
    cover: `https://example.com/${index + 1}.jpg`,
    ...(ranked ? { rank: index + 1 } : {}),
  }))
}

const coverSection: DiscoverySection = {
  key: 'new-books',
  title: '新书风云榜',
  moreRanking: 'postdate',
  books: books(8),
}

const rankingSection: DiscoverySection = {
  key: 'daily-hot',
  title: '今日热榜',
  moreRanking: 'dayvisit',
  books: books(10, true),
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
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('DiscoverySection', () => {
  it('lays out all eight shelf books without a horizontal scroller', async () => {
    await act(async () => {
      root.render(<MemoryRouter><DiscoveryCoverSection section={coverSection} /></MemoryRouter>)
    })

    expect(container.querySelector('[data-discovery-cover-section]')).not.toBeNull()
    expect(container.querySelectorAll('a[href^="/book/"]')).toHaveLength(8)
    expect(container.querySelector('[data-horizontal-shelf]')).toBeNull()
    expect(container.querySelector('a[href="/discover/ranking/postdate?page=1"]')).not.toBeNull()
    expect(container.querySelector('[data-discovery-cover-grid]')?.getAttribute('style'))
      .toContain('--discovery-columns-compact: 4')
    expect(container.querySelector('[data-discovery-cover-grid]')?.getAttribute('style'))
      .toContain('--discovery-columns-wide: 8')
  })

  it('balances longer shelves so wrapped rows use the available width', async () => {
    const longSection = { ...coverSection, books: books(15) }

    await act(async () => {
      root.render(<MemoryRouter><DiscoveryCoverSection section={longSection} /></MemoryRouter>)
    })

    expect(container.querySelector('[data-discovery-cover-grid]')?.getAttribute('style'))
      .toContain('--discovery-columns-compact: 5')
    expect(container.querySelector('[data-discovery-cover-grid]')?.getAttribute('style'))
      .toContain('--discovery-columns-wide: 8')
  })

  it('uses three cover leaders followed by seven compact ranking rows', async () => {
    await act(async () => {
      root.render(<MemoryRouter><DiscoveryRankingSection section={rankingSection} /></MemoryRouter>)
    })

    expect(container.querySelector('[data-discovery-ranking-section]')).not.toBeNull()
    expect(container.querySelectorAll('a[href^="/book/"]')).toHaveLength(10)
    expect(container.textContent).toContain('10')
    expect(container.querySelector('a[href="/discover/ranking/dayvisit?page=1"]')).not.toBeNull()
  })
})
