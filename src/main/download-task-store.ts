import { existsSync, readFileSync } from 'fs'
import { isAbsolute, join, resolve } from 'path'
import {
  ACTIVE_DOWNLOAD_STATUSES,
  DOWNLOAD_TASK_STATUSES,
  type DownloadTaskCore,
  type DownloadTaskStatus,
} from '../shared/ipc-types'
import type { BookVersionFields } from '../shared/book-types'
import {
  normalizeDownloadArtifactRecord,
  type DownloadArtifactRecord,
} from './download-artifacts'
import { atomicWriteFile, backupInvalidFile } from './config/atomic-file'
import { logger } from './logging/logger'
import {
  validateDownloadTaskId,
  validateEnqueueDownloadInput,
} from './ipc-validation'

export const DOWNLOAD_TASK_SCHEMA_VERSION = 4

type DownloadTaskSchemaVersion = 1 | 2 | 3 | 4

export interface PersistedDownloadTask extends DownloadTaskCore {
  artifacts: DownloadArtifactRecord[]
  downloadRoot: string
}

export interface PersistedDownloadState {
  revision: number
  tasks: PersistedDownloadTask[]
  legacyImportCompleted: boolean
}

const EMPTY_DOWNLOAD_STATE: PersistedDownloadState = {
  revision: 0,
  tasks: [],
  legacyImportCompleted: false,
}

const ACTIVE_STATUSES = new Set<DownloadTaskStatus>(ACTIVE_DOWNLOAD_STATUSES)

function emptyDownloadState(): PersistedDownloadState {
  return { ...EMPTY_DOWNLOAD_STATE, tasks: [] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeTimestamp(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : null
}

function optionalBoundedString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) return null
  return normalized
}

function normalizeDownloadRoot(value: unknown, schemaVersion: DownloadTaskSchemaVersion): string | null {
  if (schemaVersion === 1) return ''
  if (value === '') return ''
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 4_096
    || !isAbsolute(value)
    || resolve(value) !== value
  ) return null
  return value
}

function normalizeCompletedVersion(value: unknown): BookVersionFields | null | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) return null
  const result: BookVersionFields = { updatedAt: '', latestChapter: '', status: '' }
  for (const key of ['updatedAt', 'latestChapter', 'status'] as const) {
    if (typeof value[key] !== 'string' || value[key].length > 2_048) return null
    const normalized = value[key].replace(/\s+/g, ' ').trim()
    if (normalized !== value[key]) return null
    result[key] = normalized
  }
  return result
}

export function resolveDownloadTaskPath(input: {
  isPackaged: boolean
  userDataPath: string
  devRoot: string
}): string {
  const root = input.isPackaged
    ? input.userDataPath
    : join(input.devRoot, '.dev-user-data')
  return join(root, 'state', 'download-tasks.json')
}

