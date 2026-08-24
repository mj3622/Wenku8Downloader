import { describe, expect, it } from 'vitest'
import { getLogDirectory } from '../logger'

describe('logger public errors', () => {
  it('uses a recovery hint when the log directory is not ready', () => {
    expect(() => getLogDirectory())
      .toThrow('日志目录暂时不可用，请重启应用后再试')
  })
})
