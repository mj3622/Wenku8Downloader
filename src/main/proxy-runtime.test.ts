import { createServer, type Server } from 'http'
import { createServer as createNetServer, connect, type Server as NetServer } from 'net'
import { Server as ProxyChainServer } from 'proxy-chain'
import { afterEach, describe, expect, it } from 'vitest'
import { ProxyRuntime } from './proxy-runtime'

const disposables: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(disposables.splice(0).map((dispose) => dispose()))
})

async function listen(server: Server | NetServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器启动失败')
  disposables.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return address.port
}

function createSocks5Server(username: string, password: string): NetServer {
  return createNetServer((client) => {
    let stage: 'greeting' | 'auth' | 'request' | 'connected' = 'greeting'
    let buffer = Buffer.alloc(0)

    const processBuffer = () => {
      if (stage === 'greeting') {
        if (buffer.length < 2) return
        const length = 2 + buffer[1]
        if (buffer.length < length) return
        buffer = buffer.subarray(length)
        client.write(Buffer.from([0x05, 0x02]))
        stage = 'auth'
      }

      if (stage === 'auth') {
        if (buffer.length < 2) return
        const usernameLength = buffer[1]
        if (buffer.length < 3 + usernameLength) return
        const passwordLength = buffer[2 + usernameLength]
        const length = 3 + usernameLength + passwordLength
        if (buffer.length < length) return
        const receivedUsername = buffer.subarray(2, 2 + usernameLength).toString()
        const receivedPassword = buffer.subarray(3 + usernameLength, length).toString()
        buffer = buffer.subarray(length)
        if (receivedUsername !== username || receivedPassword !== password) {
          client.end(Buffer.from([0x01, 0x01]))
          return
        }
        client.write(Buffer.from([0x01, 0x00]))
        stage = 'request'
      }

      if (stage === 'request') {
        if (buffer.length < 7) return
        const addressType = buffer[3]
        let host = ''
        let offset = 4
        if (addressType === 0x01) {
          if (buffer.length < 10) return
          host = Array.from(buffer.subarray(offset, offset + 4)).join('.')
          offset += 4
        } else if (addressType === 0x03) {
          const hostnameLength = buffer[offset]
          if (buffer.length < 7 + hostnameLength) return
          host = buffer.subarray(offset + 1, offset + 1 + hostnameLength).toString()
          offset += 1 + hostnameLength
        } else {
          client.end()
          return
        }
        const port = buffer.readUInt16BE(offset)
        buffer = buffer.subarray(offset + 2)
        stage = 'connected'

        const upstream = connect(port, host, () => {
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
          if (buffer.length) upstream.write(buffer)
          client.pipe(upstream)
          upstream.pipe(client)
        })
        upstream.on('error', () => {
          client.end(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        })
      }
    }

    client.on('data', (chunk) => {
      if (stage === 'connected') return
      buffer = Buffer.concat([buffer, chunk])
      processBuffer()
    })
  })
}

describe('ProxyRuntime', () => {
  it('routes Node requests through an HTTP upstream proxy', async () => {
    const target = createServer((_request, response) => {
      response.end('proxied-response')
    })
    const targetPort = await listen(target)

    const upstream = new ProxyChainServer({ host: '127.0.0.1', port: 0, verbose: false })
    await upstream.listen()
    disposables.push(() => upstream.close(true))

    const runtime = new ProxyRuntime(() => ({
      enabled: true,
      url: `http://127.0.0.1:${upstream.port}`,
    }))
    disposables.push(() => runtime.dispose())

    const response = await runtime.fetch(`http://127.0.0.1:${targetPort}/`, {
      method: 'GET',
    })
    expect(await response.text()).toBe('proxied-response')
    expect(upstream.stats.httpRequestCount + upstream.stats.connectRequestCount).toBeGreaterThan(0)
  })

  it('routes Node requests through an authenticated SOCKS5 proxy', async () => {
    const target = createServer((_request, response) => {
      response.end('socks-response')
    })
    const targetPort = await listen(target)
    const socks = createSocks5Server('proxy-user', 'proxy-password')
    const socksPort = await listen(socks)

    const runtime = new ProxyRuntime(() => ({
      enabled: true,
      url: `socks5://proxy-user:proxy-password@127.0.0.1:${socksPort}`,
    }))
    disposables.push(() => runtime.dispose())

    const response = await runtime.fetch(`http://127.0.0.1:${targetPort}/`, {
      method: 'GET',
    })
    expect(await response.text()).toBe('socks-response')
  })

  it('fails closed when a SOCKS5 proxy is unavailable', async () => {
    let directHits = 0
    const target = createServer((_request, response) => {
      directHits++
      response.end('direct-response')
    })
    const targetPort = await listen(target)

    const runtime = new ProxyRuntime(() => ({
      enabled: true,
      url: 'socks5://127.0.0.1:1',
    }))
    disposables.push(() => runtime.dispose())

    await expect(
      runtime.fetch(`http://127.0.0.1:${targetPort}/`, { method: 'GET' }),
    ).rejects.toThrow('代理连接失败')
    expect(directHits).toBe(0)
  })
})
