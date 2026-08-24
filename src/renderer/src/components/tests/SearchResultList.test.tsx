// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import SearchResultList from '../SearchResultList'

let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  if (originalActEnvironment === undefined) {
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  } else {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
  }
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

describe('SearchResultList', () => {
  it('replaces a cover with a readable placeholder after retries are exhausted', async () => {
    await act(async () => {
      root.render(
        <SearchResultList
          results={[{
            id: '3057',
            title: '测试作品',
            cover: 'https://example.com/cover.jpg',
          }]}
          onSelect={vi.fn()}
        />,
      )
    })

    for (let attempt = 0; attempt < 3; attempt++) {
      const image = container.querySelector('img')
      expect(image).toBeTruthy()
      await act(async () => {
        image?.dispatchEvent(new Event('error', { bubbles: true }))
      })
    }

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('封面暂不可用')
  })
})
