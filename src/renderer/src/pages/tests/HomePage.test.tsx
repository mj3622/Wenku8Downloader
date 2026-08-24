// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ openExternal: vi.fn() }))
vi.mock('../../api/client', () => ({ api: mocks }))

import HomePage from '../HomePage'
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

beforeEach(async () => {
  vi.clearAllMocks()
  useToastStore.getState().clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <HomePage />
    </MemoryRouter>,
  ))
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('HomePage', () => {
  it('shows a safe toast when an external link cannot be opened', async () => {
    mocks.openExternal.mockRejectedValue(new Error('Error: IPC shell failure C:\\Users\\tester'))
    const link = [...container.querySelectorAll('a')]
      .find((element) => element.textContent?.includes('GitHub 仓库'))
    expect(link).toBeTruthy()

    await act(async () => {
      link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'error',
      title: '无法打开链接',
    })
    expect(JSON.stringify(useToastStore.getState().items)).not.toContain('IPC')
  })
})
