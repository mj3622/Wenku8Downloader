import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { resolveCacheRoot } from '../cache-paths'

describe('resolveCacheRoot', () => {
  it('uses userData in packaged builds', () => {
    expect(resolveCacheRoot({
      isPackaged: true,
      userDataPath: join('/tmp', 'user-data'),
      devRoot: join('/tmp', 'repo'),
    })).toBe(join('/tmp', 'user-data', 'cache-v1'))
  })

  it('uses the isolated development data directory', () => {
    expect(resolveCacheRoot({
      isPackaged: false,
      userDataPath: join('/tmp', 'ignored'),
      devRoot: join('/tmp', 'repo'),
    })).toBe(join('/tmp', 'repo', '.dev-user-data', 'cache-v1'))
  })
})
