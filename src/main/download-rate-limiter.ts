export const DOWNLOAD_SPEED_TIERS = [
  { level: 0, name: '激进', chapterConcurrency: 5, imageConcurrency: 4, delayMs: 100, maxRetries: 1 },
  { level: 1, name: '中等', chapterConcurrency: 3, imageConcurrency: 2, delayMs: 500, maxRetries: 2 },
  { level: 2, name: '保守', chapterConcurrency: 2, imageConcurrency: 1, delayMs: 1000, maxRetries: 3 },
  { level: 3, name: '兜底', chapterConcurrency: 1, imageConcurrency: 1, delayMs: 2000, maxRetries: 3 },
] as const

const SUCCESS_RESET_THRESHOLD = 10

type Scheduler = (callback: () => void, delayMs: number) => unknown

export class DownloadRateLimiter {
  private speedTier = 0
  private consecutiveSuccess = 0
  private tierLock = false
  private lockGeneration = 0

  constructor(private readonly schedule: Scheduler = setTimeout) {}

  get speed(): typeof DOWNLOAD_SPEED_TIERS[number] {
    return DOWNLOAD_SPEED_TIERS[this.speedTier]
  }

  private lockTier(delayMs: number): void {
    this.tierLock = true
    const generation = ++this.lockGeneration
    this.schedule(() => {
      if (this.lockGeneration === generation) this.tierLock = false
    }, delayMs)
  }

  record(status: number): void {
    if (status === 429) {
      this.consecutiveSuccess = 0
      if (this.speedTier < DOWNLOAD_SPEED_TIERS.length - 1) {
        this.speedTier = Math.max(this.speedTier, 2)
      }
      console.warn(`[下载] 检测到 429 限流，限制为「${this.speed.name}」等级并进入 30 秒冷却期`)
      this.lockTier(30000)
    } else if (status === 503) {
      this.consecutiveSuccess = 0
      if (!this.tierLock && this.speedTier < DOWNLOAD_SPEED_TIERS.length - 1) {
        this.speedTier++
        console.warn(`[下载] 检测到 503，降级至「${this.speed.name}」等级`)
        this.lockTier(10000)
      }
    } else if (status === 403) {
      this.consecutiveSuccess = 0
      console.warn('[下载] 检测到 403，Cookie 可能已过期')
    } else if (status === 200) {
      this.consecutiveSuccess++
      if (!this.tierLock && this.consecutiveSuccess >= SUCCESS_RESET_THRESHOLD && this.speedTier > 0) {
        this.speedTier--
        this.consecutiveSuccess = 0
        console.log(`[下载] 连续成功 ${SUCCESS_RESET_THRESHOLD} 次，升级至「${this.speed.name}」等级`)
        this.lockTier(5000)
      }
    }
  }
}

export const sharedDownloadRateLimiter = new DownloadRateLimiter()
