import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_CONTEXT = 'com.wenku8.downloader/local-secrets/v1'
const AUTH_CONTEXT = Buffer.from('wenku8-downloader:secrets:v1', 'utf-8')
const LOCAL_KEY = createHash('sha256').update(KEY_CONTEXT, 'utf-8').digest()

export interface SecretCodec {
  readonly cipher: string
  isAvailable(): boolean
  encrypt(plainText: string): Buffer
  decrypt(encrypted: Buffer): string
}

/**
 * 本地固定算法只用于避免凭据以明文出现，不构成本机攻击者的安全边界。
 * 解密材料随程序分发，从而避免依赖系统钥匙串或要求用户额外授权。
 */
export class LocalSecretCodec implements SecretCodec {
  readonly cipher = 'local-aes-256-gcm-v1'

  isAvailable(): boolean {
    return true
  }

  encrypt(plainText: string): Buffer {
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv(ALGORITHM, LOCAL_KEY, iv)
    cipher.setAAD(AUTH_CONTEXT)
    const content = Buffer.concat([
      cipher.update(plainText, 'utf-8'),
      cipher.final(),
    ])
    return Buffer.concat([iv, cipher.getAuthTag(), content])
  }

  decrypt(encrypted: Buffer): string {
    if (encrypted.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('本地敏感配置密文格式无效')
    }
    const iv = encrypted.subarray(0, IV_LENGTH)
    const authTag = encrypted.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const content = encrypted.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = createDecipheriv(ALGORITHM, LOCAL_KEY, iv)
    decipher.setAAD(AUTH_CONTEXT)
    decipher.setAuthTag(authTag)
    return Buffer.concat([
      decipher.update(content),
      decipher.final(),
    ]).toString('utf-8')
  }
}
