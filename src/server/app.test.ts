import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Express } from 'express'

const ORIGIN = 'http://wenku8.test'
const ADMIN_PASSWORD = 'a-strong-admin-password'
const dataDir = mkdtempSync(join(tmpdir(), 'wenku8-web-test-'))
let app: Express

beforeAll(async () => {
  process.env.WEB_DATA_DIR = dataDir
  process.env.APP_SECRET = 'test-secret-that-is-at-least-32-characters-long'
  const { createWebApp } = await import('./app')
  app = createWebApp({
    adminPassword: ADMIN_PASSWORD,
    dataDir,
    publicOrigin: ORIGIN,
    staticDir: join(dataDir, 'missing-static'),
  })
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
  delete process.env.WEB_DATA_DIR
  delete process.env.APP_SECRET
})

afterEach(() => {
  vi.restoreAllMocks()
})

function login(agent: ReturnType<typeof request.agent>) {
  return agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-Wenku8-CSRF', '1')
    .send({ password: ADMIN_PASSWORD })
}

describe('web server', () => {
  it('exposes only the health endpoint without authentication', async () => {
    await request(app).get('/api/health').expect(200, { status: 'ok' })
    await request(app).get('/api/config').expect(401)
    await request(app).get('/api/tasks').expect(401)
    await request(app)
      .get('/api/images')
      .query({ url: 'https://img.wenku8.com/image/1.jpg' })
      .expect(401)
  })

  it('requires CSRF headers and creates a protected administrator session', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ password: ADMIN_PASSWORD })
      .expect(403)

    const agent = request.agent(app)
    const response = await login(agent).expect(200)
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Strict')
    await agent.get('/api/config').expect(200)
  })

  it('rejects an invalid administrator password', async () => {
    await request(app)
      .post('/api/auth/login')
      .set('Origin', ORIGIN)
      .set('X-Wenku8-CSRF', '1')
      .send({ password: 'incorrect-password' })
      .expect(401)
  })

  it('never returns source passwords or cookie values', async () => {
    const agent = request.agent(app)
    await login(agent).expect(200)
    const response = await agent.get('/api/config').expect(200)
    expect(response.body.login.password).toBe('')
    expect(response.body.cookie).toEqual({ authenticated: false })
    expect(JSON.stringify(response.body)).not.toContain('PHPSESSID')
  })

  it('encrypts persisted source credentials', async () => {
    const agent = request.agent(app)
    await login(agent).expect(200)
    const headers = { Origin: ORIGIN, 'X-Wenku8-CSRF': '1' }

    await agent
      .patch('/api/config')
      .set(headers)
      .send({ section: 'login', key: 'username', value: 'private-user' })
      .expect(200)
    await agent
      .patch('/api/config')
      .set(headers)
      .send({ section: 'login', key: 'password', value: 'private-source-password' })
      .expect(200)

    const encrypted = readFileSync(join(dataDir, 'config', 'secrets.enc'), 'utf-8')
    expect(encrypted).not.toContain('private-user')
    expect(encrypted).not.toContain('private-source-password')
    const response = await agent.get('/api/config').expect(200)
    expect(response.body.login).toMatchObject({
      username: 'private-user',
      password: '',
      has_password: true,
    })
  })

  it('supports redacted HTTP and SOCKS5 proxy settings', async () => {
    const agent = request.agent(app)
    await login(agent).expect(200)
    const headers = { Origin: ORIGIN, 'X-Wenku8-CSRF': '1' }

    const saved = await agent
      .patch('/api/config')
      .set(headers)
      .send({
        section: 'proxy',
        key: 'url',
        value: 'socks5://proxy-user:proxy-secret@127.0.0.1:1080',
      })
      .expect(200)
    expect(saved.body.proxy).toEqual({
      enabled: false,
      url: 'socks5://127.0.0.1:1080',
      has_credentials: true,
    })
    expect(JSON.stringify(saved.body)).not.toContain('proxy-secret')

    await agent
      .patch('/api/config')
      .set(headers)
      .send({ section: 'proxy', key: 'enabled', value: true })
      .expect(200)

    await agent
      .patch('/api/config')
      .set(headers)
      .send({ section: 'proxy', key: 'url', value: 'ftp://127.0.0.1:21' })
      .expect(400)

    await agent
      .patch('/api/config')
      .set(headers)
      .send({ section: 'proxy', key: 'url', value: '' })
      .expect(200)
  })

  it('proxies only allowed Wenku8 images for authenticated browsers', async () => {
    const agent = request.agent(app)
    await login(agent).expect(200)
    const { WebCrawler } = await import('../main/crawler')
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
    const fetchImage = vi.spyOn(WebCrawler.prototype, 'getImageResource').mockResolvedValue({
      content: image,
      contentType: 'image/jpeg',
    })

    const response = await agent
      .get('/api/images')
      .query({ url: 'https://img.wenku8.com/image/1.jpg' })
      .expect(200)
      .expect('Content-Type', 'image/jpeg')
      .expect('Cache-Control', 'private, max-age=86400')

    expect(Buffer.from(response.body)).toEqual(image)
    expect(fetchImage).toHaveBeenCalledWith('https://img.wenku8.com/image/1.jpg')
    await agent
      .get('/api/images')
      .query({ url: 'https://example.com/image.jpg' })
      .expect(400)
  })

  it('validates protected mutations and disables browser-selected paths', async () => {
    const agent = request.agent(app)
    await login(agent).expect(200)

    await agent
      .post('/api/tasks')
      .set('Origin', ORIGIN)
      .set('X-Wenku8-CSRF', '1')
      .send({ bookId: '../etc/passwd', type: 'epub_full' })
      .expect(400)
    await agent
      .post('/api/tasks')
      .set('Origin', ORIGIN)
      .set('X-Wenku8-CSRF', '1')
      .send({ bookId: '123', type: 'epub_full', volume: '第一卷' })
      .expect(400)
    await agent
      .post('/api/tasks')
      .set('Origin', ORIGIN)
      .set('X-Wenku8-CSRF', '1')
      .send({ bookId: '123', type: 'images', volume: 42 })
      .expect(400)

    await agent
      .patch('/api/config')
      .set('Origin', ORIGIN)
      .set('X-Wenku8-CSRF', '1')
      .send({ section: 'download', key: 'download_path', value: '/tmp/files' })
      .expect(400)
  })

  it('revokes the session on logout', async () => {
    const agent = request.agent(app)
    await login(agent).expect(200)
    await agent
      .post('/api/auth/logout')
      .set('Origin', ORIGIN)
      .set('X-Wenku8-CSRF', '1')
      .expect(200)
    await agent.get('/api/config').expect(401)
  })
})
