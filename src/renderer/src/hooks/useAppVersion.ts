import { useEffect, useState } from 'react'
import { api } from '../api/client'

let cachedVersion: string | null = null
let versionRequest: Promise<string> | null = null

function loadVersion(): Promise<string> {
  if (cachedVersion) return Promise.resolve(cachedVersion)
  versionRequest ??= api.getAppInfo().then((info) => {
    cachedVersion = info.version
    return info.version
  }).finally(() => {
    versionRequest = null
  })
  return versionRequest
}

export function useAppVersion(): string | null {
  const [version, setVersion] = useState(cachedVersion)
  useEffect(() => {
    let active = true
    void loadVersion().then((value) => {
      if (active) setVersion(value)
    }).catch(() => {
      // Version display is non-critical and must not interfere with navigation.
    })
    return () => {
      active = false
    }
  }, [])
  return version
}
