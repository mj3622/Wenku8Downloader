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

    expect(container.textContent).toContain('页面不存在')
    expect(container.textContent).toContain('返回首页')
    expect(container.querySelector('a[href="#/"]')).not.toBeNull()
    expect(useToastStore.getState().items).toHaveLength(1)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '页面不存在',
      action: { href: '#/' },
    })
  })
})
