import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import cookieParser from 'cookie-parser'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { config, redactProxyUrl } from '../main/config-manager'
import { normalizeWenku8ImageUrl, WebCrawler } from '../main/crawler'
import { CookieService, type CookieProgress } from '../main/cookie-service'
import { Book } from '../main/book'
import { DownloadTaskManager, type WebDownloadTask } from './task-manager'

const SESSION_COOKIE = 'wenku8_admin_session'
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

type WebAppOptions = {
  adminPassword: string
  dataDir: string
  publicOrigin: string
  staticDir?: string
  trustProxy?: string
}

type Session = {
  expiresAt: number
}

type EventClient = {
  response: Response
  sessionKey: string
}

function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function readString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value
}

function publicImageUrl(value: string | null | undefined): string {
  return value ? `/api/images?url=${encodeURIComponent(value)}` : ''
}

function publicTask(task: WebDownloadTask): WebDownloadTask {
  return {
    ...task,
    cover: task.cover ? publicImageUrl(task.cover) : undefined,
  }
}

function publicConfig(): Record<string, unknown> {
  const current = config.getAll()
  const publicProxy = redactProxyUrl(current.proxy?.url ?? '')
  return {
    login: {
      username: current.login?.username ?? '',
      password: '',
      has_password: Boolean(current.login?.password),
    },
    cookie: {
      authenticated: Boolean(current.cookie?.PHPSESSID || current.cookie?.jieqiUserInfo),
    },
    download: {
      full_title: current.download?.full_title ?? 'FULL',
      default_cover_index: current.download?.default_cover_index ?? 0,
      download_path: '',
    },
    proxy: {
      enabled: current.proxy?.enabled ?? false,
      url: publicProxy.url,
      has_credentials: publicProxy.hasCredentials,
    },
  }
}

