import { describe, expect, it } from 'vitest'
import { formatBookTitle } from '../title-format'

describe('formatBookTitle', () => {
  it.each([
    ['FULL', '败北女角太多了！(败犬女主太多了！)', '败北女角太多了！(败犬女主太多了！)'],
    ['IN', '败北女角太多了！(败犬女主太多了！)', '败犬女主太多了！'],
    ['OUT', '败北女角太多了！(败犬女主太多了！)', '败北女角太多了！'],
    ['IN', '没有括号的作品', '没有括号的作品'],
    ['OUT', '没有括号的作品', '没有括号的作品'],
  ] as const)(
    'formats %s titles without changing unsupported title shapes',
    (format, title, expected) => {
      expect(formatBookTitle(title, format)).toBe(expected)
    },
  )
})
