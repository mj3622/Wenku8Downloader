import { createServer, type Server } from 'http'
import { afterEach, describe, expect, it } from 'vitest'
import { FlareSolverrClient, toFlareSolverrProxy } from './flaresolverr-client'

const servers: Server[] = []

async function listen(server: Server): Promise<number> {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务启动失败')
  return address.port
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    ),
  ))
})

describe('FlareSolverrClient', () => {
  it('passes separated proxy credentials and returns Wenku8 cookies', async () => {
    const requestBodies: Record<string, unknown>[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const requestBody = JSON.parse(body) as Record<string, unknown>
        requestBodies.push(requestBody)
        response.setHeader('Content-Type', 'application/json')
        if (requestBody.cmd === 'sessions.create' || requestBody.cmd === 'sessions.destroy') {
          response.end(JSON.stringify({ status: 'ok', session: requestBody.session }))
        } else {
          response.end(JSON.stringify({
            status: 'ok',
            solution: {
              cookies: requestBody.cmd === 'request.post' ? [
                { name: 'cf_clearance', value: 'clearance', domain: '.wenku8.net' },
                { name: 'jieqiUserInfo', value: 'user-cookie', domain: 'www.wenku8.net' },
                { name: 'unrelated', value: 'ignored', domain: 'example.com' },
              ] : [],
              userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
            },
          }))
        }
      })
    })
    const port = await listen(server)
    const client = new FlareSolverrClient(`http://127.0.0.1:${port}/v1`)

    const result = await client.solveLogin(
      'https://www.wenku8.net/login.php',
      'username=test&password=secret',
      {
        enabled: true,
        url: 'socks5://proxy-user:proxy-password@127.0.0.1:1080',
      },
    )
    await client.dispose()

    expect(requestBodies[0]).toMatchObject({
      cmd: 'sessions.create',
      proxy: {
        url: 'socks5://127.0.0.1:1080',
        username: 'proxy-user',
        password: 'proxy-password',
      },
    })
    expect(requestBodies[1]).toMatchObject({
      cmd: 'request.get',
      url: 'https://www.wenku8.net/login.php',
      returnOnlyCookies: true,
    })
    expect(requestBodies[2]).toMatchObject({
      cmd: 'request.post',
      url: 'https://www.wenku8.net/login.php',
      postData: 'username=test&password=secret',
      returnOnlyCookies: true,
    })
    expect(requestBodies[3]).toMatchObject({ cmd: 'sessions.destroy' })
    expect(requestBodies.map((body) => body.session).every((session) =>
      session === requestBodies[0].session,
    )).toBe(true)
    expect(result).toEqual({
      cookies: {
        cf_clearance: 'clearance',
        jieqiUserInfo: 'user-cookie',
      },
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
    })
  })

  it('converts remote-DNS SOCKS proxies for Chromium', () => {
    expect(toFlareSolverrProxy({
      enabled: true,
      url: 'socks5h://proxy.example:1080',
    })).toEqual({ url: 'socks5://proxy.example:1080' })
  })

  it('retrieves a protected page through the shared proxy bridge', async () => {
    const requestBodies: Record<string, unknown>[] = []
    const server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk
      })
      request.on('end', () => {
        const requestBody = JSON.parse(body) as Record<string, unknown>
        requestBodies.push(requestBody)
        response.setHeader('Content-Type', 'application/json')
        if (requestBody.cmd === 'sessions.create' || requestBody.cmd === 'sessions.destroy') {
          response.end(JSON.stringify({ status: 'ok', session: requestBody.session }))
        } else {
          response.end(JSON.stringify({
            status: 'ok',
            solution: {
              cookies: [{ name: 'cf_clearance', value: 'new-clearance', domain: '.wenku8.net' }],
              userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
              response: '<html><title>文库页面</title></html>',
              url: requestBody.url,
            },
          }))
        }
      })
    })
    const port = await listen(server)
    const client = new FlareSolverrClient(`http://127.0.0.1:${port}/v1`)

    const results = await Promise.all(Array.from({ length: 9 }, (_, index) =>
      client.getPage(
        `https://www.wenku8.net/book/${index + 1}.htm`,
        { cf_clearance: 'old-clearance' },
        { enabled: true, url: 'socks5://user:password@proxy.example:1080' },
        'http://wenku8-web:34567',
      ),
    ))
    await client.dispose()

    expect(requestBodies[0]).toMatchObject({
      cmd: 'sessions.create',
      proxy: { url: 'http://wenku8-web:34567' },
    })
    expect(requestBodies[1]).toMatchObject({
      cmd: 'request.get',
      url: 'https://www.wenku8.net/book/1.htm',
      cookies: [{
        name: 'cf_clearance',
        value: 'old-clearance',
        domain: '.wenku8.net',
        path: '/',
      }],
    })
    const creates = requestBodies.filter((body) => body.cmd === 'sessions.create')
    const gets = requestBodies.filter((body) => body.cmd === 'request.get')
    const destroys = requestBodies.filter((body) => body.cmd === 'sessions.destroy')
    expect(creates).toHaveLength(2)
    expect(gets).toHaveLength(9)
    expect(destroys).toHaveLength(2)
    expect(gets.slice(0, 8).every((body) => body.session === creates[0].session)).toBe(true)
    expect(gets[8].session).toBe(creates[1].session)
    expect(gets[0]).toMatchObject({ disableMedia: true })
    expect(results[0].html).toContain('文库页面')
    expect(results[0].cookies.cf_clearance).toBe('new-clearance')
  })

  it('fails closed on invalid solver responses and target URLs', async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 500
      response.end('solver failure')
    })
    const port = await listen(server)
    const client = new FlareSolverrClient(`http://127.0.0.1:${port}/v1`)

    await expect(client.solveLogin(
      'https://www.wenku8.net/login.php',
      'username=test',
      { enabled: false, url: '' },
    )).rejects.toThrow('FlareSolverr 未能通过 Cloudflare 验证')

    await expect(client.solveLogin(
      'https://example.com/login.php',
      'username=test',
      { enabled: false, url: '' },
    )).rejects.toThrow('FlareSolverr 仅允许访问轻小说文库')
  })
})
