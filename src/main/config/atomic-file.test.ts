import { chmodSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { atomicWriteFile, backupInvalidFile } from './atomic-file'

let root: string

describe('atomicWriteFile', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-atomic-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('replaces the target and leaves no temporary file', async () => {
    const target = join(root, 'settings.toml')
    await writeFile(target, 'old', 'utf-8')

    atomicWriteFile(target, 'new')

    await expect(readFile(target, 'utf-8')).resolves.toBe('new')
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('tightens an existing directory before writing', async () => {
    await chmod(root, 0o755)
    const chmodPath = vi.fn(chmodSync)
    const target = join(root, 'settings.toml')

    atomicWriteFile(target, 'value', { chmodSync: chmodPath })

    expect(chmodPath).toHaveBeenCalledWith(root, 0o700)
    if (process.platform !== 'win32') {
      expect((await stat(root)).mode & 0o777).toBe(0o700)
      expect((await stat(target)).mode & 0o777).toBe(0o600)
    }
  })

  it('preserves the old target and cleans up when replacement fails', async () => {
    const target = join(root, 'settings.toml')
    await writeFile(target, 'old', 'utf-8')

    expect(() => atomicWriteFile(target, 'new', {
      renameSync: () => { throw new Error('rename failed') },
    })).toThrow('rename failed')

    await expect(readFile(target, 'utf-8')).resolves.toBe('old')
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('creates a collision-safe recovery backup', async () => {
    const target = join(root, 'settings.toml')
    await writeFile(target, 'recover-me', 'utf-8')
    await writeFile(`${target}.invalid-123`, 'existing-backup', 'utf-8')

    expect(backupInvalidFile(target, () => 123)).toBe(`${target}.invalid-123-1`)

    await expect(readFile(`${target}.invalid-123`, 'utf-8')).resolves.toBe('existing-backup')
    await expect(readFile(`${target}.invalid-123-1`, 'utf-8')).resolves.toBe('recover-me')
  })

  it('tightens a legacy plaintext file before renaming it as invalid', async () => {
    const target = join(root, 'secrets.toml')
    await chmod(root, 0o755)
    await writeFile(target, 'password = "sentinel"', { mode: 0o644 })

    const backup = backupInvalidFile(target, () => 123)

    expect(backup).toBe(`${target}.invalid-123`)
    if (process.platform !== 'win32') {
      expect((await stat(root)).mode & 0o777).toBe(0o700)
      expect((await stat(backup!)).mode & 0o777).toBe(0o600)
    }
  })
})
