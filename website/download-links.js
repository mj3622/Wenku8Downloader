import { parseRootPackageVersion } from './build-version.js'

export const RELEASES_URL = 'https://github.com/mj3622/Wenku8Downloader/releases'

export function createDownloadLinks(version) {
  parseRootPackageVersion({ version })
  const base = `https://github.com/mj3622/Wenku8Downloader/releases/download/v${version}`
  return {
    macArm64: `${base}/Wenku8Downloader-${version}-macOS-arm64.dmg`,
    macX64: `${base}/Wenku8Downloader-${version}-macOS-x64.dmg`,
    windowsX64: `${base}/Wenku8Downloader-${version}-Windows-x64.exe`,
    releases: RELEASES_URL,
  }
}
