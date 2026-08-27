import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DownloadTask } from '../../shared/ipc-types'

const logMocks = vi.hoisted(() => ({ error: vi.fn() }))

vi.mock('../logging/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: logMocks.error,
  },
}))

import {
  DOWNLOAD_TASK_SCHEMA_VERSION,
  DownloadTaskStore,
  normalizeStoredDownloadTask,
  resolveDownloadTaskPath,
} from '../download-task-store'

const tempRoots: string[] = []

async function createTempPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-download-state-'))
  tempRoots.push(root)
  const filePath = join(root, 'state', 'download-tasks.json')
  mkdirSync(dirname(filePath), { recursive: true })
  return filePath
}

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: '123e4567-e89b-42d3-a456-426614174000',
    bookId: '100',
    title: '测试作品',
    type: 'epub_full',
    status: 'completed',
    progress: 100,
    phase: '下载完成',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('resolveDownloadTaskPath', () => {
  it('uses an isolated development state path', () => {
    expect(resolveDownloadTaskPath({
      isPackaged: false,
      userDataPath: 'unused',
      devRoot: '/repo',
    })).toBe(join('/repo', '.dev-user-data', 'state', 'download-tasks.json'))
  })

  it('uses userData for packaged applications', () => {
    expect(resolveDownloadTaskPath({
      isPackaged: true,
      userDataPath: '/user-data',
      devRoot: '/repo',
    })).toBe(join('/user-data', 'state', 'download-tasks.json'))
  })
})

describe('DownloadTaskStore', () => {
  it('round-trips a versioned download snapshot atomically', async () => {
    const filePath = await createTempPath()
    const completedTask = task()
    const store = new DownloadTaskStore(filePath)

    store.save({ revision: 3, tasks: [completedTask], legacyImportCompleted: true })

    expect(store.load()).toEqual({
      revision: 3,
      tasks: [completedTask],
      legacyImportCompleted: true,
    })
    expect(JSON.parse(readFileSync(filePath, 'utf-8')).schemaVersion)
      .toBe(DOWNLOAD_TASK_SCHEMA_VERSION)
    expect(readFileSync(filePath, 'utf-8').endsWith('\n')).toBe(true)
  })

  it('returns an empty state when the file is missing', async () => {
    const filePath = await createTempPath()
    expect(new DownloadTaskStore(filePath).load()).toEqual({
      revision: 0,
      tasks: [],
      legacyImportCompleted: false,
    })
  })

  it('backs up invalid JSON and returns an empty state', async () => {
    const filePath = await createTempPath()
    writeFileSync(filePath, '{invalid', { flag: 'w' })

    expect(new DownloadTaskStore(filePath).load()).toEqual({
      revision: 0,
      tasks: [],
      legacyImportCompleted: false,
    })
    expect(existsSync(filePath)).toBe(false)
    expect(readdirSync(dirname(filePath))).toContainEqual(expect.stringContaining('.invalid-'))
  })

  it.each([
    { schemaVersion: 99, revision: 0, tasks: [], legacyImportCompleted: false },
    {
      schemaVersion: DOWNLOAD_TASK_SCHEMA_VERSION,
      revision: 0,
      tasks: [task({ bookId: '../invalid' })],
      legacyImportCompleted: false,
    },
    {
      schemaVersion: DOWNLOAD_TASK_SCHEMA_VERSION,
      revision: 0,
      tasks: [task(), task()],
      legacyImportCompleted: false,
    },
  ])('backs up unsupported or malformed current state', async (document) => {
    const filePath = await createTempPath()
    writeFileSync(filePath, JSON.stringify(document))

    expect(new DownloadTaskStore(filePath).load().tasks).toEqual([])
    expect(existsSync(filePath)).toBe(false)
    expect(readdirSync(dirname(filePath)).some((name) => name.includes('.invalid-'))).toBe(true)
    expect(logMocks.error).toHaveBeenCalledWith(
      'download.state.invalid',
      expect.any(String),
      expect.any(Error),
      { statePath: filePath },
    )
  })

  it('keeps unfinished current tasks for manager-level startup recovery', async () => {
    const filePath = await createTempPath()
    writeFileSync(filePath, JSON.stringify({
      schemaVersion: DOWNLOAD_TASK_SCHEMA_VERSION,
      revision: 2,
      tasks: [task({ status: 'downloading', progress: 42, phase: '正在下载' })],
      legacyImportCompleted: false,
    }))

    expect(new DownloadTaskStore(filePath).load().tasks[0]).toMatchObject({
      status: 'downloading',
      progress: 42,
      phase: '正在下载',
    })
  })
})

describe('normalizeStoredDownloadTask', () => {
  it('normalizes legacy fields and drops unknown properties', () => {
    expect(normalizeStoredDownloadTask({
      ...task({
        id: 'dl-1720000000000-1',
        status: 'pending',
        progress: 120.8,
        createdAt: 1234,
      }),
      updatedAt: undefined,
      injected: 'discarded',
    }, 'legacy')).toEqual({
      id: 'dl-1720000000000-1',
      bookId: '100',
      title: '测试作品',
      type: 'epub_full',
      status: 'interrupted',
      progress: 100,
      phase: '下载已中断',
      createdAt: 1234,
      updatedAt: 1234,
    })
  })

  it('skips malformed legacy records while keeping valid records usable', () => {
    const values = [task({ id: 'invalid' }), task({ id: 'dl-1720000000000-2' })]
    expect(values
      .map((value) => normalizeStoredDownloadTask(value, 'legacy'))
      .filter(Boolean)).toEqual([
      task({ id: 'dl-1720000000000-2' }),
    ])
  })
})
