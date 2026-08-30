import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseRootPackageVersion } from './build-version.js'

describe('website build version', () => {
  it('accepts the stable root package version', () => {
    assert.equal(parseRootPackageVersion({ version: '2.1.0' }), '2.1.0')
  })

  it('fails the build input for invalid version data', () => {
    for (const rootPackage of [
      {},
      { version: 'v2.1.0' },
      { version: '2.1' },
      { version: '2.1.0-beta.1' },
      { version: '02.1.0' },
    ]) {
      assert.throws(() => parseRootPackageVersion(rootPackage), /valid stable semver/)
    }
  })
})
