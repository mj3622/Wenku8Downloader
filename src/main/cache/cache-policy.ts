export const MIB = 1024 ** 2
export const GIB = 1024 ** 3
export const CACHE_SCHEMA_VERSION = 1 as const
export const TEMP_MAX_AGE_MS = 60 * 60 * 1000
export const UNUSED_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
export const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000
export const CACHE_TOUCH_INTERVAL_MS = 60 * 60 * 1000

export interface CacheLimits {
  quotaBytes: number
  highWatermarkBytes: number
  targetWatermarkBytes: number
  minimumFreeBytes: number
}

export function calculateCacheLimits(totalDiskBytes: number): CacheLimits {
  if (!Number.isFinite(totalDiskBytes) || totalDiskBytes <= 0) {
    throw new TypeError('totalDiskBytes must be a positive finite number')
  }
  const quotaBytes = Math.min(2 * GIB, Math.max(512 * MIB, totalDiskBytes * 0.02))
  return {
    quotaBytes,
    highWatermarkBytes: quotaBytes * 0.9,
    targetWatermarkBytes: quotaBytes * 0.75,
    minimumFreeBytes: Math.max(GIB, Math.min(totalDiskBytes * 0.05, 10 * GIB)),
  }
}
