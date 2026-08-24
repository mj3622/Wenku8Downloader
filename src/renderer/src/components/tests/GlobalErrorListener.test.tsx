// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import GlobalErrorListener from '../GlobalErrorListener'
import { useToastStore } from '../../stores/toastStore'

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
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('GlobalErrorListener', () => {
  it('turns unhandled errors into a generic user-visible toast', async () => {
    await act(async () => root.render(<GlobalErrorListener />))

    await act(async () => {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'Error: secret IPC failure at C:\\Users\\tester',
      }))
    })

    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'error',
      title: '应用遇到了一点问题',
      message: '当前操作未能完成，请重试；如果仍然失败，请重启应用。',
    })
    expect(JSON.stringify(useToastStore.getState().items)).not.toContain('secret IPC')
  })
})
