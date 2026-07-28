import { Server as ProxyChainServer } from 'proxy-chain'
import { fetch as undiciFetch, ProxyAgent as UndiciProxyAgent } from 'undici'
import { config } from './config-manager'
import type { Wenku8Config } from './types'

type ElectronSession = import('electron').Session

export class ProxyRuntime {
  private upstreamUrl = ''
  private localServer: ProxyChainServer | null = null
  private localProxyUrl = ''
  private nodeAgent: UndiciProxyAgent | null = null
  private electronSession: ElectronSession | null = null
  private configuring: Promise<void> = Promise.resolve()

  constructor(
    private readonly getProxyConfig: () => Wenku8Config['proxy'] = () => config.getAll().proxy,
  ) {}

  async fetch(url: string, init: RequestInit): Promise<Response> {
    const proxy = this.getProxyConfig()
    if (!proxy?.enabled || !proxy.url) {
      return this.directFetch(url, init)
    }

    try {
      await this.configure(proxy.url)
    } catch {
      throw new Error('代理初始化失败')
    }
    if (process.versions.electron) {
      if (!this.electronSession) throw new Error('代理初始化失败')
      try {
        return await this.electronSession.fetch(url, init)
      } catch {
        throw new Error('代理连接失败')
      }
    }
    return this.nodeFetch(url, init)
  }

  async getElectronSession(): Promise<ElectronSession | null> {
    if (!process.versions.electron) return null
    const proxy = this.getProxyConfig()
    if (proxy?.enabled && proxy.url) {
      await this.configure(proxy.url)
      return this.electronSession
    }
    const { session } = require('electron') as typeof import('electron')
    return session.defaultSession
  }

  async getSharedProxyUrl(): Promise<string | undefined> {
    const proxy = this.getProxyConfig()
    if (!proxy?.enabled || !proxy.url) return undefined
    await this.configure(proxy.url)
    const sharedHost = process.env.PROXY_BRIDGE_ADVERTISE_HOST
    if (!sharedHost) return this.localProxyUrl
    if (!/^[a-zA-Z0-9.-]+$/.test(sharedHost) || !this.localServer) {
      throw new Error('代理共享地址无效')
    }
    return `http://${sharedHost}:${this.localServer.port}`
  }

  async dispose(): Promise<void> {
    this.nodeAgent?.destroy()
    this.nodeAgent = null
    if (this.electronSession) {
      await this.electronSession.closeAllConnections()
      this.electronSession = null
    }
    if (this.localServer) {
      await this.localServer.close(true)
      this.localServer = null
      this.localProxyUrl = ''
    }
    this.upstreamUrl = ''
  }

  private async directFetch(url: string, init: RequestInit): Promise<Response> {
    if (process.versions.electron) {
      const { net } = require('electron') as typeof import('electron')
      return net.fetch(url, init)
    }
    return globalThis.fetch(url, init)
  }

  private async configure(upstreamUrl: string): Promise<void> {
    if (this.upstreamUrl === upstreamUrl && this.localServer) return
    this.configuring = this.configuring.catch(() => undefined).then(async () => {
      if (this.upstreamUrl === upstreamUrl && this.localServer) return
      await this.ensureLocalServer()
      this.upstreamUrl = upstreamUrl
      this.nodeAgent?.destroy()
      this.nodeAgent = new UndiciProxyAgent(this.localProxyUrl)

      if (process.versions.electron) {
        const { session } = require('electron') as typeof import('electron')
        this.electronSession ??= session.fromPartition('wenku8-proxy-runtime', {
          cache: false,
        })
        await this.electronSession.closeAllConnections()
        const localProxyAddress = new URL(this.localProxyUrl).host
        await this.electronSession.setProxy({
          mode: 'fixed_servers',
          proxyRules: `http=${localProxyAddress};https=${localProxyAddress}`,
        })
      }
    })
    await this.configuring
  }

  private async ensureLocalServer(): Promise<void> {
    if (this.localServer) return
    const server = new ProxyChainServer({
      host: process.env.PROXY_BRIDGE_BIND === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1',
      port: 0,
      verbose: false,
      prepareRequestFunction: () => {
        if (!this.upstreamUrl) {
          return { requestAuthentication: true, failMsg: '代理尚未配置' }
        }
        return { upstreamProxyUrl: this.upstreamUrl }
      },
    })
    await server.listen()
    this.localServer = server
    this.localProxyUrl = `http://127.0.0.1:${server.port}`
  }

  private async nodeFetch(url: string, init: RequestInit): Promise<Response> {
    if (!this.nodeAgent) throw new Error('代理初始化失败')
    try {
      return await undiciFetch(url, {
        ...init,
        dispatcher: this.nodeAgent,
      } as Parameters<typeof undiciFetch>[1]) as unknown as Response
    } catch (error) {
      throw new Error('代理连接失败', { cause: error })
    }
  }
}

export const proxyRuntime = new ProxyRuntime()
