import {
  realpathSync,
  statSync,
} from 'fs'
import {
  realpath,
  stat,
} from 'fs/promises'
import {
  isAbsolute,
  relative,
  resolve,
} from 'path'
import {
  DOWNLOAD_ARTIFACT_KINDS,
  type DownloadArtifact,
  type DownloadArtifactKind,
} from '../shared/ipc-types'
import { resolveWithin } from './path-safety'

const ARTIFACT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const MAX_ARTIFACT_NAME_LENGTH = 200

export interface DownloadArtifactRecord {
  id: string
  name: string
  kind: DownloadArtifactKind
  path: string
  rootPath: string
}

export interface ResolvedDownloadArtifactTarget {
  path: string
  kind: DownloadArtifactKind
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('下载产物名称无效')
  const name = value.trim()
  if (!name || name.length > MAX_ARTIFACT_NAME_LENGTH) {
    throw new Error('下载产物名称无效')
  }
  return name
}

function validateId(value: unknown): string {
  if (typeof value !== 'string' || !ARTIFACT_ID.test(value)) {
    throw new Error('下载产物标识无效')
  }
  return value
}

function validateKind(value: unknown): DownloadArtifactKind {
  if (
    typeof value !== 'string'
    || !DOWNLOAD_ARTIFACT_KINDS.includes(value as DownloadArtifactKind)
  ) throw new Error('下载产物类型无效')
  return value as DownloadArtifactKind
}

function validateStoredPath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 4_096
    || !isAbsolute(value)
    || resolve(value) !== value
  ) throw new Error('下载产物路径无效')
  return value
}

function assertLexicallyWithin(rootPath: string, path: string): void {
  const relativePath = relative(rootPath, path)
  if (!relativePath) throw new Error('下载产物超出任务目录')
  try {
    if (resolveWithin(rootPath, relativePath) !== path) {
      throw new Error('下载产物超出任务目录')
    }
  } catch {
    throw new Error('下载产物超出任务目录')
  }
}

function matchesKind(metadata: { isFile(): boolean; isDirectory(): boolean }, kind: DownloadArtifactKind): boolean {
  return kind === 'file' ? metadata.isFile() : metadata.isDirectory()
}

function normalizedRecord(value: unknown): DownloadArtifactRecord {
  if (!isRecord(value)) throw new Error('下载产物记录无效')
  const record = {
    id: validateId(value.id),
    name: validateName(value.name),
    kind: validateKind(value.kind),
    path: validateStoredPath(value.path),
    rootPath: validateStoredPath(value.rootPath),
  }
  assertLexicallyWithin(record.rootPath, record.path)
  return record
}

export function normalizeDownloadArtifactRecord(value: unknown): DownloadArtifactRecord | null {
  try {
    return normalizedRecord(value)
  } catch {
    return null
  }
}

async function inspectArtifact(
  value: DownloadArtifactRecord,
  missingMessage: string,
): Promise<ResolvedDownloadArtifactTarget> {
  const record = normalizedRecord(value)
  try {
    const [canonicalRoot, canonicalPath] = await Promise.all([
      realpath(record.rootPath),
      realpath(record.path),
    ])
    assertLexicallyWithin(canonicalRoot, canonicalPath)
    const metadata = await stat(canonicalPath)
    if (!matchesKind(metadata, record.kind)) throw new Error('下载产物类型不匹配')
    return { path: canonicalPath, kind: record.kind }
  } catch (error) {
    if (error instanceof Error && (
      error.message === '下载产物超出任务目录'
      || error.message === '下载产物类型不匹配'
    )) throw error
    throw new Error(missingMessage)
  }
}

export async function createDownloadArtifactRecord(
  value: DownloadArtifactRecord,
): Promise<DownloadArtifactRecord> {
  const record = normalizedRecord({
    ...value,
    path: resolve(value.path),
    rootPath: resolve(value.rootPath),
  })
  const target = await inspectArtifact(record, '下载产物不存在')
  const canonicalRoot = await realpath(record.rootPath)
  return {
    ...record,
    path: target.path,
    rootPath: canonicalRoot,
  }
}

export function isDownloadArtifactAvailable(record: DownloadArtifactRecord): boolean {
  try {
    const normalized = normalizedRecord(record)
    const canonicalRoot = realpathSync(normalized.rootPath)
    const canonicalPath = realpathSync(normalized.path)
    assertLexicallyWithin(canonicalRoot, canonicalPath)
    return matchesKind(statSync(canonicalPath), normalized.kind)
  } catch {
    return false
  }
}

export function toDownloadArtifact(record: DownloadArtifactRecord): DownloadArtifact {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    available: isDownloadArtifactAvailable(record),
  }
}

export function resolveDownloadArtifactTarget(
  record: DownloadArtifactRecord,
): Promise<ResolvedDownloadArtifactTarget> {
  return inspectArtifact(record, '下载文件已被移动或删除')
}
