import { describe, expect, it, vi } from 'vitest'
import { UpdateCheckService, compareSemver } from '../update-check-service'

function response(payload: unknown, options: { ok?: boolean; status?: number } = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    text: vi.fn(async () => JSON.stringify(payload)),
  }
}

function release(version = '2.2.0') {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/mj3622/Wenku8Downloader/releases/tag/v${version}`,
    published_at: '2026-08-30T00:00:00Z',
    draft: false,
    prerelease: false,
  }
}

describe('UpdateCheckService', () => {
  it('compares stable semantic versions without lexicographic errors', () => {
    expect(compareSemver('2.10.0', '2.9.9')).toBe(1)
    expect(compareSemver('2.1.0', '2.1.0')).toBe(0)
    expect(compareSemver('1.9.9', '2.0.0')).toBe(-1)
    expect(() => compareSemver('2.1', '2.1.0')).toThrow('版本信息格式')
  })

  it('requests only the fixed official release endpoint without credentials', async () => {
    const request = vi.fn(async () => response(release()))
    const service = new UpdateCheckService({ request, getCurrentVersion: () => '2.1.0' })

    await expect(service.check()).resolves.toMatchObject({
      currentVersion: '2.1.0',
      latestVersion: '2.2.0',
      updateAvailable: true,
      checkedAt: expect.any(Number),
    })
    expect(request).toHaveBeenCalledWith(
      'https://api.github.com/repos/mj3622/Wenku8Downloader/releases/latest',
      { headers: expect.not.objectContaining({ Authorization: expect.anything() }) },
    )
  })

  it('caches successful checks for one hour and rate limits forced refreshes', async () => {
    let now = 0
    const request = vi.fn(async () => response(release('2.1.0')))
    const service = new UpdateCheckService({
      request,
      getCurrentVersion: () => '2.1.0',
      now: () => now,
    })

    await service.check({ refresh: true })
    now = 30_000
    await expect(service.check({ refresh: true })).resolves.toMatchObject({ updateAvailable: false })
    now = 59 * 60 * 1000
    await expect(service.check()).resolves.toMatchObject({ updateAvailable: false })
    expect(request).toHaveBeenCalledTimes(1)
    now = 61 * 60 * 1000
    await service.check()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('treats equal or older latest releases as up to date', async () => {
    for (const latestVersion of ['2.1.0', '2.0.9']) {
      const service = new UpdateCheckService({
        request: async () => response(release(latestVersion)),
        getCurrentVersion: () => '2.1.0',
      })
      await expect(service.check()).resolves.toMatchObject({
        currentVersion: '2.1.0',
        latestVersion,
        updateAvailable: false,
      })
    }
  })

  it('rejects prereleases, untrusted release URLs and oversized responses', async () => {
    const prereleaseRequest = vi.fn(async () => response({ ...release(), prerelease: true }))
    await expect(new UpdateCheckService({
      request: prereleaseRequest,
      getCurrentVersion: () => '2.1.0',
    }).check()).rejects.toThrow('发布信息格式')

    const untrustedRequest = vi.fn(async () => response({
      ...release(),
      html_url: 'https://example.com/releases/tag/v2.2.0',
    }))
    await expect(new UpdateCheckService({
      request: untrustedRequest,
      getCurrentVersion: () => '2.1.0',
    }).check()).rejects.toThrow('发布信息格式')

    const oversizedRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => 'x'.repeat(64 * 1024 + 1),
    }))
    await expect(new UpdateCheckService({
      request: oversizedRequest,
      getCurrentVersion: () => '2.1.0',
    }).check()).rejects.toThrow('发布信息格式')
  })

  it('rejects drafts and invalid release tags', async () => {
    for (const payload of [
      { ...release(), draft: true },
      { ...release(), tag_name: 'release-2.2' },
    ]) {
      const service = new UpdateCheckService({
        request: async () => response(payload),
        getCurrentVersion: () => '2.1.0',
      })
      await expect(service.check()).rejects.toThrow('发布信息格式')
    }
  })

  it('isolates GitHub rate limits and network failures', async () => {
    const limited = new UpdateCheckService({
      request: async () => response({}, { ok: false, status: 429 }),
      getCurrentVersion: () => '2.1.0',
    })
    await expect(limited.check()).rejects.toThrow('GitHub 版本检查失败（429）')

    const offline = new UpdateCheckService({
      request: async () => { throw new Error('offline') },
      getCurrentVersion: () => '2.1.0',
    })
    await expect(offline.check()).rejects.toThrow('offline')
  })

  it('applies the refresh cooldown even after a failed forced request', async () => {
    let now = 0
    const request = vi.fn(async () => response({}, { ok: false, status: 503 }))
    const service = new UpdateCheckService({
      request,
      getCurrentVersion: () => '2.1.0',
      now: () => now,
    })

    await expect(service.check({ refresh: true })).rejects.toThrow('GitHub 版本检查失败')
    now = 1_000
    await expect(service.check({ refresh: true })).rejects.toThrow('检查更新过于频繁')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