export function normalizeStoredDownloadTask(
  value: unknown,
  mode: 'current' | 'legacy',
  schemaVersion: DownloadTaskSchemaVersion = DOWNLOAD_TASK_SCHEMA_VERSION,
): PersistedDownloadTask | null {
  if (!isRecord(value)) return null

  let id: string
  let input: ReturnType<typeof validateEnqueueDownloadInput>
  try {
    id = validateDownloadTaskId(value.id)
    input = validateEnqueueDownloadInput(value)
  } catch {
    return null
  }

  if (
    typeof value.status !== 'string'
    || !DOWNLOAD_TASK_STATUSES.includes(value.status as DownloadTaskStatus)
    || typeof value.progress !== 'number'
    || !Number.isFinite(value.progress)
  ) {
    return null
  }

  const createdAt = safeTimestamp(value.createdAt)
  const storedUpdatedAt = safeTimestamp(value.updatedAt)
  const updatedAt = storedUpdatedAt ?? (mode === 'legacy' ? createdAt : null)
  if (createdAt === null || updatedAt === null) return null

  const phase = optionalBoundedString(value.phase, 500)
  const error = optionalBoundedString(value.error, 2_000)
  const warning = optionalBoundedString(value.warning, 2_000)
  if (phase === null || error === null || warning === null) return null

  const storedStatus = value.status as DownloadTaskStatus
  const interrupted = mode === 'legacy' && ACTIVE_STATUSES.has(storedStatus)
  const status = interrupted ? 'interrupted' : storedStatus
  const normalizedPhase = interrupted ? '下载已中断' : phase
  const downloadRoot = mode === 'legacy'
    ? ''
    : normalizeDownloadRoot(value.downloadRoot, schemaVersion)
  if (downloadRoot === null) return null
  let artifacts: DownloadArtifactRecord[] = []
  if (mode === 'current' && schemaVersion >= 2) {
    if (!Array.isArray(value.artifacts) || value.artifacts.length > 50) return null
    const parsed = value.artifacts.map(normalizeDownloadArtifactRecord)
    if (parsed.some(artifact => artifact === null)) return null
    artifacts = parsed as DownloadArtifactRecord[]
    if (new Set(artifacts.map(artifact => artifact.id)).size !== artifacts.length) return null
  }

  const completedVersion = mode === 'current' && schemaVersion >= 3
    ? normalizeCompletedVersion(value.completedVersion)
    : undefined
  if (completedVersion === null) return null

  let batchId: string | undefined
  if (mode === 'current' && schemaVersion >= 4 && value.batchId !== undefined) {
    try {
      batchId = validateDownloadTaskId(value.batchId)
    } catch {
      return null
    }
  }

  return {
    id,
    ...input,
    status,
    progress: Math.max(0, Math.min(100, Math.round(value.progress))),
    ...(normalizedPhase === undefined ? {} : { phase: normalizedPhase }),
    ...(error === undefined ? {} : { error }),
    ...(warning === undefined ? {} : { warning }),
    createdAt,
    updatedAt,
    ...(batchId === undefined ? {} : { batchId }),
    ...(completedVersion === undefined ? {} : { completedVersion }),
    artifacts,
    downloadRoot,
  }
}

export class DownloadTaskStore {
  constructor(private readonly filePath: string) {}

  load(): PersistedDownloadState {
    if (!existsSync(this.filePath)) return emptyDownloadState()

    try {
      const document = JSON.parse(readFileSync(this.filePath, 'utf-8')) as unknown
      if (!isRecord(document)) throw new Error('下载任务文件格式无效')
      if (document.schemaVersion !== 1
        && document.schemaVersion !== 2
        && document.schemaVersion !== 3
        && document.schemaVersion !== DOWNLOAD_TASK_SCHEMA_VERSION) {
        throw new Error('下载任务文件版本不支持')
      }
      if (
        !Number.isSafeInteger(document.revision)
        || (document.revision as number) < 0
        || typeof document.legacyImportCompleted !== 'boolean'
        || !Array.isArray(document.tasks)
      ) {
        throw new Error('下载任务文件格式无效')
      }

      const schemaVersion = document.schemaVersion as DownloadTaskSchemaVersion
      const tasks = document.tasks.map((value) => (
        normalizeStoredDownloadTask(value, 'current', schemaVersion)
      ))
      if (tasks.some((task) => task === null)) {
        throw new Error('下载任务记录格式无效')
      }
      const taskIds = new Set<string>()
      for (const task of tasks as PersistedDownloadTask[]) {
        if (taskIds.has(task.id)) throw new Error('下载任务 ID 重复')
        taskIds.add(task.id)
      }
      return {
        revision: document.revision as number,
        tasks: tasks as PersistedDownloadTask[],
        legacyImportCompleted: document.legacyImportCompleted,
      }
    } catch (error) {
      try {
        backupInvalidFile(this.filePath)
      } catch (backupError) {
        logger.error(
          'download.state.backup-failed',
          '损坏的下载任务文件无法备份，已停止加载以保护原文件',
          backupError,
          { statePath: this.filePath },
        )
        throw backupError
      }
      logger.error(
        'download.state.invalid',
        '下载任务文件无效，已备份并使用空状态',
        error,
        { statePath: this.filePath },
      )
      return emptyDownloadState()
    }
  }

  save(state: PersistedDownloadState): void {
    atomicWriteFile(this.filePath, `${JSON.stringify({
      schemaVersion: DOWNLOAD_TASK_SCHEMA_VERSION,
      revision: state.revision,
      tasks: state.tasks,
      legacyImportCompleted: state.legacyImportCompleted,
    }, null, 2)}\n`)
  }
}
