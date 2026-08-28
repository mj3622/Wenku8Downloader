// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import BookCover from '../BookCover'

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

describe('BookCover', () => {
  it('keeps primary covers eager and allows long lists to opt into lazy loading', async () => {
    await act(async () => root.render(
      <BookCover src="https://example.com/cover.jpg" title="测试作品" />,
    ))

    expect(container.querySelector('img')?.getAttribute('loading')).toBe('eager')

    await act(async () => root.render(
      <BookCover
        src="https://example.com/cover.jpg"
        title="测试作品"
        loading="lazy"
      />,
    ))
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('img')?.getAttribute('decoding')).toBe('async')
  })

  it('shows a readable placeholder after two retries fail', async () => {
    await act(async () => root.render(
      <BookCover src="https://example.com/cover.jpg" title="测试作品" className="w-10 h-14" />,
    ))

    for (let attempt = 0; attempt < 3; attempt++) {
      const image = container.querySelector('img')
      expect(image).not.toBeNull()
      await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))
    }

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('封面暂不可用')
    expect(container.querySelector('[aria-label="测试作品的封面暂不可用"]')).not.toBeNull()
  })

  it('uses an ampersand when retrying a cover URL that already has a query', async () => {
    await act(async () => root.render(
      <BookCover src="https://example.com/cover.jpg?size=small" title="测试作品" />,
    ))

    const image = container.querySelector('img')
    await act(async () => image?.dispatchEvent(new Event('error', { bubbles: true })))

    expect(image?.getAttribute('src')).toBe(
      'https://example.com/cover.jpg?size=small&retry=1',
    )
  })
})
