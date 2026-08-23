import {
  OPEN_FOLDER_TARGETS,
  type OpenFolderTarget,
  type RendererErrorReport,
} from '../shared/ipc-types'

const EXTERNAL_HOSTS = new Set(['github.com', 'wenku8.net', 'www.wenku8.net'])
const MAX_RENDERER_MESSAGE = 8 * 1024
const MAX_RENDERER_STACK = 32 * 1024
const MAX_RENDERER_SOURCE = 4 * 1024
const MAX_RENDERER_REPORT = 64 * 1024

export function validateBookId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) {
    throw new Error('作品编号必须为 1 到 12 位数字')
  }
  return value
}

export function validateSearchQuery(value: unknown): string {
  if (typeof value !== 'string') throw new Error('搜索内容必须为字符串')
  const query = value.trim()
  if (query.length === 0 || query.length > 100) {
    throw new Error('搜索内容长度必须为 1 到 100 个字符')
  }
  return query
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
    throw new Error('下载文件夹必须为 root、pics 或 novels')
  }
  return value as OpenFolderTarget
}

export function validateOptionalVolumeName(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new Error('卷名格式无效')
  }
  return value
}

export function validateOptionalTaskId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !/^dl-\d+-\d+$/.test(value)) {
    throw new Error('下载任务编号格式无效')
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
