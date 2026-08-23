import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { SecretStore, type SecretPayloadV1 } from './secret-store'
import type { SecretCodec } from './secret-codec'

const availableCodec: SecretCodec = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`cipher:${Buffer.from(plain).toString('base64')}`),
  decrypt: (encrypted) => Buffer.from(
    encrypted.toString().slice('cipher:'.length),
    'base64',
  ).toString('utf-8'),
}

const unavailableCodec: SecretCodec = {
  isAvailable: () => false,
  encrypt: () => { throw new Error('should not encrypt') },
  decrypt: () => { throw new Error('should not decrypt') },
}

const payload: SecretPayloadV1 = {
  login: {
    username: 'test-user',
    password: 'plain-password-sentinel',
  },
  cookies: {
    PHPSESSID: 'plain-cookie-sentinel',
    jieqiUserInfo: 'user-info',
    jieqiVisitInfo: 'visit-info',
    cf_clearance: 'clearance',
  },
}

let root: string
let secretsPath: string

describe('SecretStore', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'wenku8-secrets-'))
    secretsPath = join(root, 'secrets.enc')
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('returns an empty payload for a missing file', () => {
    const result = new SecretStore(secretsPath, availableCodec).load()

    expect(result.state).toBe('missing')
    expect(result.value).toEqual({
      login: { username: '', password: '' },
      cookies: {
        PHPSESSID: '',
        jieqiUserInfo: '',
        jieqiVisitInfo: '',
        cf_clearance: '',
      },
    })
  })

  it('round-trips encrypted secrets without plaintext on disk', async () => {
    const store = new SecretStore(secretsPath, availableCodec)

    expect(store.save(payload)).toEqual(payload)

    const stored = await readFile(secretsPath, 'utf-8')
    expect(stored).not.toContain('plain-password-sentinel')
    expect(stored).not.toContain('plain-cookie-sentinel')
    expect(store.load()).toEqual({ state: 'ok', value: payload })
  })

  it('keeps unsupported newer envelopes read-only', async () => {
    const raw = JSON.stringify({
      version: 99,
      cipher: 'electron-safe-storage',
      data: 'future-data',
    })
    await writeFile(secretsPath, raw, 'utf-8')

    const result = new SecretStore(secretsPath, availableCodec).load()

    expect(result.state).toBe('read-only-newer-version')
    await expect(readFile(secretsPath, 'utf-8')).resolves.toBe(raw)
  })

  it('preserves an envelope that cannot be decrypted', async () => {
    const raw = JSON.stringify({
      version: 1,
      cipher: 'electron-safe-storage',
      data: Buffer.from('not-a-valid-cipher').toString('base64'),
    })
    await writeFile(secretsPath, raw, 'utf-8')

    const result = new SecretStore(secretsPath, availableCodec).load()

    expect(result.state).toBe('recovery-required')
    await expect(readFile(secretsPath, 'utf-8')).resolves.toBe(raw)
  })

  it('does not create plaintext fallback storage when encryption is unavailable', async () => {
    const store = new SecretStore(secretsPath, unavailableCodec)

    expect(() => store.save(payload)).toThrow('系统安全存储不可用')
    await expect(stat(secretsPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
