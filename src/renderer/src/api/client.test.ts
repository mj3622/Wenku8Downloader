import { describe, expectTypeOf, it } from 'vitest'
import type { ConfigApi } from '../../../shared/config-types'
import { api } from './client'

describe('renderer configuration API contract', () => {
  it('implements the complete shared configuration API', () => {
    expectTypeOf(api).toMatchTypeOf<ConfigApi>()
  })
})
