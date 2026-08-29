import { describe, expect, it } from 'vitest'
import {
  sanitizeLogText,
  sanitizeLogValue,
  serializeLogError,
  stringifyLogContext,
} from '../redaction'

describe('log redaction', () => {
  it('redacts sensitive and search URL parameters while keeping diagnostic parameters', () => {
    const value = sanitizeLogText(
      'GET https://www.wenku8.net/search?searchkey=败犬&token=secret&volume=第一卷',
    )

    expect(value).toContain('searchkey=[REDACTED]')
    expect(value).toContain('volume=第一卷')
    expect(value).toContain('token=[REDACTED]')
    expect(value).not.toContain('secret')

    const authenticated = sanitizeLogText('https://reader:password@example.test/file')
    expect(authenticated).toContain('https://reader:[REDACTED]@example.test/file')
    expect(authenticated).not.toContain('password')
  })

  it('redacts quoted JSON secrets and URL-encoded sensitive parameter names', () => {
    const value = sanitizeLogText(
      'payload={"password":"hunter2","searchkey":"败犬"} '
      + 'https://example.test/?access%5Ftoken=secret&searchkey=%E8%B4%A5%E7%8A%AC',
    )

    expect(value).toContain('"password":"[REDACTED]"')
    expect(value).toContain('access%5Ftoken=[REDACTED]')
    expect(value).toContain('"searchkey":"[REDACTED]"')
    expect(value).toContain('searchkey=[REDACTED]')
    expect(value).not.toContain('败犬')
    expect(value).not.toContain('hunter2')
    expect(value).not.toContain('secret')
  })

  it('redacts complete unquoted password values that contain spaces', () => {
    const value = sanitizeLogText(
      'password=correct horse battery staple\nrequestId=request-1',
    )

    expect(value).toContain('password=[REDACTED]\n')
    expect(value).toContain('requestId=request-1')
    expect(value).not.toContain('correct')
    expect(value).not.toContain('horse')
    expect(value).not.toContain('battery')
    expect(value).not.toContain('staple')
  })

  it('redacts the complete value of multi-part Cookie headers', () => {
    const value = sanitizeLogText(
      'Cookie: theme=dark; session=abc\nX-Request-Id: request-1',
    )

    expect(value).toContain('Cookie: [REDACTED]')
    expect(value).toContain('X-Request-Id: request-1')
    expect(value).not.toContain('theme=dark')
    expect(value).not.toContain('session=abc')
  })

  it('redacts the complete value of multi-part authorization headers', () => {
    const value = sanitizeLogText(
      'Authorization: Digest username="alice", realm="wenku8", response="secret"\n'
      + 'Proxy-Authorization: NTLM credential-material',
    )

    expect(value).toContain('Authorization: [REDACTED]')
    expect(value).toContain('Proxy-Authorization: [REDACTED]')
    expect(value).not.toContain('alice')
    expect(value).not.toContain('secret')
    expect(value).not.toContain('credential-material')
  })

  it('redacts complete multi-part secrets written with equals signs', () => {
    const value = sanitizeLogText(
      'Authorization=Digest username=alice, response=secret\n'
      + 'Cookie=PHPSESSID=abc; jieqiUserInfo=secret\n'
      + 'requestId=request-1',
    )

    expect(value).toContain('Authorization=[REDACTED]\n')
    expect(value).toContain('Cookie=[REDACTED]\n')
    expect(value).toContain('requestId=request-1')
    expect(value).not.toContain('alice')
    expect(value).not.toContain('response=secret')
    expect(value).not.toContain('PHPSESSID=abc')
  })

  it('normalizes unexpected text values without throwing', () => {
    expect(sanitizeLogText(undefined as never)).toBe('undefined')
  })

  it('redacts nested credentials and searches without hiding ordinary keys or paths', () => {
    expect(sanitizeLogValue({
      password: 'secret',
      searchkey: '败犬',
      path: 'D:\\Books\\第一卷.epub',
      nested: { authorization: 'Bearer abc', bookId: '3057' },
      clientSecret: 'client-value',
      encryptedPayload: 'cipher-value',
    })).toEqual({
      password: '[REDACTED]',
      searchkey: '[REDACTED]',
      path: 'D:\\Books\\第一卷.epub',
      nested: { authorization: '[REDACTED]', bookId: '3057' },
      clientSecret: '[REDACTED]',
      encryptedPayload: '[REDACTED]',
    })
  })

  it('summarizes buffers and breaks circular references', () => {
    const value: Record<string, unknown> = {
      content: Buffer.alloc(12),
      title: '测试作品',
    }
    value.self = value

    expect(sanitizeLogValue(value)).toEqual({
      content: { type: 'Buffer', bytes: 12 },
      title: '测试作品',
      self: '[CIRCULAR]',
    })
  })

  it('serializes causes and aggregate children without exposing secrets', () => {
    const error = new AggregateError(
      [new Error('download token=abc failed')],
      'batch failed',
      { cause: new Error('root password=hunter2') },
    )

    const serialized = JSON.stringify(serializeLogError(error))
    expect(serialized).toContain('batch failed')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).not.toContain('abc')
    expect(serialized).not.toContain('hunter2')
  })

  it('returns valid bounded JSON with an explicit truncation marker', () => {
    const encoded = stringifyLogContext({ value: 'x'.repeat(20_000) }, 512)
    expect(Buffer.byteLength(encoded, 'utf8')).toBeLessThanOrEqual(512)
    expect(JSON.parse(encoded)).toMatchObject({ truncated: true })
  })

  it('limits individual strings while preserving later diagnostic fields', () => {
    const sanitized = sanitizeLogValue({
      payload: 'x'.repeat(300_000),
      taskId: 'task-after-large-value',
    }) as Record<string, unknown>

    expect(typeof sanitized.payload).toBe('string')
    expect((sanitized.payload as string).length).toBeLessThan(300_000)
    expect(sanitized.payload).toContain('[TRUNCATED')
    expect(sanitized.taskId).toBe('task-after-large-value')

    const encoded = stringifyLogContext({
      payload: 'x'.repeat(300_000),
      taskId: 'task-after-large-value',
    })
    expect(JSON.parse(encoded)).toMatchObject({ taskId: 'task-after-large-value' })
  })
})
