import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDownloadArtifactRecord,
  isDownloadArtifactAvailable,
  resolveDownloadArtifactTarget,
} from '../download-artifacts'

const tempRoots: string[] = []

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wenku8-artifact-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('download artifacts', () => {
  it('records and resolves a canonical file inside the task download root', async () => {
    const rootPath = await tempRoot()
    const path = join(rootPath, 'novels', 'book.epub')
    await mkdir(join(rootPath, 'novels'), { recursive: true })
    await writeFile(path, 'epub')

    const record = await createDownloadArtifactRecord({
      id: 'primary',
      name: 'book.epub',
      kind: 'file',
      path,
      rootPath,
    })

    const canonicalRoot = await realpath(rootPath)
    const canonicalPath = await realpath(path)
    expect(record).toEqual({
      id: 'primary',
      name: 'book.epub',
      kind: 'file',
      path: canonicalPath,
      rootPath: canonicalRoot,
    })
    expect(isDownloadArtifactAvailable(record)).toBe(true)
    await expect(resolveDownloadArtifactTarget(record)).resolves.toEqual({
      path: canonicalPath,
      kind: 'file',
    })
  })

  it('marks a deleted artifact unavailable and returns stable feedback', async () => {
    const rootPath = await tempRoot()
    const path = join(rootPath, 'pics', 'book')
    await mkdir(path, { recursive: true })
    const record = await createDownloadArtifactRecord({
      id: 'primary',
      name: 'book',
      kind: 'directory',
      path,
      rootPath,
    })
    await rm(path, { recursive: true })

    expect(isDownloadArtifactAvailable(record)).toBe(false)
    await expect(resolveDownloadArtifactTarget(record)).rejects.toThrow('下载文件已被移动或删除')
  })

  it('rejects lexical and symbolic-link escapes', async () => {
    const rootPath = await tempRoot()
    const outside = await tempRoot()
    const outsideFile = join(outside, 'outside.epub')
    await writeFile(outsideFile, 'outside')
    await symlink(outside, join(rootPath, 'linked'))

    await expect(createDownloadArtifactRecord({
      id: 'primary',
      name: 'outside.epub',
      kind: 'file',
      path: outsideFile,
      rootPath,
    })).rejects.toThrow('下载产物超出任务目录')
    await expect(createDownloadArtifactRecord({
      id: 'primary',
      name: 'outside.epub',
      kind: 'file',
      path: join(rootPath, 'linked', 'outside.epub'),
      rootPath,
    })).rejects.toThrow('下载产物超出任务目录')
  })

  it('rejects invalid names and target kinds', async () => {
    const rootPath = await tempRoot()
    const path = join(rootPath, 'book.epub')
    await writeFile(path, 'epub')

    await expect(createDownloadArtifactRecord({
      id: 'primary',
      name: '',
      kind: 'file',
      path,
      rootPath,
    })).rejects.toThrow('下载产物名称无效')
    await expect(createDownloadArtifactRecord({
      id: 'primary',
      name: 'a'.repeat(201),
      kind: 'file',
      path,
      rootPath,
    })).rejects.toThrow('下载产物名称无效')
    await expect(createDownloadArtifactRecord({
      id: 'primary',
      name: 'book.epub',
      kind: 'directory',
      path,
      rootPath,
    })).rejects.toThrow('下载产物类型不匹配')
  })
})
