import { createHash } from 'crypto'
import type { BasicInfo, Chapter } from './types'

export interface BookVersionFields {
  updatedAt: string
  latestChapter: string
  status: string
}

export interface BookVersion {
  fields: BookVersionFields
  generationKey: string
  stable: boolean
}

export interface BookSnapshot {
  schemaVersion: 1
  bookId: string
  checkedAt: number
  version: BookVersion
  legacyImportGenerationKey: string
  baseChapterUrl: string
  volumes: Record<string, Chapter[]>
  basicInfo: BasicInfo
}

const SHA256 = /^[a-f0-9]{64}$/
const BOOK_ID = /^\d+$/

export function normalizeVersionField(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function createBookVersion(
  fields: BookVersionFields,
  refreshedAt: number,
): BookVersion {
  if (!Number.isFinite(refreshedAt) || refreshedAt < 0) {
    throw new TypeError('refreshedAt must be a non-negative finite number')
  }
  const normalized = {
    updatedAt: normalizeVersionField(fields.updatedAt),
    latestChapter: normalizeVersionField(fields.latestChapter),
    status: normalizeVersionField(fields.status),
  }
  const stable = Object.values(normalized).some(Boolean)
  const identity = stable
    ? JSON.stringify([normalized.updatedAt, normalized.latestChapter, normalized.status])
    : `unknown:${refreshedAt}`
  return {
    fields: normalized,
    generationKey: createHash('sha256').update(identity).digest('hex'),
    stable,
  }
}

function isShortString(value: unknown, max = 2_048): value is string {
  return typeof value === 'string' && value.length <= max
}

function parseBasicInfo(value: unknown): BasicInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  const stringKeys = ['标题', '作者', '出版社', '连载状态', '简介'] as const
  const nullableKeys = ['最新章节', '更新时间', '全文长度', 'cover'] as const
  if (!stringKeys.every(key => isShortString(data[key], key === '简介' ? 200_000 : 2_048))) {
    return null
  }
  if (!nullableKeys.every(key => data[key] === null || isShortString(data[key]))) {
    return null
  }
  return {
    '标题': data['标题'] as string,
    '作者': data['作者'] as string,
    '出版社': data['出版社'] as string,
    '最新章节': data['最新章节'] as string | null,
    '连载状态': data['连载状态'] as string,
    '更新时间': data['更新时间'] as string | null,
    '全文长度': data['全文长度'] as string | null,
    '简介': data['简介'] as string,
    'cover': data['cover'] as string | null,
  }
}

function parseVolumes(value: unknown): Record<string, Chapter[]> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, Chapter[]> = {}
  for (const [volumeName, rawChapters] of Object.entries(value)) {
    if (!isShortString(volumeName) || !Array.isArray(rawChapters)) return null
    const chapters: Chapter[] = []
    for (const rawChapter of rawChapters) {
      if (!rawChapter || typeof rawChapter !== 'object' || Array.isArray(rawChapter)) return null
      const chapter = rawChapter as Record<string, unknown>
      if (!isShortString(chapter.name) || !isShortString(chapter.link)) return null
      chapters.push({ name: chapter.name, link: chapter.link })
    }
    result[volumeName] = chapters
  }
  return result
}

export function parseBookSnapshot(value: unknown): BookSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const data = value as Record<string, unknown>
  if (data.schemaVersion !== 1 || !isShortString(data.bookId) || !BOOK_ID.test(data.bookId)) return null
  if (typeof data.checkedAt !== 'number' || !Number.isFinite(data.checkedAt) || data.checkedAt < 0) return null
  if (!isShortString(data.baseChapterUrl)
    || typeof data.legacyImportGenerationKey !== 'string'
    || !SHA256.test(data.legacyImportGenerationKey)) return null
  try {
    const baseChapterUrl = new URL(data.baseChapterUrl)
    if (baseChapterUrl.protocol !== 'http:' && baseChapterUrl.protocol !== 'https:') return null
  } catch {
    return null
  }

  const rawVersion = data.version
  if (!rawVersion || typeof rawVersion !== 'object' || Array.isArray(rawVersion)) return null
  const version = rawVersion as Record<string, unknown>
  const rawFields = version.fields
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return null
  const fields = rawFields as Record<string, unknown>
  if (!isShortString(fields.updatedAt) || !isShortString(fields.latestChapter) || !isShortString(fields.status)) return null
  if (!isShortString(version.generationKey) || !SHA256.test(version.generationKey) || typeof version.stable !== 'boolean') return null
  const normalizedFields = {
    updatedAt: normalizeVersionField(fields.updatedAt),
    latestChapter: normalizeVersionField(fields.latestChapter),
    status: normalizeVersionField(fields.status),
  }
  if (normalizedFields.updatedAt !== fields.updatedAt
    || normalizedFields.latestChapter !== fields.latestChapter
    || normalizedFields.status !== fields.status) return null
  const stable = Object.values(normalizedFields).some(Boolean)
  if (version.stable !== stable) return null
  const expectedVersion = createBookVersion(normalizedFields, stable ? 0 : data.checkedAt)
  if (expectedVersion.generationKey !== version.generationKey) return null

  const volumes = parseVolumes(data.volumes)
  const basicInfo = parseBasicInfo(data.basicInfo)
  if (!volumes || !basicInfo) return null
  return {
    schemaVersion: 1,
    bookId: data.bookId,
    checkedAt: data.checkedAt,
    version: {
      fields: {
        updatedAt: fields.updatedAt,
        latestChapter: fields.latestChapter,
        status: fields.status,
      },
      generationKey: version.generationKey,
      stable: version.stable,
    },
    legacyImportGenerationKey: data.legacyImportGenerationKey,
    baseChapterUrl: data.baseChapterUrl,
    volumes,
    basicInfo,
  }
}
