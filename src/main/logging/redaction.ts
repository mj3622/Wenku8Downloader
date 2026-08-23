const REDACTED = '[REDACTED]'
const CIRCULAR = '[CIRCULAR]'
const MAX_LOG_STRING_LENGTH = 16 * 1024

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'cookie',
  'cookies',
  'set-cookie',
  'setcookie',
  'phpsessid',
  'jieqiuserinfo',
  'jieqivisitinfo',
  'cf_clearance',
  'authorization',
  'auth',
  'proxy-authorization',
  'proxyauthorization',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'api_key',
  'api-key',
  'apikey',
  'secret',
  'client_secret',
  'clientsecret',
  'signature',
  'sig',
  'credential',
  'credentials',
  'x-amz-signature',
  'x-amz-credential',
  'encrypted',
  'encrypted_payload',
  'encryptedpayload',
  'ciphertext',
  'login_body',
  'loginbody',
])

const SENSITIVE_KEY_PATTERN = Array.from(SENSITIVE_KEYS)
  .sort((left, right) => right.length - left.length)
  .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const URL_PARAMETER_CANDIDATE_PATTERN = /([?&])([^=&#\s]+)=([^&#\s]*)/giu
const JSON_DOUBLE_QUOTED_VALUE_PATTERN = new RegExp(
  `("(?:${SENSITIVE_KEY_PATTERN})"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
  'giu',
)
const JSON_SINGLE_QUOTED_VALUE_PATTERN = new RegExp(
  `('(?:${SENSITIVE_KEY_PATTERN})'\\s*:\\s*)'(?:\\\\.|[^'\\\\])*'`,
  'giu',
)
const TEXT_VALUE_PATTERN = new RegExp(
  `(\\b(?:${SENSITIVE_KEY_PATTERN})\\b\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|Bearer\\s+[^\\s,;&]+|[^\\s,;&]+)`,
  'giu',
)
const COOKIE_HEADER_PATTERN = /(\b(?:cookie|set-cookie)\b\s*:\s*)[^\r\n]*/giu
const AUTHORIZATION_HEADER_PATTERN = /(\b(?:proxy-authorization|authorization)\b\s*:\s*)[^\r\n]*/giu
const COOKIE_ASSIGNMENT_PATTERN = /(^|[ \t]+)((?:cookie|cookies|set-cookie))[ \t]*=[ \t]*[^\r\n]*/gimu
const AUTHORIZATION_ASSIGNMENT_PATTERN = /(^|[ \t]+)((?:proxy-authorization|authorization))[ \t]*=[ \t]*[^\r\n]*/gimu
const PASSWORD_ASSIGNMENT_PATTERN = /(^|[ \t]+)((?:password|passwd|pwd))([ \t]*[:=][ \t]*)[^\r\n]*/gimu
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/giu

