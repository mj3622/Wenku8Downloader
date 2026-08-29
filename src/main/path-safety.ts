import { extname, isAbsolute, relative, resolve } from 'path'

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
export const IMAGE_MEDIA_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
} as const
const SUPPORTED_IMAGE_EXTENSIONS = new Set<string>(Object.keys(IMAGE_MEDIA_TYPES))
// eslint-disable-next-line no-control-regex -- control characters are intentionally removed from path segments
const INVALID_PATH_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*&]/g

export function safePathSegment(value: string, fallback = 'untitled'): string {
  const normalized = value.normalize('NFKC')
  let safe = normalized
    .replace(INVALID_PATH_CHARACTERS, '_')
    .replace(/\.{2,}/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')

  safe = Array.from(safe).slice(0, 120).join('').replace(/[. ]+$/g, '')
  if (/^[. ]+$/.test(normalized)) safe = ''
  if (!safe) safe = fallback
  if (WINDOWS_RESERVED_NAME.test(safe)) safe = `_${safe}`
  return safe
}

export function resolveWithin(root: string, ...segments: string[]): string {
  const resolvedRoot = resolve(root)
  const target = resolve(resolvedRoot, ...segments)
  const relativeTarget = relative(resolvedRoot, target)

  if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) {
    throw new Error(`目标路径超出下载目录: ${target}`)
  }
  return target
}

export function imageExtensionFromUrl(url: string): string {
  try {
    const pathname = new URL(url, 'https://placeholder.invalid').pathname
    const ext = extname(pathname).slice(1).toLowerCase()
    return SUPPORTED_IMAGE_EXTENSIONS.has(ext) ? ext : 'jpg'
  } catch {
    return 'jpg'
  }
}
