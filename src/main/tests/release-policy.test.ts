import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface ReleaseBuildConfig {
  build?: {
    mac?: {
      identity?: string | null
      notarize?: boolean
    }
    win?: {
      signExecutable?: boolean
    }
  }
}

describe('release package policy', () => {
  it('keeps macOS and Windows artifacts unsigned', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as ReleaseBuildConfig

    expect(packageJson.build?.mac).toMatchObject({
      identity: null,
      notarize: false,
    })
    expect(packageJson.build?.win?.signExecutable).toBe(false)
  })
})
