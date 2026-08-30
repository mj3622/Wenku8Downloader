import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createDownloadLinks } from './download-links.js'

describe('website download links', () => {
  it('matches electron-builder artifact names', () => {
    const links = createDownloadLinks('2.2.0')
    assert.deepEqual({
      macArm64: links.macArm64.split('/').at(-1),
      macX64: links.macX64.split('/').at(-1),
      windowsX64: links.windowsX64.split('/').at(-1),
      releases: links.releases,
    }, {
      macArm64: 'Wenku8Downloader-2.2.0-macOS-arm64.dmg',
      macX64: 'Wenku8Downloader-2.2.0-macOS-x64.dmg',
      windowsX64: 'Wenku8Downloader-2.2.0-Windows-x64.exe',
      releases: 'https://github.com/mj3622/Wenku8Downloader/releases',
    })
  })

  it('rejects invalid or prerelease versions', () => {
    assert.throws(() => createDownloadLinks('v2.2.0'))
    assert.throws(() => createDownloadLinks('2.2.0-beta.1'))
  })
})
