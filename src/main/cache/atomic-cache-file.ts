import { randomUUID } from 'crypto'
import { mkdir, open, rename, rm } from 'fs/promises'
import { basename, dirname } from 'path'
import { resolveWithin } from '../path-safety'

export interface AtomicCacheWriteOptions {
  canCommit?: () => boolean
}

export async function atomicWriteCacheFile(
  targetPath: string,
  content: Buffer,
  options: AtomicCacheWriteOptions = {},
): Promise<boolean> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = resolveWithin(
    dirname(targetPath),
    `.${basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
  )
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(tempPath, 'wx', 0o600)
    await handle.writeFile(content)
    await handle.sync()
    await handle.close()
    handle = undefined
    if (options.canCommit && !options.canCommit()) {
      await rm(tempPath, { force: true })
      return false
    }
    await rename(tempPath, targetPath)
    return true
  } catch (error) {
    if (handle) {
      try {
        await handle.close()
      } catch {
        // Preserve the original write failure.
      }
    }
    try {
      await rm(tempPath, { force: true })
    } catch {
      // Preserve the original write failure.
    }
    throw error
  }
}

export function atomicWriteCacheJson(
  targetPath: string,
  value: unknown,
  options?: AtomicCacheWriteOptions,
): Promise<boolean> {
  return atomicWriteCacheFile(
    targetPath,
    Buffer.from(JSON.stringify(value), 'utf8'),
    options,
  )
}
