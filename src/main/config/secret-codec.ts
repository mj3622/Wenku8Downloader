import type { SafeStorage } from 'electron'

export interface SecretCodec {
  isAvailable(): boolean
  encrypt(plainText: string): Buffer
  decrypt(encrypted: Buffer): string
}

export class ElectronSafeStorageCodec implements SecretCodec {
  constructor(
    private readonly storage: Pick<
      SafeStorage,
      'isEncryptionAvailable' | 'encryptString' | 'decryptString'
    >,
  ) {}

  isAvailable(): boolean {
    return this.storage.isEncryptionAvailable()
  }

  encrypt(plainText: string): Buffer {
    return this.storage.encryptString(plainText)
  }

  decrypt(encrypted: Buffer): string {
    return this.storage.decryptString(encrypted)
  }
}
