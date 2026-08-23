import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateDownloadConfig: vi.fn(),
  updateLogConfig: vi.fn(),
  updateCredentials: vi.fn(),
  resetCorruptConfig: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: mocks,
}))

import type { PublicConfigSnapshot } from '../../../shared/config-types'
import { useConfigStore } from './configStore'

const snapshot: PublicConfigSnapshot = {
  download: {
    fullTitle: 'FULL',
    defaultCoverIndex: 0,
    downloadPath: '',
  },
  logging: {
    retentionDays: 30,
    maxFileSizeMb: 100,
    maxTotalSizeMb: 200,
  },
  account: {
    username: 'tester',
    hasPassword: true,
    hasCookies: false,
  },
  health: { state: 'ok' },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getConfig.mockResolvedValue(snapshot)
  useConfigStore.setState({
    snapshot: null,
    loadState: 'idle',
    error: null,
  })
})

describe('configStore', () => {
  it('starts with an explicit idle state', () => {
    expect(useConfigStore.getState()).toMatchObject({
      snapshot: null,
      loadState: 'idle',
      error: null,
    })
  })

  it('loads the server snapshot through loading and ready states', async () => {
    let resolveConfig: ((value: PublicConfigSnapshot) => void) | undefined
    mocks.getConfig.mockReturnValue(new Promise((resolve) => { resolveConfig = resolve }))

    const task = useConfigStore.getState().fetchConfig()
    expect(useConfigStore.getState()).toMatchObject({
      snapshot: null,
      loadState: 'loading',
      error: null,
    })

    resolveConfig?.(snapshot)
    await task
    expect(useConfigStore.getState()).toMatchObject({
      snapshot,
      loadState: 'ready',
      error: null,
    })
  })

  it('preserves the last good snapshot when reloading fails', async () => {
    useConfigStore.setState({ snapshot, loadState: 'ready', error: null })
    mocks.getConfig.mockRejectedValue(new Error('主进程不可用'))

    await useConfigStore.getState().fetchConfig()

    expect(useConfigStore.getState()).toMatchObject({
      snapshot,
      loadState: 'error',
      error: '主进程不可用',
    })
  })

  it('uses the canonical server response after a download update', async () => {
    useConfigStore.setState({ snapshot, loadState: 'ready', error: null })
    const canonical: PublicConfigSnapshot = {
      ...snapshot,
      download: {
        fullTitle: 'OUT',
        defaultCoverIndex: 3,
        downloadPath: 'D:\\Canonical',
      },
    }
    mocks.updateDownloadConfig.mockResolvedValue(canonical)

    await useConfigStore.getState().updateDownloadConfig({
      fullTitle: 'OUT',
      defaultCoverIndex: 3,
      downloadPath: 'D:\\Requested',
    })

    expect(useConfigStore.getState().snapshot).toBe(canonical)
  })

  it('uses the canonical server response after a logging update', async () => {
    useConfigStore.setState({ snapshot, loadState: 'ready', error: null })
    const logging = { retentionDays: 14, maxFileSizeMb: 64, maxTotalSizeMb: 256 }
    const canonical: PublicConfigSnapshot = { ...snapshot, logging }
    mocks.updateLogConfig.mockResolvedValue(canonical)

    await useConfigStore.getState().updateLogConfig(logging)

    expect(mocks.updateLogConfig).toHaveBeenCalledWith(logging)
    expect(useConfigStore.getState().snapshot).toBe(canonical)
  })

  it('preserves the prior snapshot and exposes mutation errors', async () => {
    useConfigStore.setState({ snapshot, loadState: 'ready', error: null })
    mocks.updateDownloadConfig.mockRejectedValue(new Error('写入失败'))

    await expect(useConfigStore.getState().updateDownloadConfig(snapshot.download))
      .rejects.toThrow('写入失败')

    expect(useConfigStore.getState()).toMatchObject({
      snapshot,
      loadState: 'ready',
      error: '写入失败',
    })
  })

  it('never stores a submitted password', async () => {
    useConfigStore.setState({ snapshot, loadState: 'ready', error: null })
    const response: PublicConfigSnapshot = {
      ...snapshot,
      account: { ...snapshot.account, username: 'next-user' },
    }
    mocks.updateCredentials.mockResolvedValue(response)

    await useConfigStore.getState().updateCredentials({
      username: 'next-user',
      password: 'do-not-store',
    })

    expect(JSON.stringify(useConfigStore.getState().snapshot)).not.toContain('do-not-store')
    expect(useConfigStore.getState().snapshot).toBe(response)
  })

  it('reconciles the committed snapshot when credential side effects fail', async () => {
    useConfigStore.setState({ snapshot, loadState: 'ready', error: null })
    const committed: PublicConfigSnapshot = {
      ...snapshot,
      account: { ...snapshot.account, username: 'next-user', hasCookies: false },
    }
    mocks.updateCredentials.mockRejectedValue(
      new Error('账号设置已保存，但 Cookie 同步失败，请重试刷新 Cookie'),
    )
    mocks.getConfig.mockResolvedValue(committed)

    await expect(useConfigStore.getState().updateCredentials({
      username: 'next-user',
      password: 'new-password',
    })).rejects.toThrow('Cookie 同步失败')

    expect(useConfigStore.getState()).toMatchObject({
      snapshot: committed,
      loadState: 'ready',
      error: '账号设置已保存，但 Cookie 同步失败，请重试刷新 Cookie',
    })
  })

  it('reconciles cleared recovery state when reset synchronization fails', async () => {
    const recovery: PublicConfigSnapshot = {
      ...snapshot,
      health: { state: 'recovery-required', message: '配置损坏' },
    }
    useConfigStore.setState({ snapshot: recovery, loadState: 'ready', error: null })
    mocks.resetCorruptConfig.mockRejectedValue(
      new Error('配置已重置，但 Cookie 同步失败，请重启应用'),
    )
    mocks.getConfig.mockResolvedValue(snapshot)

    await expect(useConfigStore.getState().resetCorruptConfig())
      .rejects.toThrow('配置已重置')

    expect(useConfigStore.getState()).toMatchObject({
      snapshot,
      loadState: 'ready',
      error: '配置已重置，但 Cookie 同步失败，请重启应用',
    })
  })
})
