import { describe, it, expect } from 'vitest'
import { guessType } from './downloader'

describe('guessType', () => {
  it('returns jpeg for unknown extensions', () => {
    expect(guessType('unknown')).toBe('image/jpeg')
  })

  it('returns png for .png', () => {
    expect(guessType('png')).toBe('image/png')
  })

  it('returns gif for .gif', () => {
    expect(guessType('gif')).toBe('image/gif')
  })

  it('returns webp for .webp', () => {
    expect(guessType('webp')).toBe('image/webp')
  })

  it('returns svg for .svg', () => {
    expect(guessType('svg')).toBe('image/svg+xml')
  })

  it('handles uppercase extensions', () => {
    expect(guessType('PNG')).toBe('image/png')
    expect(guessType('JPG')).toBe('image/jpeg')
  })

  it('returns jpeg for .jpg', () => {
    expect(guessType('jpg')).toBe('image/jpeg')
  })

  it('returns jpeg for .jpeg', () => {
    expect(guessType('jpeg')).toBe('image/jpeg')
  })
})

/** 内联 asyncPool 副本用于测试（避免导入 Electron 依赖的 downloader.ts） */
async function asyncPool<T, R>(
  concurrency: number,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!isFinite(concurrency)) {
    return Promise.all(items.map((item, i) => fn(item, i)))
  }
  const results: R[] = new Array(items.length)
  let idx = 0

  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  )
  await Promise.all(workers)
  return results
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('asyncPool', () => {
  it('保持结果顺序与输入一致', async () => {
    const items = [3, 1, 4, 1, 5]
    const results = await asyncPool(2, items, async (n) => {
      await sleep(n * 10)
      return n * 10
    })
    expect(results).toEqual([30, 10, 40, 10, 50])
  })

  it('限制并发数不超上限', async () => {
    let maxConcurrent = 0
    let running = 0
    const concurrency = 2
    const items = Array.from({ length: 8 }, (_, i) => i)

    await asyncPool(concurrency, items, async (i) => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await sleep(20 - i * 2)
      running--
      return i
    })

    expect(maxConcurrent).toBeLessThanOrEqual(concurrency)
  })

  it('concurrency=Infinity 时所有任务并行', async () => {
    let maxConcurrent = 0
    let running = 0
    const items = Array.from({ length: 10 }, (_, i) => i)

    await asyncPool(Infinity, items, async (i) => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await sleep(10)
      running--
      return i
    })

    expect(maxConcurrent).toBe(10)
  })

  it('单个任务失败时整体 reject', async () => {
    const items = [1, 2, 3, 4, 5]

    await expect(
      asyncPool(2, items, async (n) => {
        if (n === 3) throw new Error('任务3失败')
        await sleep(10)
        return n
      }),
    ).rejects.toThrow('任务3失败')
  })

  it('空数组直接返回空结果', async () => {
    const results = await asyncPool(5, [], async () => 'x')
    expect(results).toEqual([])
  })

  it('单元素数组正常工作', async () => {
    const results = await asyncPool(1, [42], async (n) => n * 2)
    expect(results).toEqual([84])
  })

  it('concurrency=1 时完全串行', async () => {
    let maxConcurrent = 0
    let running = 0

    await asyncPool(1, [1, 2, 3, 4, 5], async (i) => {
      running++
      maxConcurrent = Math.max(maxConcurrent, running)
      await sleep(5)
      running--
      return i
    })

    expect(maxConcurrent).toBe(1)
  })
})
