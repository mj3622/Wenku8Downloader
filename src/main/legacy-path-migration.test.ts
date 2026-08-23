import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Rename = typeof import('fs/promises')['rename']

const fsMocks = vi.hoisted(() => ({
  rename: vi.fn(),
  actualRename: undefined as Rename | undefined,
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  fsMocks.actualRename = actual.rename
  return { ...actual, rename: fsMocks.rename }
})

import { migrateLegacyPath, migrateLegacyVolumeCache } from './legacy-cache-migration'

describe('legacy path migration', () => {
  let root = ''

  beforeEach(async () => {
    fsMocks.rename.mockReset()
    fsMocks.rename.mockImplementation((oldPath, newPath) =>
      fsMocks.actualRename!(oldPath, newPath),
    )
    root = await mkdtemp(join(tmpdir(), 'wenku8-migrate-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('moves old chapter and image caches within their book ID directory', async () => {
    const legacyImageDir = join(root, 'images', '第一卷_开始')
    const legacyChapterDir = join(root, 'chapters', '第一卷_开始')
    await mkdir(legacyImageDir, { recursive: true })
    await mkdir(legacyChapterDir, { recursive: true })
    await writeFile(join(legacyImageDir, '0.bin'), 'legacy-image')
    await writeFile(join(legacyImageDir, '0.meta'), 'jpg')
    await writeFile(join(legacyChapterDir, '0.json'), '{"title":"第一章","content":"正文"}')

    await migrateLegacyVolumeCache(
      root,
      '第一卷：开始',
      '1_第一卷_开始',
      ['第一卷：开始'],
    )

    await expect(readFile(join(root, 'images', '1_第一卷_开始', '0.bin'), 'utf-8'))
      .resolves.toBe('legacy-image')
    await expect(readFile(join(root, 'images', '1_第一卷_开始', '0.meta'), 'utf-8'))
      .resolves.toBe('jpg')
    await expect(readFile(join(root, 'chapters', '1_第一卷_开始', '0.json'), 'utf-8'))
      .resolves.toContain('第一章')
  })

  it('does not overwrite an existing collision-safe target', async () => {
    const legacyFile = join(root, 'novels', '测试作品.epub')
    const targetFile = join(root, 'novels', '100_测试作品.epub')
    await mkdir(join(root, 'novels'), { recursive: true })
    await writeFile(legacyFile, 'legacy')
    await writeFile(targetFile, 'current')

    const migrated = await migrateLegacyPath(
      root,
      ['novels', '测试作品.epub'],
      ['novels', '100_测试作品.epub'],
    )

    expect(migrated).toBe(false)
    await expect(readFile(legacyFile, 'utf-8')).resolves.toBe('legacy')
    await expect(readFile(targetFile, 'utf-8')).resolves.toBe('current')
  })

  it('merges missing legacy cache entries without overwriting current entries', async () => {
    const legacyDir = join(root, 'chapters', '第一卷')
    const targetDir = join(root, 'chapters', '1_第一卷')
    await mkdir(legacyDir, { recursive: true })
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(legacyDir, '0.json'), 'legacy-zero')
    await writeFile(join(legacyDir, '1.json'), 'legacy-one')
    await writeFile(join(targetDir, '1.json'), 'current-one')

    await migrateLegacyVolumeCache(root, '第一卷', '1_第一卷', ['第一卷'])

    await expect(readFile(join(targetDir, '0.json'), 'utf-8')).resolves.toBe('legacy-zero')
    await expect(readFile(join(targetDir, '1.json'), 'utf-8')).resolves.toBe('current-one')
  })

  it('does not combine a partial current image cache with a legacy pair', async () => {
    const legacyDir = join(root, 'images', '第一卷')
    const targetDir = join(root, 'images', '1_第一卷')
    await mkdir(legacyDir, { recursive: true })
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(legacyDir, '0.bin'), 'legacy-image')
    await writeFile(join(legacyDir, '0.meta'), 'png')
    await writeFile(join(targetDir, '0.bin'), 'current-image')

    await migrateLegacyVolumeCache(root, '第一卷', '1_第一卷', ['第一卷'])

    await expect(readFile(join(targetDir, '0.bin'), 'utf-8')).resolves.toBe('current-image')
    await expect(readFile(join(targetDir, '0.meta'), 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(legacyDir, '0.bin'), 'utf-8')).resolves.toBe('legacy-image')
    await expect(readFile(join(legacyDir, '0.meta'), 'utf-8')).resolves.toBe('png')
  })

  it('rolls back image data when moving its metadata fails', async () => {
    const legacyDir = join(root, 'images', '第一卷')
    const targetDir = join(root, 'images', '1_第一卷')
    await mkdir(legacyDir, { recursive: true })
    await mkdir(targetDir, { recursive: true })
    await writeFile(join(legacyDir, '0.bin'), 'legacy-image')
    await writeFile(join(legacyDir, '0.meta'), 'png')
    fsMocks.rename.mockImplementation(async (oldPath, newPath) => {
      if (String(oldPath).endsWith('0.meta')) {
        throw Object.assign(new Error('metadata move failed'), { code: 'EIO' })
      }
      await fsMocks.actualRename!(oldPath, newPath)
    })

    await expect(
      migrateLegacyVolumeCache(root, '第一卷', '1_第一卷', ['第一卷']),
    ).rejects.toThrow('metadata move failed')

    await expect(readFile(join(legacyDir, '0.bin'), 'utf-8')).resolves.toBe('legacy-image')
    await expect(readFile(join(legacyDir, '0.meta'), 'utf-8')).resolves.toBe('png')
    await expect(readFile(join(targetDir, '0.bin'), 'utf-8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(join(targetDir, '0.meta'), 'utf-8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not assign an ambiguous legacy cache key to either colliding volume', async () => {
    const legacyDir = join(root, 'chapters', '卷_A')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(join(legacyDir, '0.json'), 'ambiguous-content')

    await migrateLegacyVolumeCache(
      root,
      '卷:A',
      '1_卷_A',
      ['卷:A', '卷?A'],
    )

    await expect(readFile(join(legacyDir, '0.json'), 'utf-8'))
      .resolves.toBe('ambiguous-content')
    await expect(readFile(join(root, 'chapters', '1_卷_A', '0.json'), 'utf-8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })
})
