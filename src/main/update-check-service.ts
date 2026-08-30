import type { UpdateCheckResult } from '../shared/ipc-types'

const RELEASE_API_URL = 'https://api.github.com/repos/mj3622/Wenku8Downloader/releases/latest'
const RELEASE_PATH_PREFIX = '/mj3622/Wenku8Downloader/releases/'
const SUCCESS_CACHE_MS = 60 * 60 * 1000
const FORCED_REFRESH_COOLDOWN_MS = 60 * 1000
const MAX_RESPONSE_LENGTH = 64 * 1024
const SEMVER_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

interface FetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

type RequestRelease = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponse>

interface UpdateCheckServiceOptions {
  request: RequestRelease
  getCurrentVersion: () => string
  now?: () => number
}

interface CachedResult {
  value: UpdateCheckResult
  fetchedAt: number
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.match(SEMVER_PATTERN)
  if (!match) return null
  const parts = match.slice(1).map(Number) as [number, number, number]
  return parts.every(Number.isSafeInteger) ? parts : null
}

export function compareSemver(left: string, right: string): number {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) throw new Error('版本信息格式无效')
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1
    }
  }
  return 0
}

function parseReleaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:'
      || url.hostname !== 'github.com'
      || !url.pathname.startsWith(RELEASE_PATH_PREFIX)) return null
    return url.toString()
  } catch {
    return null
  }
}

function parseReleasePayload(value: unknown): {
  latestVersion: string
  releaseUrl: string
  publishedAt: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub 发布信息格式无效')
  }
  const release = value as Record<string, unknown>
  const latestVersion = typeof release.tag_name === 'string'
    ? release.tag_name.replace(/^v/, '')
    : ''
  const releaseUrl = parseReleaseUrl(release.html_url)
  const publishedAt = typeof release.published_at === 'string' ? release.published_at : ''
  if (!parseVersion(latestVersion)
    || !releaseUrl
    || !publishedAt
    || !Number.isFinite(Date.parse(publishedAt))
    || release.draft !== false
    || release.prerelease !== false) {
    throw new Error('GitHub 发布信息格式无效')
  }
  return { latestVersion, releaseUrl, publishedAt }
}

function cloneResult(value: UpdateCheckResult): UpdateCheckResult {
  return { ...value }
}

export class UpdateCheckService {
  private readonly request: RequestRelease
  private readonly getCurrentVersion: () => string
  private readonly now: () => number
  private cache: CachedResult | null = null
  private lastForcedAt: number | null = null
  private inflight: Promise<UpdateCheckResult> | null = null

  constructor(options: UpdateCheckServiceOptions) {
    this.request = options.request
    this.getCurrentVersion = options.getCurrentVersion
    this.now = options.now ?? Date.now
  }

  async check(options: { refresh?: boolean } = {}): Promise<UpdateCheckResult> {
    const now = this.now()
    if (options.refresh
      && this.lastForcedAt !== null
      && Math.max(0, now - this.lastForcedAt) < FORCED_REFRESH_COOLDOWN_MS) {
      if (this.cache) return cloneResult(this.cache.value)
      throw new Error('检查更新过于频繁，请稍后再试')
    }
    if (!options.refresh
      && this.cache
      && Math.max(0, now - this.cache.fetchedAt) <= SUCCESS_CACHE_MS) {
      return cloneResult(this.cache.value)
    }
    if (this.inflight) return cloneResult(await this.inflight)
    if (options.refresh) this.lastForcedAt = now

    this.inflight = this.fetchLatest().finally(() => {
      this.inflight = null
    })
    const value = await this.inflight
    this.cache = { value, fetchedAt: this.now() }
    return cloneResult(value)
  }

  private async fetchLatest(): Promise<UpdateCheckResult> {
    const currentVersion = this.getCurrentVersion()
    if (!parseVersion(currentVersion)) throw new Error('当前应用版本格式无效')
    const response = await this.request(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Wenku8Downloader',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (!response.ok) throw new Error(`GitHub 版本检查失败（${response.status}）`)
    const body = await response.text()
    if (body.length === 0 || body.length > MAX_RESPONSE_LENGTH) {
      throw new Error('GitHub 发布信息格式无效')
    }
    let rawRelease: unknown
    try {
      rawRelease = JSON.parse(body)
    } catch {
      throw new Error('GitHub 发布信息格式无效')
    }
    const release = parseReleasePayload(rawRelease)
    return {
      currentVersion,
      latestVersion: release.latestVersion,
      updateAvailable: compareSemver(release.latestVersion, currentVersion) > 0,
      releaseUrl: release.releaseUrl,
      checkedAt: this.now(),
    }
  }
}