export interface SanitizedError {
  name: string
  message: string
  stack?: string
  cause?: unknown
  errors?: unknown[]
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

function normalizeLogText(value: unknown): string {
  try {
    return String(value)
  } catch {
    return '[UNPRINTABLE]'
  }
}

function redactUrlParameter(
  match: string,
  separator: string,
  encodedKey: string,
): string {
  try {
    const decodedKey = decodeURIComponent(encodedKey.replace(/\+/g, ' '))
    return isSensitiveKey(decodedKey)
      ? `${separator}${encodedKey}=${REDACTED}`
      : match
  } catch {
    return match
  }
}

function limitLogString(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) return value
  const omitted = value.length - MAX_LOG_STRING_LENGTH
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}[TRUNCATED ${omitted} CHARS]`
}

export function sanitizeLogText(value: unknown): string {
  return limitLogString(normalizeLogText(value))
    .replace(URL_CREDENTIAL_PATTERN, `$1$2:${REDACTED}@`)
    .replace(URL_PARAMETER_CANDIDATE_PATTERN, redactUrlParameter)
    .replace(COOKIE_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(AUTHORIZATION_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(JSON_DOUBLE_QUOTED_VALUE_PATTERN, `$1"${REDACTED}"`)
    .replace(JSON_SINGLE_QUOTED_VALUE_PATTERN, `$1'${REDACTED}'`)
    .replace(COOKIE_ASSIGNMENT_PATTERN, `$1$2=${REDACTED}`)
    .replace(AUTHORIZATION_ASSIGNMENT_PATTERN, `$1$2=${REDACTED}`)
    .replace(PASSWORD_ASSIGNMENT_PATTERN, `$1$2$3${REDACTED}`)
    .replace(TEXT_VALUE_PATTERN, `$1${REDACTED}`)
}

export function sanitizeLogLine(value: unknown): string {
  try {
    return sanitizeLogText(value).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  } catch {
    return '[UNPRINTABLE]'
  }
}

function sanitizeValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    return sanitizeLogText(value)
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'symbol') {
    return value.toString()
  }
  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }
  if (depth >= 8) {
    return '[MAX_DEPTH]'
  }
  if (Buffer.isBuffer(value)) {
    return { type: 'Buffer', bytes: value.byteLength }
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  }
  if (value instanceof Error) {
    return serializeError(value, seen, depth)
  }
  if (typeof value !== 'object') {
    return String(value)
  }
  if (seen.has(value)) {
    return CIRCULAR
  }

  seen.add(value)
  try {
    if (Array.isArray(value)) {
      const sanitized = value.slice(0, 100).map((item) => sanitizeValue(item, seen, depth + 1))
      if (value.length > 100) {
        sanitized.push(`[TRUNCATED ${value.length - 100} ITEMS]`)
      }
      return sanitized
    }

    const sanitized: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)
    for (const [key, item] of entries.slice(0, 100)) {
      sanitized[key] = isSensitiveKey(key)
        ? REDACTED
        : sanitizeValue(item, seen, depth + 1)
    }
    if (entries.length > 100) {
      sanitized.__truncatedKeys = entries.length - 100
    }
    return sanitized
  } finally {
    seen.delete(value)
  }
}

function serializeError(error: Error, seen: WeakSet<object>, depth: number): SanitizedError | string {
  if (seen.has(error)) {
    return CIRCULAR
  }
  seen.add(error)
  try {
    const serialized: SanitizedError = {
      name: sanitizeLogText(error.name || 'Error'),
      message: sanitizeLogText(error.message || String(error)),
    }
    if (error.stack) {
      serialized.stack = sanitizeLogText(error.stack)
    }

    const errorWithCause = error as Error & { cause?: unknown; errors?: unknown[] }
    if (errorWithCause.cause !== undefined) {
      serialized.cause = sanitizeValue(errorWithCause.cause, seen, depth + 1)
    }
    if (Array.isArray(errorWithCause.errors)) {
      serialized.errors = errorWithCause.errors
        .slice(0, 100)
        .map((item) => sanitizeValue(item, seen, depth + 1))
    }
    return serialized
  } finally {
    seen.delete(error)
  }
}

export function serializeLogError(error: unknown): SanitizedError {
  if (error instanceof Error) {
    const serialized = serializeError(error, new WeakSet(), 0)
    if (typeof serialized !== 'string') {
      return serialized
    }
  }
  return {
    name: 'Error',
    message: sanitizeLogText(error),
  }
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeValue(value, new WeakSet(), 0)
}

export function stringifyLogContext(value: unknown, maxBytes = 256 * 1024): string {
  const encoded = JSON.stringify(sanitizeLogValue(value)) ?? 'null'
  if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) {
    return encoded
  }

  const markerOnly = JSON.stringify({ truncated: true })
  if (Buffer.byteLength(markerOnly, 'utf8') > maxBytes) {
    return Buffer.byteLength('{}', 'utf8') <= maxBytes ? '{}' : ''
  }

  let low = 0
  let high = encoded.length
  let result = markerOnly
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = JSON.stringify({ truncated: true, preview: encoded.slice(0, middle) })
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      result = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return result
}
