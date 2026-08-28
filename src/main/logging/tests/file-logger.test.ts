import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileLogger } from '../file-logger'

describe('FileLogger', () => {
  let root: string
  let now: { value: Date }
  let fallback: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-logs-'))
    now = { value: new Date(2026, 7, 23, 14, 30, 12, 123) }
    fallback = vi.fn()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  function createLogger(
    development = false,
    config = { retentionDays: 30, maxFileSizeMb: 1, maxTotalSizeMb: 2 },
  ): FileLogger {
    return new FileLogger({
      directory: root,
      config,
      source: 'main',
      development,
      now: () => now.value,
      sessionId: 'session-test',
      fallback,
    })
  }

  it('writes daily application logs and duplicates errors', async () => {
    const logger = createLogger()

    logger.info('download.started', '开始下载', { bookId: '3057' })
    logger.error('download.failed', '下载失败', new Error('HTTP 503'), { taskId: 'task-1' })

    const appLog = await readFile(join(root, 'app-2026-08-23.log'), 'utf8')
    const errorLog = await readFile(join(root, 'error-2026-08-23.log'), 'utf8')
    expect(appLog).toContain('2026-08-23 14:30:12.123')
    expect(appLog).toContain('[download.started]')
    expect(appLog).toContain('"bookId":"3057"')
    expect(appLog).toContain('[download.failed]')
    expect(errorLog).toContain('HTTP 503')
    expect(errorLog).toContain('"taskId":"task-1"')
  })

  it('filters debug output outside development', async () => {
    const logger = createLogger()
    logger.debug('debug.hidden', 'hidden')
    expect(await readdir(root)).toEqual([])

    const developmentLogger = createLogger(true)
    developmentLogger.debug('debug.visible', 'visible')
    expect(await readFile(join(root, 'app-2026-08-23.log'), 'utf8')).toContain('[debug.visible]')
  })

  it('rolls over by size and starts a new base file on the next local day', async () => {
    const logger = createLogger()
    const payload = 'x'.repeat(240_000)
    for (let index = 0; index < 70; index += 1) {
      logger.info('test.large', `entry-${index}`, { payload })
    }

    expect(await stat(join(root, 'app-2026-08-23.log'))).toBeDefined()
    expect(await stat(join(root, 'app-2026-08-23-001.log'))).toBeDefined()

    now.value = new Date(2026, 7, 24, 0, 0, 1)
    logger.info('test.next-day', 'next day')
    expect(await readFile(join(root, 'app-2026-08-24.log'), 'utf8')).toContain('[test.next-day]')
  })

  it('continues rotating managed segments after index 999', async () => {
    await writeFile(join(root, 'app-2026-08-23-1000.log'), Buffer.alloc(1024 * 1024, 0x78))
    const logger = createLogger()

    logger.info('test.after-segment-1000', 'continue rotation')

    await expect(stat(join(root, 'app-2026-08-23-1001.log'))).resolves.toBeDefined()
  })

  it('expires an old error stream after later days write only application logs', async () => {
    const logger = createLogger(false, {
      retentionDays: 1,
      maxFileSizeMb: 1,
      maxTotalSizeMb: 2,
    })
    logger.error('test.first-day-error', 'first day', new Error('failed'))

    now.value = new Date(2026, 7, 24, 0, 0, 1)
    logger.info('test.next-day-info', 'next day')

    await expect(stat(join(root, 'error-2026-08-23.log'))).rejects.toThrow()
  })

  it('writes forwarded renderer failures with the renderer source', async () => {
    const logger = createLogger()

    logger.error('renderer.error', 'renderer failed', new Error('boom'), {}, 'renderer')

    const errorLog = await readFile(join(root, 'error-2026-08-23.log'), 'utf8')
    expect(errorLog).toContain('[ERROR] [renderer]')
  })

  it('removes expired managed files while preserving active and unknown files', async () => {
    await writeFile(join(root, 'app-2026-07-01.log'), 'old')
    await writeFile(join(root, 'error-2026-08-01.log'), 'old')
    await writeFile(join(root, 'notes.txt'), 'keep')
    const logger = createLogger()
    logger.info('test.active', 'create active log')

    logger.cleanup()

    await expect(stat(join(root, 'app-2026-07-01.log'))).rejects.toThrow()
    await expect(stat(join(root, 'notes.txt'))).resolves.toBeDefined()
    await expect(stat(join(root, 'app-2026-08-23.log'))).resolves.toBeDefined()
  })

  it('expires logs by local calendar date across daylight-saving changes', async () => {
    const previousTimezone = process.env.TZ
    try {
      process.env.TZ = 'America/New_York'
      now.value = new Date(2026, 2, 9, 0, 0, 1)
      await writeFile(join(root, 'app-2026-03-08.log'), 'old')

      createLogger(false, {
        retentionDays: 1,
        maxFileSizeMb: 1,
        maxTotalSizeMb: 2,
      })

      await expect(stat(join(root, 'app-2026-03-08.log'))).rejects.toThrow()
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('removes the oldest modified file first within the same log date', async () => {
    const basePath = join(root, 'app-2026-08-01.log')
    const segmentPath = join(root, 'app-2026-08-01-001.log')
    await writeFile(basePath, Buffer.alloc(700 * 1024, 0x78))
    await writeFile(segmentPath, Buffer.alloc(700 * 1024, 0x78))
    await utimes(basePath, new Date('2026-08-02T00:00:00Z'), new Date('2026-08-02T00:00:00Z'))
    await utimes(segmentPath, new Date('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'))

    createLogger(false, {
      retentionDays: 365,
      maxFileSizeMb: 1,
      maxTotalSizeMb: 1,
    })

    await expect(stat(basePath)).resolves.toBeDefined()
    await expect(stat(segmentPath)).rejects.toThrow()
  })

  it('applies total-size limits immediately when reconfigured', async () => {
    await writeFile(join(root, 'app-2026-08-01.log'), Buffer.alloc(900 * 1024, 0x78))
    await writeFile(join(root, 'app-2026-08-02.log'), Buffer.alloc(900 * 1024, 0x78))
    await writeFile(join(root, 'app-2026-08-03.log'), Buffer.alloc(900 * 1024, 0x78))
    const logger = createLogger()

    logger.configure({ retentionDays: 365, maxFileSizeMb: 1, maxTotalSizeMb: 2 })

    const names = (await readdir(root)).filter((name) => /^(app|error)-.*\.log$/.test(name))
    const sizes = await Promise.all(names.map(async (name) => (await stat(join(root, name))).size))
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('reports the total size of managed log files only', async () => {
    await writeFile(join(root, 'app-2026-08-22.log'), Buffer.alloc(1200))
    await writeFile(join(root, 'error-2026-08-22.log'), Buffer.alloc(800))
    await writeFile(join(root, 'notes.txt'), Buffer.alloc(5000))

    const logger = createLogger()

    expect(logger.getTotalSizeBytes()).toBe(2000)
  })

  it('swallows filesystem failures and reports them through the fallback', async () => {
    const blockedPath = join(root, 'blocked')
    await writeFile(blockedPath, 'not a directory')
    const logger = new FileLogger({
      directory: blockedPath,
      config: { retentionDays: 30, maxFileSizeMb: 1, maxTotalSizeMb: 2 },
      source: 'main',
      development: false,
      now: () => now.value,
      fallback,
    })

    expect(() => logger.info('test.failure', 'must not escape')).not.toThrow()
    expect(fallback).toHaveBeenCalled()
  })

  it('swallows error values that cannot be converted to text', async () => {
    const logger = createLogger()
    const unprintable = {
      [Symbol.toPrimitive]() {
        throw new Error('conversion failed')
      },
    }

    expect(() => logger.error('test.unprintable', 'must not escape', unprintable)).not.toThrow()
    const appLog = await readFile(join(root, 'app-2026-08-23.log'), 'utf8')
    expect(appLog).toContain('[UNPRINTABLE]')
  })

  it('swallows contexts that throw while their fields are read', () => {
    const logger = createLogger()
    const hostileContext = new Proxy({}, {
      ownKeys() {
        throw new Error('context failed')
      },
    })

    expect(() => logger.error(
      'test.hostile-context',
      'must not escape',
      new Error('business failure'),
      hostileContext,
    )).not.toThrow()
    expect(fallback).toHaveBeenCalled()
  })

  it('sanitizes and bounds the default stderr fallback without throwing', () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const logger = new FileLogger({
        directory: root,
        config: { retentionDays: 30, maxFileSizeMb: 1, maxTotalSizeMb: 2 },
        source: 'main',
        development: false,
        now: () => now.value,
      })
      const hostileContext = new Proxy({}, {
        ownKeys() {
          throw new Error(`token=secret\nforged-entry\n${'x'.repeat(30_000)}`)
        },
      })

      expect(() => logger.error(
        'test.stderr-fallback',
        'must not escape',
        new Error('business failure'),
        hostileContext,
      )).not.toThrow()

      const output = stderrWrite.mock.calls.map(([value]) => String(value)).join('')
      expect(output).toContain('token=[REDACTED]')
      expect(output).not.toContain('token=secret')
      expect(output.trimEnd().split(/\r?\n/)).toHaveLength(1)
      expect(output.length).toBeLessThan(17 * 1024)
    } finally {
      stderrWrite.mockRestore()
    }
  })
})