export function createWebApp(options: WebAppOptions): express.Express {
  if (options.adminPassword.length < 12) {
    throw new Error('ADMIN_PASSWORD 至少需要 12 个字符')
  }

  const app = express()
  if (options.trustProxy) app.set('trust proxy', options.trustProxy)
  const sessions = new Map<string, Session>()
  const loginAttempts = new Map<string, number[]>()
  const eventClients = new Set<EventClient>()
  const crawler = new WebCrawler()
  const passwordSalt = randomBytes(16)
  const passwordVerifier = scryptSync(options.adminPassword, passwordSalt, 32)
  const secureCookies = new URL(options.publicOrigin).protocol === 'https:'

  const broadcast = (type: string, data: unknown): void => {
    const payload = `data: ${JSON.stringify({ type, data })}\n\n`
    for (const client of eventClients) client.response.write(payload)
  }

  const taskManager = new DownloadTaskManager(options.dataDir, crawler, (tasks) => {
    broadcast('tasks', tasks.map(publicTask))
  })

  app.disable('x-powered-by')
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: [
            "'self'",
            'data:',
            'https://wenku8.net',
            'https://*.wenku8.net',
            'https://img.wenku8.com',
          ],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
        },
      },
    }),
  )
  app.use(express.json({ limit: '32kb' }))
  app.use(cookieParser())

  app.use('/api', (request, response, next) => {
    if (request.method === 'GET' || request.method === 'HEAD') return next()
    if (request.get('origin') !== options.publicOrigin) {
      response.status(403).json({ error: '请求来源无效' })
      return
    }
    if (request.get('x-wenku8-csrf') !== '1') {
      response.status(403).json({ error: '缺少请求校验信息' })
      return
    }
    next()
  })

  const requireAuth = (request: Request, response: Response, next: NextFunction): void => {
    const token = request.cookies[SESSION_COOKIE] as string | undefined
    const key = token ? sessionHash(token) : ''
    const session = key ? sessions.get(key) : undefined
    if (!session || session.expiresAt <= Date.now()) {
      if (key) sessions.delete(key)
      response.status(401).json({ error: '请先登录' })
      return
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS
    next()
  }

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' })
  })

  app.get('/api/auth/session', (request, response) => {
    const token = request.cookies[SESSION_COOKIE] as string | undefined
    const session = token ? sessions.get(sessionHash(token)) : undefined
    response.json({ authenticated: Boolean(session && session.expiresAt > Date.now()) })
  })

  app.post('/api/auth/login', (request, response) => {
    const now = Date.now()
    const ip = request.ip || request.socket.remoteAddress || 'unknown'
    const recent = (loginAttempts.get(ip) ?? []).filter((time) => now - time < 15 * 60 * 1000)
    if (recent.length >= 5) {
      response.status(429).json({ error: '登录尝试过多，请稍后重试' })
      return
    }

    const password = readString(request.body?.password, 512)
    const candidate = scryptSync(password ?? '', passwordSalt, 32)
    if (!password || !timingSafeEqual(candidate, passwordVerifier)) {
      recent.push(now)
      loginAttempts.set(ip, recent)
      response.status(401).json({ error: '管理员密码错误' })
      return
    }

    loginAttempts.delete(ip)
    const token = randomBytes(32).toString('base64url')
    sessions.set(sessionHash(token), { expiresAt: now + SESSION_TTL_MS })
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_MS,
    })
    response.json({ authenticated: true })
  })

  app.post('/api/auth/logout', requireAuth, (request, response) => {
    const token = request.cookies[SESSION_COOKIE] as string | undefined
    if (token) {
      const key = sessionHash(token)
      sessions.delete(key)
      for (const client of eventClients) {
        if (client.sessionKey === key) {
          client.response.end()
          eventClients.delete(client)
        }
      }
    }
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: 'strict',
      path: '/',
    })
    response.json({ authenticated: false })
  })

  app.get('/api/runtime', requireAuth, (_request, response) => {
    response.json({
      target: 'web',
      canChooseOutputDirectory: false,
      canOpenFolder: false,
      canDownloadArtifact: true,
    })
  })

  app.get('/api/config', requireAuth, (_request, response) => {
    response.json(publicConfig())
  })

  app.patch('/api/config', requireAuth, (request, response) => {
    const section = readString(request.body?.section, 32)
    const key = readString(request.body?.key, 64)
    const value = request.body?.value

    if (section === 'login' && key === 'username') {
      const username = readString(value, 128)
      if (username === null) return void response.status(400).json({ error: '用户名无效' })
      config.set(section, key, username)
    } else if (section === 'login' && key === 'password') {
      const password = readString(value, 256)
      if (password === null) return void response.status(400).json({ error: '密码无效' })
      if (password) config.set(section, key, password)
    } else if (section === 'download' && key === 'full_title') {
      if (!['FULL', 'IN', 'OUT'].includes(value)) {
        return void response.status(400).json({ error: '书名格式无效' })
      }
      config.set(section, key, value)
    } else if (section === 'download' && key === 'default_cover_index') {
      const index = typeof value === 'number' ? value : Number(value)
      if (!Number.isInteger(index) || index < 0 || index > 1000) {
        return void response.status(400).json({ error: '封面索引无效' })
      }
      config.set(section, key, index)
    } else if (section === 'download' && key === 'download_path') {
      return void response.status(400).json({ error: '网页端存储路径由服务器管理' })
    } else if (section === 'proxy' && key === 'url') {
      const proxyUrl = readString(value, 2048)
      if (proxyUrl === null) return void response.status(400).json({ error: '代理地址无效' })
      try {
        config.set(section, key, proxyUrl)
      } catch {
        return void response.status(400).json({ error: '代理地址无效' })
      }
    } else if (section === 'proxy' && key === 'enabled') {
      if (typeof value !== 'boolean') {
        return void response.status(400).json({ error: '代理开关无效' })
      }
      try {
        config.set(section, key, value)
      } catch {
        return void response.status(400).json({ error: '请先填写代理地址' })
      }
    } else {
      return void response.status(400).json({ error: '配置项无效' })
    }

    crawler.syncCookies()
    response.json(publicConfig())
  })

  app.post('/api/cookie/auto', requireAuth, async (_request, response, next) => {
    try {
      const service = new CookieService(crawler)
      await service.acquire((progress: CookieProgress) => {
        broadcast('cookie-progress', progress)
      })
      response.json({ status: 'ok', message: '登录成功，已获取 Cookie' })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/search', requireAuth, async (request, response, next) => {
    try {
      const field = request.query.field
      const query = readString(request.query.q, 100)?.trim()
      if ((field !== 'author' && field !== 'title') || !query) {
        return void response.status(400).json({ error: '搜索参数无效' })
      }
      const results = await crawler.search(query, field)
      response.json({
        results: results.map((result) => ({
          ...result,
          cover: publicImageUrl(result.cover),
        })),
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/images', requireAuth, async (request, response, next) => {
    const imageUrl = readString(request.query.url, 2048)
    if (!imageUrl) return void response.status(400).json({ error: '图片地址无效' })
    try {
      normalizeWenku8ImageUrl(imageUrl)
    } catch {
      return void response.status(400).json({ error: '图片地址无效' })
    }
    try {
      const image = await crawler.getImageResource(imageUrl)
      if (!image) return void response.status(404).json({ error: '图片不存在' })
      response.setHeader('Content-Type', image.contentType)
      response.setHeader('Content-Length', image.content.length)
      response.setHeader('Cache-Control', 'private, max-age=86400')
      response.send(image.content)
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/books/:bookId', requireAuth, async (request, response, next) => {
    try {
      const bookId = routeParam(request.params.bookId)
      if (!/^\d{1,10}$/.test(bookId)) {
        return void response.status(400).json({ error: '作品编号无效' })
      }
      const book = await Book.create(bookId, crawler)
      response.json({
        book_id: book.bookId,
        basic_info: {
          ...book.basicInfo,
          cover: publicImageUrl(book.basicInfo.cover),
        },
        volumes: book.volumes,
      })
    } catch (error) {
      next(error)
    }
  })

  app.get('/api/tasks', requireAuth, (_request, response) => {
    response.json({ tasks: taskManager.list().map(publicTask) })
  })

  app.post('/api/tasks', requireAuth, (request, response) => {
    const bookId = readString(request.body?.bookId, 10)
    const type = request.body?.type as WebDownloadTask['type']
    const hasVolume = Object.prototype.hasOwnProperty.call(request.body ?? {}, 'volume')
    const volume = hasVolume ? readString(request.body.volume, 200)?.trim() : undefined
    if (!bookId || !/^\d{1,10}$/.test(bookId)) {
      return void response.status(400).json({ error: '作品编号无效' })
    }
    if (!['epub_full', 'epub_volume', 'images'].includes(type)) {
      return void response.status(400).json({ error: '下载类型无效' })
    }
    if (hasVolume && !volume) {
      return void response.status(400).json({ error: '卷名无效' })
    }
    if (type === 'epub_volume' && !volume) {
      return void response.status(400).json({ error: '分卷下载必须指定卷名' })
    }
    if (type === 'epub_full' && volume) {
      return void response.status(400).json({ error: '整本下载不能指定卷名' })
    }
    const task = taskManager.enqueue({
      bookId,
      title: readString(request.body?.title, 200) ?? undefined,
      type,
      volume: volume ?? undefined,
    })
    response.status(201).json({ task: publicTask(task) })
  })

  app.post('/api/tasks/:id/retry', requireAuth, (request, response) => {
    const task = taskManager.retry(routeParam(request.params.id))
    if (!task) return void response.status(409).json({ error: '任务无法重试' })
    response.json({ task: publicTask(task) })
  })

  app.delete('/api/tasks/:id', requireAuth, (request, response) => {
    if (!taskManager.remove(routeParam(request.params.id))) {
      return void response.status(409).json({ error: '任务无法删除' })
    }
    response.status(204).end()
  })

  app.delete('/api/tasks', requireAuth, (_request, response) => {
    taskManager.clearHistory()
    response.status(204).end()
  })

  app.get('/api/tasks/:id/artifact', requireAuth, (request, response) => {
    const artifact = taskManager.getArtifact(routeParam(request.params.id))
    if (!artifact) return void response.status(404).json({ error: '下载文件不存在' })
    response.download(artifact.path, artifact.name)
  })

  app.get('/api/events', requireAuth, (_request, response) => {
    response.setHeader('Content-Type', 'text/event-stream')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Connection', 'keep-alive')
    response.setHeader('X-Accel-Buffering', 'no')
    response.flushHeaders()
    const token = _request.cookies[SESSION_COOKIE] as string
    const client = { response, sessionKey: sessionHash(token) }
    eventClients.add(client)
    response.write(`data: ${JSON.stringify({ type: 'tasks', data: taskManager.list() })}\n\n`)
    response.on('close', () => eventClients.delete(client))
  })

  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const client of eventClients) {
      const session = sessions.get(client.sessionKey)
      if (!session || session.expiresAt <= now) {
        sessions.delete(client.sessionKey)
        client.response.end()
        eventClients.delete(client)
      } else {
        client.response.write(': heartbeat\n\n')
      }
    }
  }, 15_000)
  heartbeat.unref()

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: '接口不存在' })
  })

  const staticDir = options.staticDir ?? join(process.cwd(), 'dist', 'web')
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, {
      index: false,
      setHeaders: (response, filePath) => {
        if (filePath.endsWith('index.html')) response.setHeader('Cache-Control', 'no-cache')
      },
    }))
    app.use((request, response, next) => {
      if (!['GET', 'HEAD'].includes(request.method) || !request.accepts('html')) return next()
      response.sendFile(join(staticDir, 'index.html'))
    })
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : '服务器内部错误'
    response.status(500).json({ error: message })
  })

  return app
}
