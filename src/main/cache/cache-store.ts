import { randomUUID } from 'crypto'
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  statfs,
  utimes,
} from 'fs/promises'
import { join, sep } from 'path'
import { logger } from '../logging/logger'
import { atomicWriteCacheFile, atomicWriteCacheJson } from './atomic-cache-file'
import { hashCacheKey } from './cache-key'
import {
  CACHE_SCHEMA_VERSION,
  CACHE_TOUCH_INTERVAL_MS,
  MAINTENANCE_INTERVAL_MS,
  TEMP_MAX_AGE_MS,
  UNUSED_MAX_AGE_MS,
  calculateCacheLimits,
} from './cache-policy'

export type CacheEntryKind = 'snapshot' | 'illustration' | 'chapter' | 'image' | 'cover'

export interface CacheAddress {
  kind: CacheEntryKind
  bookId: string
  generationKey?: string
  sourceKey: string
}

export interface CachedBinary {
  data: Buffer
  extension: string
}

export interface CacheWriteGuard {
  readonly epoch: number
  readonly leaseId?: string
  readonly generationIdentity?: string
  readonly generationRevision?: number
}

export interface CacheLease {
  readonly bookId: string
  readonly generationKey: string
  readonly leaseId: string
  release(): Promise<void>
}

export interface CacheClearResult {
  deferred: boolean
}

export type CachePruneReason = 'startup' | 'scheduled' | 'quota' | 'manual'

export interface CacheStoreOptions {
  now?: () => number
  statDisk?: () => Promise<{ totalBytes: number; freeBytes: number }>
  maintenanceIntervalMs?: number
}

interface JsonEnvelope {
  schemaVersion: 1
  touchedAt: number
  value: unknown
}

interface BinaryMetadata {
  schemaVersion: 1
  touchedAt: number
  extension: string
  byteLength: number
}

interface LeaseRecord {
  bookId: string
  generationKey: string
  generationIdentity: string
  released: boolean
}

interface CurrentGeneration {
  generationHash: string
  snapshotLastUsedAt: number
}

interface GenerationState {
  currentIdentity?: string
  revision: number
}

