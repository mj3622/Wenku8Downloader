export function detectPlatform(navigatorLike) {
  const platform = String(navigatorLike?.userAgentData?.platform ?? navigatorLike?.platform ?? '')
    .toLowerCase()
  const userAgent = String(navigatorLike?.userAgent ?? '').toLowerCase()
  if (platform.includes('mac') || userAgent.includes('mac os')) return 'mac'
  if (platform.includes('win') || userAgent.includes('windows')) return 'windows'
  return 'other'
}

export function selectPrimaryDownload(navigatorLike) {
  const platform = detectPlatform(navigatorLike)
  if (platform === 'mac') {
    return { platform, label: '选择 macOS 版本', assetKey: null }
  }
  if (platform === 'windows') {
    return { platform, label: '下载 Windows 版', assetKey: 'windowsX64' }
  }
  return { platform, label: '查看全部版本', assetKey: 'releases' }
}
