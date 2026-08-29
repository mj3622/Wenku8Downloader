import { join } from 'path'

export interface ConfigPaths {
  configDir: string
  settingsPath: string
  secretsPath: string
  legacyPath: string
}

export function resolveConfigPaths(input: {
  isPackaged: boolean
  userDataPath: string
  devRoot: string
}): ConfigPaths {
  if (input.isPackaged && !input.userDataPath.trim()) {
    throw new Error('用户数据目录不可用')
  }
  if (!input.isPackaged && !input.devRoot.trim()) {
    throw new Error('开发数据目录不可用')
  }

  const configDir = input.isPackaged
    ? join(input.userDataPath, 'config')
    : join(input.devRoot, '.dev-user-data', 'config')

  return {
    configDir,
    settingsPath: join(configDir, 'settings.toml'),
    secretsPath: join(configDir, 'secrets.enc'),
    legacyPath: join(configDir, 'secrets.toml'),
  }
}
