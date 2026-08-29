import {
  DOWNLOAD_TASK_TYPES,
  OPEN_FOLDER_TARGETS,
  RANKING_TYPES,
  type DownloadHistoryScope,
  type DownloadTaskType,
  type EnqueueDownloadInput,
  type OpenFolderTarget,
  type RendererErrorReport,
  type RankingType,
} from '../shared/ipc-types'

const EXTERNAL_HOSTS = new Set(['github.com', 'wenku8.net', 'www.wenku8.net'])
const MAX_RENDERER_MESSAGE = 8 * 1024
const MAX_RENDERER_STACK = 32 * 1024
const MAX_RENDERER_SOURCE = 4 * 1024
const MAX_RENDERER_REPORT = 64 * 1024
const MAX_VOLUME_COVER_REQUESTS = 500
const MAX_RANKING_PAGE = 10_000
const UUID_TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LEGACY_TASK_ID = /^dl-\d{1,16}-\d{1,10}$/

export function validateBookId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) {
    throw new Error('作品编号无效，请输入 1 到 12 位数字')
  }
  return value
}

export function validateSearchQuery(value: unknown): string {
  if (typeof value !== 'string') throw new Error('搜索内容格式不正确，请重新输入')
  const query = value.trim()
  if (query.length === 0 || query.length > 100) {
    throw new Error('请输入 1 到 100 个字符进行搜索')
  }
  return query
}

export function validateDiscoveryRankingPayload(value: unknown): {
  type: RankingType
  page: number
  refresh: boolean
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('榜单请求格式无效')
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.type !== 'string'
    || !RANKING_TYPES.includes(record.type as RankingType)
  ) {
    throw new Error('榜单类型无效')
  }
  if (
    !Number.isSafeInteger(record.page)
    || (record.page as number) < 1
    || (record.page as number) > MAX_RANKING_PAGE
  ) {
    throw new Error('榜单页码无效')
  }
  if (record.refresh !== undefined && typeof record.refresh !== 'boolean') {
    throw new Error('榜单刷新参数无效')
  }
  return {
    type: record.type as RankingType,
    page: record.page as number,
    refresh: record.refresh ?? false,
  }
}

export function validateDiscoveryHomePayload(value: unknown): { refresh: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('发现页请求格式无效')
  }
  const refresh = (value as Record<string, unknown>).refresh
  if (refresh !== undefined && typeof refresh !== 'boolean') {
    throw new Error('发现页刷新参数无效')
  }
  return { refresh: refresh === true }
}

export function validateExternalUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('外部链接必须为 HTTPS 地址')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('外部链接格式无效')
  }

  if (url.protocol !== 'https:' || !EXTERNAL_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('外部链接不在允许范围内')
  }
  return url.toString()
}

export function validateOpenFolder(value: unknown): OpenFolderTarget {
  if (
    typeof value !== 'string'
    || !OPEN_FOLDER_TARGETS.includes(value as OpenFolderTarget)
  ) {
    throw new Error('下载文件夹类型无效，请重新打开页面后再试')
  }
  return value as OpenFolderTarget
}

export function validateOptionalVolumeName(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error('分卷信息无效，请返回作品页重新选择')
  }
  return value
}

export function validateVolumeNames(value: unknown): string[] {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MAX_VOLUME_COVER_REQUESTS
  ) {
    throw new Error('分卷列表无效，请返回作品页重新选择')
  }
  return [...new Set(value.map((item) => validateBoundedString(item, '分卷信息', 200)))]
}

export function validateOptionalTaskId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !/^dl-\d+-\d+$/.test(value)) {
    throw new Error('下载任务信息已失效，请重新发起下载')
  }
  return value
}

export function validateLoginOperationId(value: unknown): string {
  if (typeof value !== 'string' || !/^login-\d{1,16}-\d{1,10}$/.test(value)) {
    throw new Error('登录请求已失效，请重新刷新登录状态')
  }
  return value
}

export function validateDownloadTaskId(value: unknown): string {
  if (
    typeof value !== 'string'
    || (!UUID_TASK_ID.test(value) && !LEGACY_TASK_ID.test(value))
  ) {
    throw new Error('下载任务信息无效，请刷新页面后重试')
  }
  return value
}

function validateBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label}长度无效`)
  }
  return normalized
}

export function validateEnqueueDownloadInput(value: unknown): EnqueueDownloadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('下载请求格式无效')
  }
  const record = value as Record<string, unknown>
  const bookId = validateBookId(record.bookId)
  const title = validateBoundedString(record.title, '作品标题', 500)
  if (
    typeof record.type !== 'string'
    || !DOWNLOAD_TASK_TYPES.includes(record.type as DownloadTaskType)
  ) {
    throw new Error('下载类型无效')
  }
  const type = record.type as DownloadTaskType
  let cover: string | undefined
  if (record.cover !== undefined && record.cover !== null && record.cover !== '') {
    const rawCover = validateBoundedString(record.cover, '封面地址', 2048)
    let parsed: URL
    try {
      parsed = new URL(rawCover)
    } catch {
      throw new Error('封面地址格式无效')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('封面地址格式无效')
    }
    cover = parsed.toString()
  }

  let volume: string | undefined
  if (record.volume !== undefined && record.volume !== null && record.volume !== '') {
    volume = validateBoundedString(record.volume, '分卷信息', 200)
  }
  if (type === 'epub_volume' && volume === undefined) {
    throw new Error('分卷下载必须指定分卷')
  }
  if (type === 'epub_full') volume = undefined

  return {
    bookId,
    title,
    ...(cover === undefined ? {} : { cover }),
    type,
    ...(volume === undefined ? {} : { volume }),
  }
}

export function validateDownloadHistoryScope(value: unknown): DownloadHistoryScope {
  if (value !== 'completed' && value !== 'terminal') {
    throw new Error('下载历史清理范围无效')
  }
  return value
}

function optionalRendererString(
  value: unknown,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error('渲染进程错误报告格式无效')
  }
  return value
}

function optionalRendererPosition(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('渲染进程错误报告格式无效')
  }
  return value as number
}

export function validateRendererErrorReport(value: unknown): RendererErrorReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('渲染进程错误报告格式无效')
  }
  const record = value as Record<string, unknown>
  let serializedInput: string | undefined
  try {
    serializedInput = JSON.stringify(record)
  } catch {
    throw new Error('渲染进程错误报告格式无效')
  }
  if (
    serializedInput === undefined
    || Buffer.byteLength(serializedInput, 'utf8') > MAX_RENDERER_REPORT
  ) {
    throw new Error('渲染进程错误报告超过大小限制')
  }
  if (record.kind !== 'error' && record.kind !== 'unhandled-rejection') {
    throw new Error('渲染进程错误报告格式无效')
  }
  if (
    typeof record.message !== 'string'
    || record.message.length === 0
    || record.message.length > MAX_RENDERER_MESSAGE
  ) {
    throw new Error('渲染进程错误报告格式无效')
  }

  const report: RendererErrorReport = {
    kind: record.kind,
    message: record.message,
  }
  const stack = optionalRendererString(record.stack, MAX_RENDERER_STACK)
  const source = optionalRendererString(record.source, MAX_RENDERER_SOURCE)
  const line = optionalRendererPosition(record.line)
  const column = optionalRendererPosition(record.column)
  if (stack !== undefined) report.stack = stack
  if (source !== undefined) report.source = source
  if (line !== undefined) report.line = line
  if (column !== undefined) report.column = column

  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_RENDERER_REPORT) {
    throw new Error('渲染进程错误报告超过大小限制')
  }
  return report
}
