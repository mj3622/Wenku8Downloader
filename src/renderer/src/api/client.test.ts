import { describe, expectTypeOf, it } from 'vitest'
import type { ConfigApi } from '../../../shared/config-types'
import type { CacheApi, CatalogApi, DiscoveryApi, DownloadApi } from '../../../shared/ipc-types'
import { api } from './client'

describe('renderer configuration API contract', () => {
  it('implements the complete shared configuration API', () => {
    expectTypeOf(api).toMatchTypeOf<ConfigApi>()
  })

  it('implements the complete shared download API', () => {
    expectTypeOf(api).toMatchTypeOf<DownloadApi>()
  })

  it('implements the restricted cache API', () => {
    expectTypeOf(api).toMatchTypeOf<CacheApi>()
  })

  it('implements the restricted discovery API', () => {
    expectTypeOf(api).toMatchTypeOf<DiscoveryApi>()
  })

  it('implements the restricted catalog API', () => {
    expectTypeOf(api).toMatchTypeOf<CatalogApi>()
  })
})
