import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast, useToastStore } from '../toastStore'

beforeEach(() => {
  useToastStore.getState().clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('toastStore', () => {
  it('uses the approved default durations', () => {
    toast.success({ title: '完成', message: '设置已保存。' })
    toast.error({ title: '失败', message: '请稍后重试。' })

    expect(useToastStore.getState().items.map((item) => item.durationMs)).toEqual([
      7_000,
      4_000,
    ])
  })

  it('keeps only the newest three messages', () => {
    for (let index = 1; index <= 4; index += 1) {
      toast.info({ title: `消息 ${index}`, message: '测试内容' })
    }

    expect(useToastStore.getState().items.map((item) => item.title)).toEqual([
      '消息 4',
      '消息 3',
      '消息 2',
    ])
  })

  it('deduplicates identical messages within two seconds and refreshes them', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'))
    const firstId = toast.warning({ title: '请检查输入', message: '作品编号不能为空。' })
    vi.advanceTimersByTime(1_500)
    const secondId = toast.warning({ title: '请检查输入', message: '作品编号不能为空。' })

    expect(secondId).toBe(firstId)
    expect(useToastStore.getState().items).toHaveLength(1)

    vi.advanceTimersByTime(2_001)
    toast.warning({ title: '请检查输入', message: '作品编号不能为空。' })
    expect(useToastStore.getState().items).toHaveLength(2)
  })

  it('deduplicates identical content across tones and keeps the latest tone', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T00:00:00Z'))
    const firstId = toast.warning({ title: '操作未完成', message: '请稍后重试。' })
    vi.advanceTimersByTime(500)
    const secondId = toast.error({ title: '操作未完成', message: '请稍后重试。' })

    expect(secondId).toBe(firstId)
    expect(useToastStore.getState().items).toEqual([
      expect.objectContaining({ id: firstId, tone: 'error', durationMs: 7_000 }),
    ])
  })
})