const BOOK_ID = /^\d+$/
const GENERATION_KEY = /^[a-f0-9]{64}$/
const EXTENSION = /^[a-z0-9]{1,8}$/
const TEMP_FILE = /\.tmp-[^.]+-/

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function pathSize(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const child = join(path, entry.name)
    if (entry.isDirectory()) total += await pathSize(child)
    else if (entry.isFile()) {
      try {
        total += (await stat(child)).size
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  return total
}

async function latestMtime(path: string): Promise<number> {
  let latest = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return latest
    throw error
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const child = join(path, entry.name)
    try {
      if (entry.isDirectory()) latest = Math.max(latest, await latestMtime(child))
      else if (entry.isFile()) latest = Math.max(latest, (await stat(child)).mtimeMs)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  return latest
}

export class CacheStore {
  private epoch = 0
  private usageBytes: number | null = null
  private pendingWriteBytes = 0
  private initialized = false
  private initializePromise: Promise<void> | null = null
  private readonly now: () => number
  private readonly statDisk: () => Promise<{ totalBytes: number; freeBytes: number }>
  private readonly maintenanceIntervalMs: number
  private readonly leases = new Map<string, LeaseRecord>()
  private readonly leaseCounts = new Map<string, number>()
  private readonly manualDeleteOnRelease = new Set<string>()
  private readonly obsoleteDeleteOnRelease = new Set<string>()
  private readonly generationStates = new Map<string, GenerationState>()
  private nextGenerationRevision = 0
  private readonly lastTouched = new Map<string, number>()
  private readonly bookLocks = new Map<string, Promise<void>>()
  private maintenance: Promise<void> = Promise.resolve()

  constructor(
    readonly rootPath: string,
    options: CacheStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? MAINTENANCE_INTERVAL_MS
    this.statDisk = options.statDisk ?? (async () => {
      const disk = await statfs(this.rootPath)
      return {
        totalBytes: Number(disk.blocks) * Number(disk.bsize),
        freeBytes: Number(disk.bavail) * Number(disk.bsize),
      }
    })
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve()
    this.initializePromise ??= (async () => {
      await mkdir(join(this.rootPath, 'tmp'), { recursive: true })
      this.usageBytes = await pathSize(this.rootPath)
      this.initialized = true
    })().catch((error) => {
      this.initializePromise = null
      throw error
    })
    return this.initializePromise
  }

  captureWriteGuard(lease?: CacheLease): CacheWriteGuard {
    return { epoch: this.epoch, leaseId: lease?.leaseId }
  }

  captureGenerationWriteGuard(bookId: string, generationKey: string): CacheWriteGuard {
    if (!BOOK_ID.test(bookId) || !GENERATION_KEY.test(generationKey)) {
      return { epoch: this.epoch, generationRevision: -1 }
    }
    const generationIdentity = this.generationIdentity(bookId, generationKey)
    const bookHash = generationIdentity.slice(0, generationIdentity.indexOf('/'))
    const generationRevision = this.ensureGenerationState(bookHash).revision
    return { epoch: this.epoch, generationIdentity, generationRevision }
  }

  async readJson<T>(
    address: CacheAddress,
    parse: (value: unknown) => T | null,
  ): Promise<T | null> {
    const targetPath = this.resolveAddress(address)?.dataPath
    if (!targetPath) return null
    return this.withBookLock(hashCacheKey(address.bookId), async () => {
      try {
        const envelope = JSON.parse(await readFile(targetPath, 'utf8')) as unknown
        if (!isRecord(envelope) || envelope.schemaVersion !== CACHE_SCHEMA_VERSION) {
          await this.removeCorrupt([targetPath], address.kind)
          return null
        }
        const parsed = parse(envelope.value)
        if (parsed === null) {
          await this.removeCorrupt([targetPath], address.kind)
          return null
        }
        await this.touch(targetPath)
        return parsed
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          await this.removeCorrupt([targetPath], address.kind)
        }
        return null
      }
    })
  }

  async writeJson(
    address: CacheAddress,
    value: unknown,
    guard: CacheWriteGuard,
  ): Promise<boolean> {
    const resolved = this.resolveAddress(address)
    if (!resolved || !this.isGuardValid(guard, resolved.generationIdentity)) return false
    const envelope: JsonEnvelope = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      touchedAt: this.now(),
      value,
    }
    const data = Buffer.from(JSON.stringify(envelope), 'utf8')
    this.pendingWriteBytes += data.byteLength
    try {
      if (!await this.ensureCapacity()) return false
      const commit = async (): Promise<boolean> => {
        const previousSize = await this.fileSize(resolved.dataPath)
        const committed = await atomicWriteCacheJson(resolved.dataPath, envelope, {
          canCommit: () => this.isGuardValid(guard, resolved.generationIdentity),
        })
        if (committed) this.adjustUsage(data.byteLength - previousSize)
        return committed
      }
      return await this.withBookLock(hashCacheKey(address.bookId), commit)
    } catch (error) {
      logger.warn('cache.write.failed', '缓存 JSON 写入失败', {
        cacheType: address.kind,
        error,
      })
      return false
    } finally {
      this.pendingWriteBytes = Math.max(0, this.pendingWriteBytes - data.byteLength)
    }
  }

  async readBinary(address: CacheAddress): Promise<CachedBinary | null> {
    const resolved = this.resolveAddress(address)
    if (!resolved?.metadataPath) return null
    const metadataPath = resolved.metadataPath
    return this.withBookLock(hashCacheKey(address.bookId), async () => {
      try {
        const rawMetadata = JSON.parse(await readFile(metadataPath, 'utf8')) as unknown
        if (!isRecord(rawMetadata)
          || rawMetadata.schemaVersion !== CACHE_SCHEMA_VERSION
          || typeof rawMetadata.extension !== 'string'
          || !EXTENSION.test(rawMetadata.extension)
          || typeof rawMetadata.byteLength !== 'number'
          || !Number.isSafeInteger(rawMetadata.byteLength)
          || rawMetadata.byteLength <= 0) {
          await this.removeCorrupt([resolved.dataPath, metadataPath], address.kind)
          return null
        }
        const data = await readFile(resolved.dataPath)
        if (data.byteLength !== rawMetadata.byteLength) {
          await this.removeCorrupt([resolved.dataPath, metadataPath], address.kind)
          return null
        }
        await Promise.all([
          this.touch(resolved.dataPath),
          this.touch(metadataPath),
        ])
        return { data, extension: rawMetadata.extension }
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
          await this.removeCorrupt([resolved.dataPath, metadataPath], address.kind)
        }
        return null
      }
    })
  }

  async writeBinary(
    address: CacheAddress,
    value: CachedBinary,
    guard: CacheWriteGuard,
  ): Promise<boolean> {
    const resolved = this.resolveAddress(address)
    if (!resolved?.metadataPath
      || value.data.byteLength === 0
      || !EXTENSION.test(value.extension)
      || !this.isGuardValid(guard, resolved.generationIdentity)) {
      return false
    }
    const metadataPath = resolved.metadataPath
    const metadata: BinaryMetadata = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      touchedAt: this.now(),
      extension: value.extension,
      byteLength: value.data.byteLength,
    }
    const metadataData = Buffer.from(JSON.stringify(metadata), 'utf8')
    const incomingBytes = value.data.byteLength + metadataData.byteLength
    this.pendingWriteBytes += incomingBytes
    try {
      if (!await this.ensureCapacity()) return false
      return await this.withBookLock(hashCacheKey(address.bookId), async () => {
        const previousSize = await this.fileSize(resolved.dataPath)
          + await this.fileSize(metadataPath)
        const binCommitted = await atomicWriteCacheFile(resolved.dataPath, value.data, {
          canCommit: () => this.isGuardValid(guard, resolved.generationIdentity),
        })
        if (!binCommitted) return false
        const metaCommitted = await atomicWriteCacheJson(metadataPath, metadata, {
          canCommit: () => this.isGuardValid(guard, resolved.generationIdentity),
        })
        if (!metaCommitted) return false
        this.adjustUsage(value.data.byteLength + metadataData.byteLength - previousSize)
        return true
      })
    } catch (error) {
      logger.warn('cache.write.failed', '缓存二进制写入失败', {
        cacheType: address.kind,
        error,
      })
      return false
    } finally {
      this.pendingWriteBytes = Math.max(0, this.pendingWriteBytes - incomingBytes)
    }
  }

  async acquireGeneration(
    bookId: string,
    generationKey: string,
    taskGuard?: CacheWriteGuard,
  ): Promise<CacheLease> {
    if (!BOOK_ID.test(bookId) || !GENERATION_KEY.test(generationKey)) {
      throw new TypeError('invalid cache generation')
    }
    const generationIdentity = this.generationIdentity(bookId, generationKey)
    const bookHash = generationIdentity.slice(0, generationIdentity.indexOf('/'))
    return this.withBookLock(bookHash, async () => {
      const leaseId = randomUUID()
      const record: LeaseRecord = { bookId, generationKey, generationIdentity, released: false }
      this.leases.set(leaseId, record)
      this.leaseCounts.set(generationIdentity, (this.leaseCounts.get(generationIdentity) ?? 0) + 1)
      if (taskGuard && taskGuard.epoch !== this.epoch) {
        this.manualDeleteOnRelease.add(generationIdentity)
      }
      if (!this.isCurrentGeneration(generationIdentity)) {
        this.obsoleteDeleteOnRelease.add(generationIdentity)
      }
      return {
        bookId,
        generationKey,
        leaseId,
        release: async () => this.releaseLease(leaseId),
      }
    })
  }

  async removeOtherGenerations(bookId: string, keepGenerationKey: string): Promise<void> {
    if (!BOOK_ID.test(bookId) || !GENERATION_KEY.test(keepGenerationKey)) return
    const bookHash = hashCacheKey(bookId)
    const keepHash = hashCacheKey(keepGenerationKey)
    const keepIdentity = `${bookHash}/${keepHash}`
    await this.withBookLock(bookHash, async () => {
      this.setCurrentGeneration(bookHash, keepIdentity)
      this.obsoleteDeleteOnRelease.delete(keepIdentity)
      try {
        this.markActiveGenerationsForDeletion(
          this.obsoleteDeleteOnRelease,
          bookHash,
          keepHash,
        )
        const bookAssetsPath = join(this.rootPath, 'assets', bookHash)
        for (const entry of await this.safeReadDir(bookAssetsPath)) {
          if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === keepHash) continue
          const identity = `${bookHash}/${entry.name}`
          if (this.isGenerationPinned(identity)) this.obsoleteDeleteOnRelease.add(identity)
          else await this.removePath(join(bookAssetsPath, entry.name))
        }
        this.markActiveGenerationsForDeletion(
          this.obsoleteDeleteOnRelease,
          bookHash,
          keepHash,
        )
        await this.refreshUsage()
      } catch (error) {
        logger.warn('cache.generation-cleanup.failed', '旧版本缓存清理失败，作品加载继续', {
          bookId,
          error,
        })
      }
    })
  }

  async clearSnapshots(): Promise<void> {
    this.epoch++
    this.lastTouched.clear()
    try {
      await this.removePath(join(this.rootPath, 'books'))
      await this.refreshUsage()
    } catch (error) {
      logger.warn('cache.snapshot-clear.failed', '作品缓存失效失败', { error })
    }
  }

  async clear(): Promise<CacheClearResult> {
    this.epoch++
    this.lastTouched.clear()
    let failed = false
    let deferred = this.markActiveGenerationsForDeletion(this.manualDeleteOnRelease)
    for (const name of ['books', 'tmp']) {
      try {
        await this.removePath(join(this.rootPath, name))
      } catch {
        failed = true
      }
    }
    const assetsRoot = join(this.rootPath, 'assets')
    for (const bookEntry of await this.safeReadDir(assetsRoot)) {
      if (!bookEntry.isDirectory() || bookEntry.isSymbolicLink()) {
        try {
          await this.removePath(join(assetsRoot, bookEntry.name))
        } catch {
          failed = true
        }
        continue
      }
      const bookPath = join(assetsRoot, bookEntry.name)
      for (const generationEntry of await this.safeReadDir(bookPath)) {
        if (!generationEntry.isDirectory() || generationEntry.isSymbolicLink()) continue
        const identity = `${bookEntry.name}/${generationEntry.name}`
        if (this.isGenerationPinned(identity)) {
          deferred = true
          this.manualDeleteOnRelease.add(identity)
          continue
        }
        try {
          await this.removePath(join(bookPath, generationEntry.name))
        } catch {
          failed = true
        }
      }
      const hasPinnedGeneration = Array.from(this.leaseCounts.keys()).some(
        identity => identity.startsWith(`${bookEntry.name}/`),
      )
      if (!hasPinnedGeneration) {
        try {
          await this.removePath(bookPath)
        } catch {
          failed = true
        }
      }
    }
    deferred = this.markActiveGenerationsForDeletion(this.manualDeleteOnRelease) || deferred
    this.generationStates.clear()
    await this.refreshUsage()
    if (failed) throw new Error('cache clear failed')
    logger.info('cache.cleared', '缓存已清除', { deferred })
    return { deferred }
  }

  prune(reason: CachePruneReason): Promise<void> {
    const run = this.maintenance.then(() => this.performPrune(reason))
    this.maintenance = run.catch(() => undefined)
    return run
  }

  startMaintenance(): () => void {
    let stopped = false
    queueMicrotask(() => {
      if (!stopped) void this.prune('startup')
    })
    const timer = setInterval(() => {
      if (!stopped) void this.prune('scheduled')
    }, this.maintenanceIntervalMs)
    timer.unref?.()
    return () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
    }
  }

  private resolveAddress(address: CacheAddress): {
    dataPath: string
    metadataPath?: string
    generationIdentity?: string
  } | null {
    if (!BOOK_ID.test(address.bookId)
      || !address.sourceKey
      || address.sourceKey.length > 2_048) return null
    const bookHash = hashCacheKey(address.bookId)
    if (address.kind === 'snapshot') {
      if (address.generationKey !== undefined) return null
      return { dataPath: join(this.rootPath, 'books', bookHash, 'snapshot.json') }
    }
    if (!address.generationKey || !GENERATION_KEY.test(address.generationKey)) return null
    const generationHash = hashCacheKey(address.generationKey)
    const sourceHash = hashCacheKey(address.sourceKey)
    const generationIdentity = `${bookHash}/${generationHash}`
    const kindDirectory = address.kind === 'illustration'
      ? 'illustrations'
      : address.kind === 'chapter'
        ? 'chapters'
        : address.kind === 'image'
          ? 'images'
          : 'covers'
    const basePath = join(this.rootPath, 'assets', bookHash, generationHash, kindDirectory, sourceHash)
    if (address.kind === 'image' || address.kind === 'cover') {
      return {
        dataPath: `${basePath}.bin`,
        metadataPath: `${basePath}.meta.json`,
        generationIdentity,
      }
    }
    return { dataPath: `${basePath}.json`, generationIdentity }
  }

  private generationIdentity(bookId: string, generationKey: string): string {
    return `${hashCacheKey(bookId)}/${hashCacheKey(generationKey)}`
  }

  private isGuardValid(guard: CacheWriteGuard, generationIdentity?: string): boolean {
    if (!generationIdentity) {
      return guard.epoch === this.epoch
        && guard.leaseId === undefined
        && guard.generationIdentity === undefined
    }
    if (guard.leaseId) {
      const lease = this.leases.get(guard.leaseId)
      return Boolean(lease && !lease.released && lease.generationIdentity === generationIdentity)
    }
    return guard.epoch === this.epoch
      && guard.generationIdentity === generationIdentity
      && guard.generationRevision === this.generationRevision(generationIdentity)
      && this.isCurrentGeneration(generationIdentity)
  }

  private isGenerationPinned(identity: string): boolean {
    return (this.leaseCounts.get(identity) ?? 0) > 0
  }

  private isCurrentGeneration(identity: string): boolean {
    const separator = identity.indexOf('/')
    const bookHash = identity.slice(0, separator)
    const current = this.generationStates.get(bookHash)?.currentIdentity
    return current === undefined || current === identity
  }

  private generationRevision(identity: string): number {
    const separator = identity.indexOf('/')
    return this.generationStates.get(identity.slice(0, separator))?.revision ?? -1
  }

  private setCurrentGeneration(bookHash: string, identity: string): void {
    const current = this.generationStates.get(bookHash)
    if (!current) {
      this.generationStates.set(bookHash, {
        currentIdentity: identity,
        revision: this.allocateGenerationRevision(),
      })
      return
    }
    if (current.currentIdentity === identity) return
    if (current.currentIdentity === undefined) {
      current.currentIdentity = identity
      return
    }
    this.generationStates.set(bookHash, {
      currentIdentity: identity,
      revision: this.allocateGenerationRevision(),
    })
  }

  private ensureGenerationState(bookHash: string): GenerationState {
    let state = this.generationStates.get(bookHash)
    if (!state) {
      state = { revision: this.allocateGenerationRevision() }
      this.generationStates.set(bookHash, state)
    }
    return state
  }

  private allocateGenerationRevision(): number {
    this.nextGenerationRevision++
    return this.nextGenerationRevision
  }

  private releaseGenerationState(bookHash: string): void {
    const prefix = `${bookHash}/`
    const hasLease = Array.from(this.leaseCounts).some(
      ([identity, count]) => count > 0 && identity.startsWith(prefix),
    )
    if (!hasLease) this.generationStates.delete(bookHash)
  }

  private markActiveGenerationsForDeletion(
    target: Set<string>,
    bookHash?: string,
    keepHash?: string,
  ): boolean {
    let marked = false
    for (const [identity, count] of this.leaseCounts) {
      if (count <= 0) continue
      const [identityBookHash, identityGenerationHash] = identity.split('/')
      if ((bookHash && identityBookHash !== bookHash)
        || (keepHash && identityGenerationHash === keepHash)) continue
      target.add(identity)
      marked = true
    }
    return marked
  }

  private async withBookLock<T>(bookHash: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.bookLocks.get(bookHash) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.bookLocks.set(bookHash, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.bookLocks.get(bookHash) === tail) this.bookLocks.delete(bookHash)
    }
  }

  private async releaseLease(leaseId: string): Promise<void> {
    const pendingLease = this.leases.get(leaseId)
    if (!pendingLease || pendingLease.released) return
    const separator = pendingLease.generationIdentity.indexOf('/')
    const bookHash = pendingLease.generationIdentity.slice(0, separator)
    await this.withBookLock(bookHash, async () => {
      const lease = this.leases.get(leaseId)
      if (!lease || lease.released) return
      lease.released = true
      this.leases.delete(leaseId)
      const count = Math.max(0, (this.leaseCounts.get(lease.generationIdentity) ?? 1) - 1)
      if (count > 0) {
        this.leaseCounts.set(lease.generationIdentity, count)
        return
      }
      this.leaseCounts.delete(lease.generationIdentity)
      if (this.isGenerationPinned(lease.generationIdentity)) return
      const manuallyDeleted = this.manualDeleteOnRelease.delete(lease.generationIdentity)
      const obsolete = this.obsoleteDeleteOnRelease.delete(lease.generationIdentity)
      const shouldDelete = manuallyDeleted
        || (obsolete && !this.isCurrentGeneration(lease.generationIdentity))
      if (!shouldDelete) return
      try {
        await this.removePath(join(this.rootPath, 'assets', lease.generationIdentity))
        await this.refreshUsage()
      } catch (error) {
        logger.warn('cache.deferred-delete.failed', '活动缓存释放后的延迟清理失败', { error })
      }
    })
  }

  private async ensureCapacity(): Promise<boolean> {
    try {
      await this.initialize()
      if (this.usageBytes === null) await this.refreshUsage()
      const disk = await this.statDisk()
      const limits = calculateCacheLimits(disk.totalBytes)
      if ((this.usageBytes ?? Number.POSITIVE_INFINITY) + this.pendingWriteBytes > limits.highWatermarkBytes
        || disk.freeBytes - this.pendingWriteBytes < limits.minimumFreeBytes) {
        await this.prune('quota')
        const refreshedDisk = await this.statDisk()
        const refreshedLimits = calculateCacheLimits(refreshedDisk.totalBytes)
        return (this.usageBytes ?? Number.POSITIVE_INFINITY) + this.pendingWriteBytes <= refreshedLimits.highWatermarkBytes
          && refreshedDisk.freeBytes - this.pendingWriteBytes >= refreshedLimits.minimumFreeBytes
      }
      return true
    } catch (error) {
      logger.warn('cache.capacity.failed', '缓存空间检查失败，本次不写入缓存', { error })
      return false
    }
  }

  private async performPrune(reason: CachePruneReason): Promise<void> {
    const startedAt = this.now()
    try {
      await this.initialize()
      await this.removeOldTemporaryFiles(this.rootPath)
      await this.removeCorruptCacheEntries()
      const currentGenerations = await this.currentGenerations()
      const candidates: Array<{
        path: string
        identity: string
        bookHash: string
        generationHash: string
        lastUsedAt: number
      }> = []
      const seenCurrentBooks = new Set<string>()
      const assetsRoot = join(this.rootPath, 'assets')
      for (const bookEntry of await this.safeReadDir(assetsRoot)) {
        if (!bookEntry.isDirectory() || bookEntry.isSymbolicLink()) continue
        await this.withBookLock(bookEntry.name, async () => {
          const bookPath = join(assetsRoot, bookEntry.name)
          const current = await this.readCurrentGeneration(bookEntry.name)
          for (const generationEntry of await this.safeReadDir(bookPath)) {
            if (!generationEntry.isDirectory() || generationEntry.isSymbolicLink()) continue
            const identity = `${bookEntry.name}/${generationEntry.name}`
            const generationPath = join(bookPath, generationEntry.name)
            if (this.isGenerationPinned(identity)) continue
            if (!current || current.generationHash !== generationEntry.name) {
              await this.removePath(generationPath)
              continue
            }
            seenCurrentBooks.add(bookEntry.name)
            await this.removeUnusedGenerationEntries(generationPath)
            const generationLastUsedAt = await latestMtime(generationPath)
            const snapshotExpired = this.now() - current.snapshotLastUsedAt > UNUSED_MAX_AGE_MS
            const generationExpired = generationLastUsedAt === 0
              || this.now() - generationLastUsedAt > UNUSED_MAX_AGE_MS
            if (snapshotExpired && generationExpired) {
              await this.removePath(generationPath)
              await this.removePath(join(this.rootPath, 'books', bookEntry.name))
              this.releaseGenerationState(bookEntry.name)
              continue
            }
            const lastUsedAt = Math.max(generationLastUsedAt, current.snapshotLastUsedAt)
            candidates.push({
              path: generationPath,
              identity,
              bookHash: bookEntry.name,
              generationHash: generationEntry.name,
              lastUsedAt,
            })
          }
          if (!current && (await this.safeReadDir(bookPath)).length === 0) {
            this.releaseGenerationState(bookEntry.name)
          }
        })
      }
      for (const [bookHash] of currentGenerations) {
        await this.withBookLock(bookHash, async () => {
          const latest = await this.readCurrentGeneration(bookHash)
          if (!latest
            || seenCurrentBooks.has(bookHash)
            || this.isGenerationPinned(`${bookHash}/${latest.generationHash}`)
            || this.now() - latest.snapshotLastUsedAt <= UNUSED_MAX_AGE_MS) return
          await this.removePath(join(this.rootPath, 'books', bookHash))
          this.releaseGenerationState(bookHash)
        })
      }
      await this.refreshUsage()
      let disk = await this.statDisk()
      let limits = calculateCacheLimits(disk.totalBytes)
      const reservedBytes = reason === 'quota' ? this.pendingWriteBytes : 0
      if ((this.usageBytes ?? 0) + reservedBytes > limits.highWatermarkBytes
        || disk.freeBytes - reservedBytes < limits.minimumFreeBytes) {
        candidates.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
        for (const candidate of candidates) {
          const usageGoal = Math.min(
            limits.targetWatermarkBytes,
            Math.max(0, limits.highWatermarkBytes - reservedBytes),
          )
          if ((this.usageBytes ?? 0) <= usageGoal
            && disk.freeBytes - reservedBytes >= limits.minimumFreeBytes) break
          let removed = false
          await this.withBookLock(candidate.bookHash, async () => {
            if (this.isGenerationPinned(candidate.identity)) return
            const current = await this.readCurrentGeneration(candidate.bookHash)
            if (current?.generationHash === candidate.generationHash) {
              const liveLastUsedAt = Math.max(
                current.snapshotLastUsedAt,
                await latestMtime(candidate.path),
              )
              if (liveLastUsedAt > candidate.lastUsedAt) return
            }
            await this.removePath(candidate.path)
            removed = true
          })
          if (!removed) continue
          await this.refreshUsage()
          disk = await this.statDisk()
          limits = calculateCacheLimits(disk.totalBytes)
        }
      }
      logger.info('cache.pruned', '缓存清理完成', {
        reason,
        usageBytes: this.usageBytes ?? 0,
        durationMs: Math.max(0, this.now() - startedAt),
      })
    } catch (error) {
      logger.warn('cache.prune.failed', '缓存清理失败，主流程继续运行', {
        reason,
        durationMs: Math.max(0, this.now() - startedAt),
        error,
      })
    }
  }

  private async currentGenerations(): Promise<Map<string, CurrentGeneration>> {
    const result = new Map<string, CurrentGeneration>()
    const booksRoot = join(this.rootPath, 'books')
    for (const bookEntry of await this.safeReadDir(booksRoot)) {
      if (!bookEntry.isDirectory() || bookEntry.isSymbolicLink()) continue
      const current = await this.withBookLock(
        bookEntry.name,
        () => this.readCurrentGeneration(bookEntry.name),
      )
      if (current) result.set(bookEntry.name, current)
    }
    return result
  }

  private async readCurrentGeneration(bookHash: string): Promise<CurrentGeneration | null> {
    const bookPath = join(this.rootPath, 'books', bookHash)
    const snapshotPath = join(bookPath, 'snapshot.json')
    try {
      const envelope = JSON.parse(await readFile(snapshotPath, 'utf8')) as unknown
      if (!isRecord(envelope)
        || envelope.schemaVersion !== CACHE_SCHEMA_VERSION
        || !isRecord(envelope.value)
        || !isRecord(envelope.value.version)) {
        throw new Error('invalid snapshot envelope')
      }
      const generationKey = envelope.value.version.generationKey
      if (typeof generationKey !== 'string' || !GENERATION_KEY.test(generationKey)) {
        throw new Error('invalid snapshot generation')
      }
      return {
        generationHash: hashCacheKey(generationKey),
        snapshotLastUsedAt: (await stat(snapshotPath)).mtimeMs,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') await this.removePath(bookPath)
      const assetsPath = join(this.rootPath, 'assets', bookHash)
      if ((await this.safeReadDir(assetsPath)).length === 0) {
        this.releaseGenerationState(bookHash)
      }
      return null
    }
  }

  private async removeCorruptCacheEntries(): Promise<void> {
    const assetsRoot = join(this.rootPath, 'assets')
    for (const bookEntry of await this.safeReadDir(assetsRoot)) {
      if (!bookEntry.isDirectory() || bookEntry.isSymbolicLink()) continue
      await this.withBookLock(bookEntry.name, async () => {
        const bookPath = join(assetsRoot, bookEntry.name)
        for (const generationEntry of await this.safeReadDir(bookPath)) {
          if (!generationEntry.isDirectory() || generationEntry.isSymbolicLink()) continue
          const generationPath = join(bookPath, generationEntry.name)
          for (const kindEntry of await this.safeReadDir(generationPath)) {
            if (!kindEntry.isDirectory() || kindEntry.isSymbolicLink()) continue
            const kindPath = join(generationPath, kindEntry.name)
            const entries = await this.safeReadDir(kindPath)
            const names = new Set(entries.map(entry => entry.name))
            for (const entry of entries) {
              if (!entry.isFile() || entry.isSymbolicLink()) continue
              const path = join(kindPath, entry.name)
              if (entry.name.endsWith('.bin')) {
                const prefix = entry.name.slice(0, -4)
                if (!names.has(`${prefix}.meta.json`)) await this.removePath(path)
                continue
              }
              if (entry.name.endsWith('.meta.json')) {
                const prefix = entry.name.slice(0, -'.meta.json'.length)
                const dataPath = join(kindPath, `${prefix}.bin`)
                try {
                  const metadata = JSON.parse(await readFile(path, 'utf8')) as unknown
                  if (!isRecord(metadata)
                    || metadata.schemaVersion !== CACHE_SCHEMA_VERSION
                    || typeof metadata.extension !== 'string'
                    || !EXTENSION.test(metadata.extension)
                    || typeof metadata.byteLength !== 'number'
                    || metadata.byteLength <= 0
                    || (await stat(dataPath)).size !== metadata.byteLength) {
                    throw new Error('invalid binary cache metadata')
                  }
                } catch {
                  await Promise.all([
                    this.removePath(path),
                    this.removePath(dataPath),
                  ])
                }
                continue
              }
              if (entry.name.endsWith('.json')) {
                try {
                  const envelope = JSON.parse(await readFile(path, 'utf8')) as unknown
                  if (!isRecord(envelope) || envelope.schemaVersion !== CACHE_SCHEMA_VERSION) {
                    throw new Error('invalid JSON cache envelope')
                  }
                } catch {
                  await this.removePath(path)
                }
              }
            }
          }
        }
      })
    }
  }

  private async removeUnusedGenerationEntries(generationPath: string): Promise<void> {
    for (const kindEntry of await this.safeReadDir(generationPath)) {
      if (!kindEntry.isDirectory() || kindEntry.isSymbolicLink()) continue
      const kindPath = join(generationPath, kindEntry.name)
      const entries = await this.safeReadDir(kindPath)
      const handledBinaryPrefixes = new Set<string>()
      for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue
        const entryPath = join(kindPath, entry.name)
        if (entry.name.endsWith('.bin') || entry.name.endsWith('.meta.json')) {
          const suffix = entry.name.endsWith('.bin') ? '.bin' : '.meta.json'
          const prefix = entry.name.slice(0, -suffix.length)
          if (handledBinaryPrefixes.has(prefix)) continue
          handledBinaryPrefixes.add(prefix)
          const dataPath = join(kindPath, `${prefix}.bin`)
          const metadataPath = join(kindPath, `${prefix}.meta.json`)
          const lastUsedAt = Math.max(
            await this.fileMtime(dataPath),
            await this.fileMtime(metadataPath),
          )
          if (lastUsedAt > 0 && this.now() - lastUsedAt > UNUSED_MAX_AGE_MS) {
            await Promise.all([this.removePath(dataPath), this.removePath(metadataPath)])
          }
          continue
        }
        if (!entry.name.endsWith('.json')) continue
        const lastUsedAt = await this.fileMtime(entryPath)
        if (lastUsedAt > 0 && this.now() - lastUsedAt > UNUSED_MAX_AGE_MS) {
          await this.removePath(entryPath)
        }
      }
    }
  }

  private async removeOldTemporaryFiles(root: string): Promise<void> {
    for (const entry of await this.safeReadDir(root)) {
      if (entry.isSymbolicLink()) continue
      const child = join(root, entry.name)
      if (entry.isDirectory()) {
        await this.removeOldTemporaryFiles(child)
        continue
      }
      if (!entry.isFile() || !TEMP_FILE.test(entry.name)) continue
      try {
        if (this.now() - (await stat(child)).mtimeMs > TEMP_MAX_AGE_MS) {
          await this.removePath(child)
        }
      } catch {
        // A concurrent cleanup already removed the file.
      }
    }
  }

  private async touch(path: string): Promise<void> {
    const now = this.now()
    if (now - (this.lastTouched.get(path) ?? 0) < CACHE_TOUCH_INTERVAL_MS) return
    this.lastTouched.set(path, now)
    try {
      await utimes(path, new Date(now), new Date(now))
    } catch {
      this.lastTouched.delete(path)
      // Cache touch failures do not affect a successful read.
    }
  }

  private async removeCorrupt(paths: string[], kind: CacheEntryKind): Promise<void> {
    await Promise.all(paths.map(path => this.removePath(path).catch(() => undefined)))
    await this.refreshUsage()
    logger.warn('cache.corrupt', '已忽略并清理损坏缓存', { cacheType: kind })
  }

  private async removePath(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true })
    const prefix = `${path}${sep}`
    for (const touchedPath of this.lastTouched.keys()) {
      if (touchedPath === path || touchedPath.startsWith(prefix)) {
        this.lastTouched.delete(touchedPath)
      }
    }
  }

  private async safeReadDir(path: string) {
    try {
      return await readdir(path, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw error
    }
  }

  private async fileSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  private async fileMtime(path: string): Promise<number> {
    try {
      return (await stat(path)).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
      throw error
    }
  }

  private adjustUsage(delta: number): void {
    if (this.usageBytes !== null) this.usageBytes = Math.max(0, this.usageBytes + delta)
  }

  private async refreshUsage(): Promise<void> {
    try {
      this.usageBytes = await pathSize(this.rootPath)
    } catch {
      this.usageBytes = null
    }
  }
}
