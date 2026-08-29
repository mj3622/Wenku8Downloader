// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadStateEvent } from '../../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({
  getDownloadSnapshot: vi.fn(),
  importLegacyDownloadHistory: vi.fn(),
  onDownloadStateChanged: vi.fn(),
  unsubscribe: vi.fn(),
  listener: undefined as ((event: DownloadStateEvent) => void) | undefined,
}))

vi.mock('../../api/client', () => ({
  api: {
    getDownloadSnapshot: mocks.getDownloadSnapshot,
    importLegacyDownloadHistory: mocks.importLegacyDownloadHistory,
    onDownloadStateChanged: mocks.onDownloadStateChanged,
  },
}))

import DownloadStateListener from '../DownloadStateListener'
import { useDownloadStore } from '../../stores/downloadStore'
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
  vi.clearAllMocks()
  localStorage.clear()
  useToastStore.getState().clear()
  useDownloadStore.setState({
    tasks: [],
    revision: -1,
    initialized: false,
    loading: true,
    error: undefined,
    storageWarning: undefined,
    lastTransitionRevision: -1,
  })
  mocks.listener = undefined
  mocks.getDownloadSnapshot.mockResolvedValue({
    revision: 1,
    tasks: [],
    legacyImportCompleted: true,
  })
  mocks.importLegacyDownloadHistory.mockResolvedValue({
    revision: 2,
    tasks: [],
    legacyImportCompleted: true,
  })
  mocks.onDownloadStateChanged.mockImplementation((listener) => {
    mocks.listener = listener
    return mocks.unsubscribe
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('DownloadStateListener', () => {
  it('subscribes before requesting the initial snapshot and cleans up', async () => {
    await act(async () => root.render(<DownloadStateListener />))

    await vi.waitFor(() => expect(useDownloadStore.getState().initialized).toBe(true))
    expect(mocks.onDownloadStateChanged.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.getDownloadSnapshot.mock.invocationCallOrder[0])

    await act(async () => root.unmount())
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })

  it('keeps a newer live event when the initial request resolves later', async () => {
    let resolveSnapshot!: (snapshot: {
      revision: number
      tasks: []
      legacyImportCompleted: boolean
    }) => void
    mocks.getDownloadSnapshot.mockReturnValue(new Promise((resolve) => {
      resolveSnapshot = resolve
    }))
    await act(async () => root.render(<DownloadStateListener />))

    await act(async () => {
      mocks.listener?.({
        snapshot: { revision: 4, tasks: [], legacyImportCompleted: true },
      })
      resolveSnapshot({ revision: 3, tasks: [], legacyImportCompleted: true })
    })

    expect(useDownloadStore.getState().revision).toBe(4)
  })

  it('deletes legacy local history only after an acknowledged import', async () => {
    localStorage.setItem('wenku8-download-history', JSON.stringify({
      state: { tasks: [{ id: 'dl-1720000000000-1' }] },
      version: 2,
    }))
    mocks.getDownloadSnapshot.mockResolvedValue({
      revision: 1,
      tasks: [],
      legacyImportCompleted: false,
    })

    await act(async () => root.render(<DownloadStateListener />))

    await vi.waitFor(() => expect(mocks.importLegacyDownloadHistory).toHaveBeenCalledWith([
      { id: 'dl-1720000000000-1' },
    ]))
    expect(localStorage.getItem('wenku8-download-history')).toBeNull()
  })

  it('retains legacy local history when import fails', async () => {
    localStorage.setItem('wenku8-download-history', JSON.stringify({
      state: { tasks: [] },
      version: 2,
    }))
    mocks.getDownloadSnapshot.mockResolvedValue({
      revision: 1,
      tasks: [],
      legacyImportCompleted: false,
    })
    mocks.importLegacyDownloadHistory.mockRejectedValue(new Error('state write failed'))

    await act(async () => root.render(<DownloadStateListener />))

    await vi.waitFor(() => expect(useDownloadStore.getState().error).toBeDefined())
    expect(localStorage.getItem('wenku8-download-history')).not.toBeNull()
  })

  it('retains malformed legacy local history instead of importing an empty list', async () => {
    localStorage.setItem('wenku8-download-history', '{invalid')
    mocks.getDownloadSnapshot.mockResolvedValue({
      revision: 1,
      tasks: [],
      legacyImportCompleted: false,
    })

    await act(async () => root.render(<DownloadStateListener />))

    await vi.waitFor(() => expect(useDownloadStore.getState().error).toBeDefined())
    expect(mocks.importLegacyDownloadHistory).not.toHaveBeenCalled()
    expect(localStorage.getItem('wenku8-download-history')).toBe('{invalid')
  })

  it('keeps synchronized state usable when acknowledged legacy cleanup fails', async () => {
    localStorage.setItem('wenku8-download-history', JSON.stringify({
      state: { tasks: [] },
      version: 2,
    }))
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    await act(async () => root.render(<DownloadStateListener />))

    await vi.waitFor(() => expect(useToastStore.getState().items).toHaveLength(1))
    expect(useDownloadStore.getState()).toMatchObject({
      initialized: true,
      loading: false,
      error: undefined,
    })
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: 'warning',
      title: '旧下载记录未能清理',
    })
  })
})
