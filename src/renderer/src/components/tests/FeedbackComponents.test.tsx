// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import LoadingSpinner from '../LoadingSpinner'
import StatusAlert from '../StatusAlert'

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

describe('shared feedback components', () => {
  it('announces errors assertively and non-errors politely', async () => {
    await act(async () => root.render(<StatusAlert type="error" message="保存失败" />))
    expect(container.querySelector('[role="alert"]')).not.toBeNull()

    await act(async () => root.render(<StatusAlert type="success" message="保存成功" />))
    expect(container.querySelector('[role="status"]')).not.toBeNull()
  })

  it('keeps persistent feedback visible without announcing a duplicate toast', async () => {
    await act(async () => root.render(
      <StatusAlert type="error" message="保存失败" announce={false} />,
    ))

    expect(container.textContent).toContain('保存失败')
    expect(container.querySelector('[role]')).toBeNull()
  })

  it('announces loading state without exposing the decorative icon', async () => {
    await act(async () => root.render(<LoadingSpinner text="正在查询" />))

    const status = container.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-busy')).toBe('true')
    expect(status?.textContent).toContain('正在查询')
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
})
