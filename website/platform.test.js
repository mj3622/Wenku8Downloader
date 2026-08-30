import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectPlatform, selectPrimaryDownload } from './platform.js'

describe('website platform selection', () => {
  it('asks macOS users to choose a chip without guessing architecture', () => {
    assert.equal(detectPlatform({ platform: 'MacIntel' }), 'mac')
    assert.deepEqual(selectPrimaryDownload({ platform: 'MacIntel' }), {
      platform: 'mac',
      label: '选择 macOS 版本',
      assetKey: null,
    })
  })

  it('offers the portable Windows build', () => {
    assert.equal(detectPlatform({ userAgentData: { platform: 'Windows' } }), 'windows')
    assert.deepEqual(selectPrimaryDownload({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), {
      platform: 'windows',
      label: '下载 Windows 版',
      assetKey: 'windowsX64',
    })
  })

  it('keeps the Releases fallback for Linux and other systems', () => {
    assert.deepEqual(selectPrimaryDownload({ platform: 'Linux x86_64' }), {
      platform: 'other',
      label: '查看全部版本',
      assetKey: 'releases',
    })
  })
})
