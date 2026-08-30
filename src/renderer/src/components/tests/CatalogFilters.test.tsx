// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogQuery } from '../../../../shared/ipc-types'
import CatalogFilters from '../CatalogFilters'

const query: CatalogQuery = {
  status: 'all',
  animation: 'all',
  sort: 'lastupdate',
  page: 1,
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

describe('CatalogFilters', () => {
  it('uses the shared custom selector for every dropdown and keeps filter behavior', async () => {
    const onChange = vi.fn()
    await act(async () => {
      root.render(
        <CatalogFilters
          query={query}
          loading={false}
          onChange={onChange}
          onReset={vi.fn()}
          onRefresh={vi.fn()}
        />,
      )
    })

    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(4)
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('#catalog-initial')).toBeNull()
    expect(container.querySelector('#catalog-publisher')?.textContent).toBe('全部出版社')
    expect(container.querySelector('#catalog-status')?.textContent).toBe('全部状态')
    expect(container.querySelector('#catalog-animation')?.textContent).toBe('全部作品')
    expect(container.textContent).not.toContain('筛选会自动加载当前结果页')
    expect(container.querySelector('button[aria-label="重置筛选"]')).not.toBeNull()
    expect(container.querySelector('button[aria-label="刷新筛选结果"]')).not.toBeNull()

    const publisher = container.querySelector<HTMLButtonElement>('#catalog-publisher')!
    await act(async () => {
      publisher.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const publisherOption = [...container.querySelectorAll('[role="option"]')]
      .find(option => option.textContent?.includes('电击文库'))!
    await act(async () => {
      publisherOption.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith({
      publisher: '1',
      tag: undefined,
      sort: 'lastupdate',
    })
  })
})
