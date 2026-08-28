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
  it('opens the selected work when its cover is clicked', async () => {
    const onSelect = vi.fn()
    await act(async () => {
      root.render(
        <SearchResultList
          results={[{
            id: '3057',
            title: '测试作品',
            cover: 'https://example.com/cover.jpg',
          }]}
          onSelect={onSelect}
        />,
      )
    })

    await act(async () => {
      container.querySelector('img')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('3057')
  })

  it('separates compact search metadata into readable rows and badges', async () => {
    await act(async () => {
      root.render(
        <SearchResultList
          results={[{
            id: '3057',
            title: '败北女角太多了！',
            cover: '',
            author: '雨森焚火',
            status: '连载中',
            updateTime: '2026-07-19',
            wordCount: '1271K',
            isAnimated: true,
          }]}
          onSelect={vi.fn()}
        />,
      )
    })

    expect(container.textContent).toContain('雨森焚火')
    expect(container.textContent).toContain('连载中')
    expect(container.textContent).toContain('1271K')
    expect(container.textContent).toContain('2026-07-19 更新')
    expect(container.textContent).toContain('已动画化')
  })

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
