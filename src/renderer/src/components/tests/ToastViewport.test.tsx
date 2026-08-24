// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import ToastViewport from '../ToastViewport'
import { toast, useToastStore } from '../../stores/toastStore'

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
  vi.useFakeTimers()
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('ToastViewport', () => {
  it('renders accessible roles, a recovery action, and a close button', async () => {
    toast.error({
      title: '登录状态已失效',
      message: '请重新登录。',
      action: { label: '前往配置', href: '#/config' },
    })
    toast.info({ title: '下载已开始', message: '可在下载页查看进度。' })

    await act(async () => root.render(<ToastViewport />))

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(container.querySelector<HTMLAnchorElement>('a[href="#/config"]')?.textContent)
      .toBe('前往配置')

    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭提示：登录状态已失效"]',
    )
    expect(close).not.toBeNull()
    await act(async () => close?.click())
    expect(container.textContent).not.toContain('登录状态已失效')
  })

  it('pauses dismissal while keyboard focus is inside a toast', async () => {
    toast.error({ title: '操作失败', message: '请稍后重试。' })
    await act(async () => root.render(<ToastViewport />))
    const close = container.querySelector<HTMLButtonElement>('button[aria-label^="关闭提示"]')
    expect(close).not.toBeNull()

    await act(async () => close?.focus())
    await act(async () => vi.advanceTimersByTime(8_000))
    expect(container.textContent).toContain('操作失败')

    await act(async () => close?.blur())
    await act(async () => vi.advanceTimersByTime(7_000))
    expect(container.textContent).not.toContain('操作失败')
  })
})
