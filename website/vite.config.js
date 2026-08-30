import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { URL } from 'node:url'
import { parseRootPackageVersion } from './build-version.js'
import { createDownloadLinks } from './download-links.js'

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = parseRootPackageVersion(rootPackage)
const downloadLinks = createDownloadLinks(version)

export default defineConfig({
  base: '/',
  plugins: [{
    name: 'root-package-version',
    transformIndexHtml(html) {
      return html
        .replaceAll('__APP_VERSION__', version)
        .replaceAll('__MAC_ARM64_URL__', downloadLinks.macArm64)
        .replaceAll('__MAC_X64_URL__', downloadLinks.macX64)
        .replaceAll('__WINDOWS_X64_URL__', downloadLinks.windowsX64)
    },
  }],
})
