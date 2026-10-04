// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadTask } from '../../../../shared/ipc-types'

const mocks = vi.hoisted(() => ({ getDownloadCover: vi.fn() }))
vi.mock('../../api/client', () => ({ api: { getDownloadCover: mocks.getDownloadCover } }))
import DownloadCover from '../DownloadCover'

const cachedCover = 'data:image/png;base64,aW1hZ2U='
const task: DownloadTask = {
  id: '550e8400-e29b-41d4-a716-446655440000', bookId: '123', title: '作品',
  cover: 'https://img.example/volume.png', type: 'epub_volume', volume: '第一卷',
  status: 'downloading', progress: 10, createdAt: 1_000, updatedAt: 2_000, artifacts: [],
}
let container: HTMLDivElement
let root: Root
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const originalActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT

beforeAll(() => { actEnvironment.IS_REACT_ACT_ENVIRONMENT = true })
afterAll(() => {
  if (originalActEnvironment === undefined) delete actEnvironment.IS_REACT_ACT_ENVIRONMENT
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = originalActEnvironment
})
beforeEach(() => {
  mocks.getDownloadCover.mockReset().mockResolvedValue(cachedCover)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('DownloadCover', () => {
  it('renders local image data instead of the remote task URL', async () => {
    await act(async () => root.render(<DownloadCover task={task} title="作品" loading="lazy" />))
    expect(mocks.getDownloadCover).toHaveBeenCalledWith(task.id)
    expect(container.querySelector('img')?.getAttribute('src')).toBe(cachedCover)
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
    expect(container.innerHTML).not.toContain(task.cover)
  })

  it('keeps a placeholder for cache misses and IPC failures', async () => {
    mocks.getDownloadCover.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('cache unavailable'))
    await act(async () => root.render(<DownloadCover task={task} title="作品" />))
    expect(container.querySelector('img')).toBeNull()
    await act(async () => root.render(<DownloadCover task={{ ...task, status: 'completed' }} title="作品" />))
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('作')
  })

  it('refreshes when a download finishes, without reading on every progress event', async () => {
    mocks.getDownloadCover.mockResolvedValueOnce(null)
    await act(async () => root.render(<DownloadCover task={task} title="作品" />))
    await act(async () => root.render(<DownloadCover task={{ ...task, progress: 50 }} title="作品" />))
    expect(mocks.getDownloadCover).toHaveBeenCalledTimes(1)
    await act(async () => root.render(<DownloadCover task={{ ...task, status: 'completed' }} title="作品" />))
    expect(container.querySelector('img')?.getAttribute('src')).toBe(cachedCover)
    expect(mocks.getDownloadCover).toHaveBeenCalledTimes(2)
  })

  it('ignores a stale lookup after the displayed task changes', async () => {
    let resolveOld!: (cover: string) => void
    mocks.getDownloadCover.mockReturnValueOnce(new Promise<string>(resolve => { resolveOld = resolve }))
    await act(async () => root.render(<DownloadCover task={task} title="作品" />))
    await act(async () => root.render(<DownloadCover task={{ ...task, id: 'next-task' }} title="新作品" />))
    await act(async () => resolveOld('data:image/png;base64,b2xk'))
    expect(container.querySelector('img')?.getAttribute('src')).toBe(cachedCover)
  })

  it('does not read a coverless task or update after unmount', async () => {
    await act(async () => root.render(<DownloadCover task={{ ...task, cover: undefined }} title="作品" />))
    expect(mocks.getDownloadCover).not.toHaveBeenCalled()
    let resolveCover!: (cover: string) => void
    mocks.getDownloadCover.mockReturnValueOnce(new Promise<string>(resolve => { resolveCover = resolve }))
    await act(async () => root.render(<DownloadCover task={task} title="作品" />))
    await act(async () => root.render(null))
    await act(async () => resolveCover(cachedCover))
    expect(container.innerHTML).toBe('')
  })
})
