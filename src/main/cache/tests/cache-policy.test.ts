import { describe, expect, it } from 'vitest'
import { GIB, MIB, calculateCacheLimits } from '../cache-policy'

describe('calculateCacheLimits', () => {
  it('uses the 512 MiB lower quota bound', () => {
    expect(calculateCacheLimits(10 * GIB)).toEqual({
      quotaBytes: 512 * MIB,
      highWatermarkBytes: 512 * MIB * 0.9,
      targetWatermarkBytes: 512 * MIB * 0.75,
      minimumFreeBytes: GIB,
    })
  })

  it('uses the 2 GiB quota and 10 GiB free-space upper bounds', () => {
    expect(calculateCacheLimits(500 * GIB)).toEqual({
      quotaBytes: 2 * GIB,
      highWatermarkBytes: 2 * GIB * 0.9,
      targetWatermarkBytes: 2 * GIB * 0.75,
      minimumFreeBytes: 10 * GIB,
    })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid disk size %s',
    (value) => expect(() => calculateCacheLimits(value)).toThrow(TypeError),
  )
})
