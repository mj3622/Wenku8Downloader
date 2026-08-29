import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { atomicWriteCacheFile, atomicWriteCacheJson } from '../atomic-cache-file'

const roots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-atomic-cache-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('atomic cache writes', () => {
  it('atomically replaces an existing file', async () => {
    const root = await tempRoot()
    const target = join(root, 'nested', 'value.json')
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(target, 'old')
    await expect(atomicWriteCacheJson(target, { value: 'new' })).resolves.toBe(true)
    expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ value: 'new' })
  })

  it('removes the temporary file when an epoch guard rejects commit', async () => {
    const root = await tempRoot()
    const target = join(root, 'value.bin')
    await writeFile(target, 'old')
    await expect(atomicWriteCacheFile(target, Buffer.from('new'), {
      canCommit: () => false,
    })).resolves.toBe(false)
    expect(await readFile(target, 'utf8')).toBe('old')
    expect((await readdir(root)).filter(name => name.includes('.tmp-'))).toEqual([])
  })

  it('cleans the temporary file after rename failure', async () => {
    const root = await tempRoot()
    const target = join(root, 'occupied')
    await mkdir(target)
    await writeFile(join(target, 'keep'), 'x')
    await expect(atomicWriteCacheFile(target, Buffer.from('new'))).rejects.toThrow()
    expect((await readdir(root)).filter(name => name.includes('.tmp-'))).toEqual([])
  })
})
