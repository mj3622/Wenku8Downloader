import { readFileSync } from 'fs'
import { resolve } from 'path'

function readSecret(valueName: string, fileName: string): string {
  const filePath = process.env[fileName]
  if (filePath) return readFileSync(filePath, 'utf-8').trim()
  return process.env[valueName]?.trim() ?? ''
}

async function main(): Promise<void> {
  const dataDir = resolve(process.env.WEB_DATA_DIR || '.web-data')
  process.env.WEB_DATA_DIR = dataDir
  process.env.APP_SECRET = readSecret('APP_SECRET', 'APP_SECRET_FILE')

  const adminPassword = readSecret('ADMIN_PASSWORD', 'ADMIN_PASSWORD_FILE')
  if (!adminPassword) throw new Error('必须设置 ADMIN_PASSWORD 或 ADMIN_PASSWORD_FILE')
  if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32) {
    throw new Error('必须设置至少 32 个字符的 APP_SECRET 或 APP_SECRET_FILE')
  }

  const [{ createWebApp }, { proxyRuntime }, { flareSolverrClient }] = await Promise.all([
    import('./app'),
    import('../main/proxy-runtime'),
    import('../main/flaresolverr-client'),
  ])
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 3000)
  const publicOrigin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`
  const app = createWebApp({
    adminPassword,
    dataDir,
    publicOrigin,
    staticDir: process.env.WEB_STATIC_DIR,
    trustProxy: process.env.TRUST_PROXY,
  })

  const server = app.listen(port, host, () => {
    console.log(`Wenku8 Web 正在监听 ${host}:${port}`)
  })
  const shutdown = () => {
    server.close(() => {
      void Promise.all([
        proxyRuntime.dispose(),
        flareSolverrClient.dispose(),
      ]).finally(() => process.exit(0))
    })
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
