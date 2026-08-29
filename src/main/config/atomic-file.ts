import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'

export interface AtomicFileOps {
  chmodSync: typeof chmodSync
  mkdirSync: typeof mkdirSync
  openSync: typeof openSync
  writeFileSync: typeof writeFileSync
  fsyncSync: typeof fsyncSync
  closeSync: typeof closeSync
  renameSync: typeof renameSync
  rmSync: typeof rmSync
}

function enforcePrivateMode(
  targetPath: string,
  mode: number,
  chmod: typeof chmodSync = chmodSync,
): void {
  try {
    chmod(targetPath, mode)
  } catch (error) {
    if (process.platform !== 'win32') throw error
  }
}

export function backupInvalidFile(
  targetPath: string,
  now: () => number = Date.now,
): string | null {
  if (!existsSync(targetPath)) return null
  const backupBase = `${targetPath}.invalid-${now()}`
  let backupPath = backupBase
  let suffix = 1
  while (existsSync(backupPath)) {
    backupPath = `${backupBase}-${suffix++}`
  }
  enforcePrivateMode(dirname(targetPath), 0o700)
  enforcePrivateMode(targetPath, 0o600)
  renameSync(targetPath, backupPath)
  return backupPath
}

const DEFAULT_OPS: AtomicFileOps = {
  chmodSync,
  mkdirSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
  rmSync,
}

export function atomicWriteFile(
  targetPath: string,
  content: string | Buffer,
  overrides: Partial<AtomicFileOps> = {},
): void {
  const ops = { ...DEFAULT_OPS, ...overrides }
  const targetDir = dirname(targetPath)
  const tempPath = join(
    targetDir,
    `.${basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`,
  )
  let descriptor: number | null = null

  ops.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
  enforcePrivateMode(targetDir, 0o700, ops.chmodSync)
  try {
    descriptor = ops.openSync(tempPath, 'wx', 0o600)
    ops.writeFileSync(descriptor, content)
    ops.fsyncSync(descriptor)
    ops.closeSync(descriptor)
    descriptor = null
    ops.renameSync(tempPath, targetPath)
  } catch (error) {
    if (descriptor !== null) {
      try {
        ops.closeSync(descriptor)
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      ops.rmSync(tempPath, { force: true })
    } catch {
      // Preserve the original write error.
    }
    throw error
  }
}
