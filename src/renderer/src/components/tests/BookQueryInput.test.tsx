// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import BookQueryInput from '../BookQueryInput'

let container: HTMLDivElement
let root: Root
const onQuery = vi.fn()
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
  onQuery.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<BookQueryInput label="作品编号" onQuery={onQuery} />)
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function setValue(value: string): Promise<void> {
  const input = container.querySelector('input') as HTMLInputElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit(): Promise<void> {
  const button = container.querySelector('button') as HTMLButtonElement
  await act(async () => button.click())
}

describe('BookQueryInput', () => {
  it('shows a field error instead of silently ignoring an empty submission', async () => {
    await submit()

    expect(container.textContent).toContain('请输入作品编号或作品链接')
    expect(container.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('rejects malformed and overlong identifiers with an understandable hint', async () => {
    await setValue('not-a-book')
    await submit()

    expect(container.textContent).toContain('请输入 1 至 12 位作品编号')
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('extracts a valid identifier from a Wenku8 work link', async () => {
    await setValue('https://www.wenku8.net/book/3057.htm')
    await submit()

    expect(onQuery).toHaveBeenCalledWith('3057')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})
