// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { DiscoverySection } from '../../../../shared/ipc-types'
import HorizontalBookShelf from '../HorizontalBookShelf'

const section: DiscoverySection = {
  key: 'daily-hot',
  title: '今日热榜',
  moreRanking: 'dayvisit',
  books: [{ id: '1', title: '作品一', cover: 'https://example.com/1.jpg', rank: 1 }],
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

beforeEach(async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<MemoryRouter><HorizontalBookShelf section={section} /></MemoryRouter>)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('HorizontalBookShelf', () => {
  it('links the heading action to the complete ranking', () => {
    expect(container.textContent).toContain('今日热榜')
    expect(container.querySelector('a[href="/discover/ranking/dayvisit?page=1"]')).not.toBeNull()
    expect(container.querySelector('a[href="/book/1"]')).not.toBeNull()
  })

  it('turns a vertical wheel gesture into horizontal movement while content remains', () => {
    const shelf = container.querySelector<HTMLElement>('[data-horizontal-shelf]')!
    Object.defineProperties(shelf, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, writable: true, value: 100 },
    })
    const event = new WheelEvent('wheel', { deltaY: 80, cancelable: true })

    shelf.dispatchEvent(event)

    expect(shelf.scrollLeft).toBe(180)
    expect(event.defaultPrevented).toBe(true)
  })

  it('releases the wheel to page scrolling at the shelf edge', () => {
    const shelf = container.querySelector<HTMLElement>('[data-horizontal-shelf]')!
    Object.defineProperties(shelf, {
      clientWidth: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 900 },
      scrollLeft: { configurable: true, writable: true, value: 600 },
    })
    const event = new WheelEvent('wheel', { deltaY: 80, cancelable: true })

    shelf.dispatchEvent(event)

    expect(shelf.scrollLeft).toBe(600)
    expect(event.defaultPrevented).toBe(false)
  })
})
