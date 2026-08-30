// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import App from '../App'
import { useToastStore } from '../stores/toastStore'

let container: HTMLDivElement
let root: Root
const originalElectronApi = window.electronAPI
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
  useToastStore.getState().clear()
  window.location.hash = '#/missing-page'
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      getDownloadSnapshot: async () => ({
        revision: 0,
        tasks: [],
        legacyImportCompleted: true,
      }),
      importLegacyDownloadHistory: async () => ({
        revision: 1,
        tasks: [],
        legacyImportCompleted: true,
      }),
      onDownloadStateChanged: () => () => undefined,
      getDiscoveryHome: async () => ({
        sections: [],
        fetchedAt: Date.now(),
        stale: false,
      }),
    } as unknown as Window['electronAPI'],
  })
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.location.hash = ''
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: originalElectronApi,
  })
})

describe('App routing', () => {
  it('shows a recoverable page instead of a blank screen for unknown routes', async () => {
    await act(async () => root.render(<App />))

    expect(container.textContent).toContain('轻小说文库下载器')
    expect(container.textContent).toContain('页面不存在')
    expect(container.querySelector('a[href="#/discover"]')?.textContent).toContain('发现')
    expect(container.textContent).toContain('返回发现')
    expect(useToastStore.getState().items).toHaveLength(0)
  })

  it('uses discovery as the default renderer route', async () => {
    window.location.hash = '#/'

    await act(async () => root.render(<App />))

    expect(window.location.hash).toBe('#/discover')
    expect(container.querySelector('h1')?.textContent).toBe('发现')
  })

  it('keeps project information available after the primary navigation', async () => {
    window.location.hash = '#/about'

    await act(async () => root.render(<App />))

    const labels = [...container.querySelectorAll('aside nav a')]
      .map(link => link.textContent?.trim())
    expect(labels).toEqual(['发现', '找书', '书架', '下载', '配置', '项目介绍'])
    expect(container.querySelector('a[href="#/about"]')).not.toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('轻小说文库下载器')
  })
})
