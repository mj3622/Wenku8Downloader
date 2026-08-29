import { join } from 'path'

export interface CacheEnvironment {
  isPackaged: boolean
  userDataPath: string
  devRoot: string
}

export function resolveCacheRoot(environment: CacheEnvironment): string {
  return environment.isPackaged
    ? join(environment.userDataPath, 'cache-v1')
    : join(environment.devRoot, '.dev-user-data', 'cache-v1')
}
