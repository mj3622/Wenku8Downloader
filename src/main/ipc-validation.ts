import {
  OPEN_FOLDER_TARGETS,
  type OpenFolderTarget,
} from '../shared/ipc-types'

const EXTERNAL_HOSTS = new Set(['github.com', 'wenku8.net', 'www.wenku8.net'])

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
