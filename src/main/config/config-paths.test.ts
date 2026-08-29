import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { resolveConfigPaths } from './config-paths'

describe('resolveConfigPaths', () => {
  it('uses Electron userData for packaged builds', () => {
    const userDataPath = 'C:\\Users\\Test\\AppData\\Roaming\\Webku'
    const paths = resolveConfigPaths({
      isPackaged: true,
      userDataPath,
      devRoot: 'D:\\Code\\WebkuDownloader',
    })

    expect(paths).toEqual({
      configDir: join(userDataPath, 'config'),
      settingsPath: join(userDataPath, 'config', 'settings.toml'),
      secretsPath: join(userDataPath, 'config', 'secrets.enc'),
      legacyPath: join(userDataPath, 'config', 'secrets.toml'),
    })
  })

  it('isolates development data under the workspace', () => {
    const devRoot = 'D:\\Code\\WebkuDownloader'
    const paths = resolveConfigPaths({
      isPackaged: false,
      userDataPath: 'unused',
      devRoot,
    })

    expect(paths.configDir).toBe(join(devRoot, '.dev-user-data', 'config'))
    expect(paths.settingsPath).toBe(join(paths.configDir, 'settings.toml'))
    expect(paths.secretsPath).toBe(join(paths.configDir, 'secrets.enc'))
    expect(paths.legacyPath).toBe(join(paths.configDir, 'secrets.toml'))
  })

  it('does not fall back to the repository when userData is unavailable', () => {
    expect(() => resolveConfigPaths({
      isPackaged: true,
      userDataPath: '',
      devRoot: 'D:\\Code\\WebkuDownloader',
    })).toThrow('用户数据目录不可用')
  })
})
