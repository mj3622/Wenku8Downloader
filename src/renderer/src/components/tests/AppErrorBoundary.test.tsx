// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppErrorBoundary from '../AppErrorBoundary'

let container: HTMLDivElement
let root: Root
const reportRendererError = vi.fn()
const originalElectronApi = Object.getOwnPropertyDescriptor(window, 'electronAPI')

function BrokenView(): ReactNode {
  throw new Error('Error: secret IPC failure at C:\\Users\\tester')
}

function RouteAwareView(): ReactNode {
  if (window.location.hash === '#/broken') {
    throw new Error('broken route')
  }
  return <p>首页已恢复</p>
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  reportRendererError.mockClear()
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: { reportRendererError },
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  if (originalElectronApi) {
    Object.defineProperty(window, 'electronAPI', originalElectronApi)
  } else {
    delete (window as Partial<Window>).electronAPI
  }
})

describe('AppErrorBoundary', () => {
  it('shows a safe recovery screen and reports diagnostics through the logger', async () => {
    await act(async () => {
      root.render(
        <AppErrorBoundary>
          <BrokenView />
        </AppErrorBoundary>,
      )
    })

    expect(container.textContent).toContain('页面暂时无法显示')
    expect(container.textContent).toContain('返回首页')
    expect(container.textContent).not.toContain('secret IPC')
    expect(reportRendererError).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      message: expect.stringContaining('secret IPC failure'),
    }))
  })

  it('clears the failed state before returning to the home route', async () => {
    window.location.hash = '#/broken'
    await act(async () => {
      root.render(
        <AppErrorBoundary>
          <RouteAwareView />
        </AppErrorBoundary>,
      )
    })

    const returnHome = [...container.querySelectorAll('a, button')]
      .find((element) => element.textContent === '返回首页')
    expect(returnHome).toBeTruthy()

    await act(async () => {
      returnHome?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(window.location.hash).toBe('#/')
    expect(container.textContent).toContain('首页已恢复')
    expect(container.textContent).not.toContain('页面暂时无法显示')
  })
})
