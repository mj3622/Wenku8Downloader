import { describe, expect, it } from 'vitest'
import { LocalSecretCodec } from './secret-codec'

describe('LocalSecretCodec', () => {
  it('round-trips local secrets without storing plaintext', () => {
    const codec = new LocalSecretCodec()
    const plainText = 'local-secret-sentinel'

    const first = codec.encrypt(plainText)
    const second = codec.encrypt(plainText)

    expect(first.toString()).not.toContain(plainText)
    expect(second.equals(first)).toBe(false)
    expect(new LocalSecretCodec().decrypt(first)).toBe(plainText)
    expect(new LocalSecretCodec().decrypt(second)).toBe(plainText)
  })

  it('rejects modified ciphertext', () => {
    const codec = new LocalSecretCodec()
    const encrypted = codec.encrypt('local-secret-sentinel')
    encrypted[encrypted.length - 1] ^= 1

    expect(() => codec.decrypt(encrypted)).toThrow()
  })
})
