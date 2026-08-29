import { describe, expect, it } from 'vitest'
import {
  UserFacingError,
  getUserFeedback,
  toUserFacingError,
} from '../userFeedback'

const forbidden = [
  'Error invoking remote method',
  'IPC',
  'Error:',
  'HTTP 403',
  'Cookie',
  'C:\\Users',
  'https://',
]

describe('userFeedback', () => {
  it('turns an expired remote session error into a login-state recovery hint', () => {
    const feedback = getUserFeedback(
      new Error(
        "Error invoking remote method 'search:title': Error: 请求失败（已重试 3 次）：访问被拒绝（HTTP 403），Cookie 可能已过期，请尝试刷新 Cookie",
      ),
      'search',
    )

    expect(feedback).toEqual({
      title: '登录状态已失效',
      message: '请前往配置页重新登录，然后再试一次。',
      action: { label: '前往配置', href: '#/config' },
    })
    for (const text of forbidden) {
      expect(`${feedback.title}${feedback.message}`).not.toContain(text)
    }
  })

  it('uses a context-specific fallback instead of exposing technical details', () => {
    const feedback = getUserFeedback(
      new TypeError('Cannot read properties of undefined at C:\\Users\\tester\\app.ts'),
      'open-folder',
    )

    expect(feedback).toEqual({
      title: '无法打开文件夹',
      message: '文件夹可能已被移动或删除，请检查下载位置后重试。',
    })
    expect(JSON.stringify(feedback)).not.toContain('undefined')
    expect(JSON.stringify(feedback)).not.toContain('C:\\Users')
  })

  it('removes file URLs and full web addresses even from otherwise readable Chinese errors', () => {
    const feedback = getUserFeedback(
      new Error('无法读取 file:///D:/Code/app.ts，请查看 www.example.com/debug/3057'),
      'search',
    )

    expect(feedback).toEqual({
      title: '搜索失败',
      message: '暂时无法完成搜索，请检查网络后重试。',
    })
    expect(JSON.stringify(feedback)).not.toContain('D:/Code')
    expect(JSON.stringify(feedback)).not.toContain('www.example.com')
  })

  it.each([
    '/mnt/private/books/debug.txt',
    '/Volumes/Private/books/debug.txt',
    '/Applications/Wenku8/debug.txt',
  ])('does not expose an absolute POSIX path: %s', (path) => {
    const feedback = getUserFeedback(new Error(`无法读取 ${path}，请稍后重试`), 'search')

    expect(feedback).toEqual({
      title: '搜索失败',
      message: '暂时无法完成搜索，请检查网络后重试。',
    })
    expect(JSON.stringify(feedback)).not.toContain(path)
  })

  it.each([
    '请求失败，HTTP status 500，请稍后重试',
    '请求失败，HTTP/1.1 500，请稍后重试',
    '请求失败，状态码 500，请稍后重试',
    '请求失败，status 500，请稍后重试',
    '请求失败，status code 500，请稍后重试',
    '请求失败，响应状态 500，请稍后重试',
  ])('does not expose an alternate HTTP status format: %s', (message) => {
    const feedback = getUserFeedback(new Error(message), 'search')

    expect(feedback).toEqual({
      title: '搜索失败',
      message: '暂时无法完成搜索，请检查网络后重试。',
    })
    expect(JSON.stringify(feedback)).not.toContain('500')
  })

  it('still maps a protocol-form HTTP 403 response to the login recovery hint', () => {
    const feedback = getUserFeedback(new Error('HTTP/1.1 403 Forbidden'), 'search')

    expect(feedback.title).toBe('登录状态已失效')
    expect(feedback.action?.href).toBe('#/config')
  })

  it('maps a Chinese response status 403 to the login recovery hint', () => {
    const feedback = getUserFeedback(new Error('请求失败，响应状态 403'), 'search')

    expect(feedback.title).toBe('登录状态已失效')
    expect(feedback.action?.href).toBe('#/config')
  })

  it('maps a Chinese response status 429 to a retry-later hint', () => {
    const feedback = getUserFeedback(new Error('请求失败，响应状态码 429'), 'search')

    expect(feedback).toEqual({
      title: '操作太频繁',
      message: '请稍等一会儿再试。',
    })
  })

  it('keeps a concise Chinese business rule that contains no technical details', () => {
    const feedback = getUserFeedback(
      new Error('用户名变更时必须提供密码'),
      'account-save',
    )

    expect(feedback.message).toBe('用户名变更时必须提供密码')
  })

  it('keeps a safe business reason after removing the Electron remote wrapper', () => {
    const feedback = getUserFeedback(
      new Error(
        "Error invoking remote method 'download:images': Error: 该作品没有可保存的插图",
      ),
      'download',
    )

    expect(feedback).toEqual({
      title: '下载失败',
      message: '该作品没有可保存的插图',
    })
    for (const text of forbidden) {
      expect(`${feedback.title}${feedback.message}`).not.toContain(text)
    }
  })

  it.each([
    {
      raw: "Error invoking remote method 'config:update-credentials': Error: 账号设置已保存，但登录状态同步失败，请重新登录",
      context: 'account-save' as const,
      title: '账号已保存，但登录未完成',
      message: '账号已保存，但登录状态没有更新，请点击“刷新登录状态”重试。',
    },
    {
      raw: "Error invoking remote method 'config:reset-corrupt': Error: 配置已重置，但登录状态同步失败，请重启应用",
      context: 'config-reset' as const,
      title: '配置已重置，但登录未完成',
      message: '配置已重置，请重启应用后再次登录。',
    },
  ])('keeps completed work accurate when a later login sync fails', ({
    raw, context, title, message,
  }) => {
    const feedback = getUserFeedback(new Error(raw), context)

    expect(feedback).toEqual({ title, message })
    for (const text of forbidden) {
      expect(`${feedback.title}${feedback.message}`).not.toContain(text)
    }
  })

  it('recognizes a friendly rate-limit message without requiring a status code', () => {
    const feedback = getUserFeedback(new Error('操作过于频繁，请稍后重试'), 'search')

    expect(feedback).toEqual({
      title: '操作太频繁',
      message: '请稍等一会儿再试。',
    })
  })

  it.each([
    '未找到卷：第403卷',
    '第429卷有一张插图未能下载',
  ])('does not mistake a volume number for an HTTP status: %s', (message) => {
    const feedback = getUserFeedback(new Error(message), 'download')

    expect(feedback).toEqual({ title: '下载失败', message })
  })

  it('explains the recovery action when cleared credentials cannot finish cleanup', () => {
    const feedback = getUserFeedback(
      new Error(
        "Error invoking remote method 'config:update-credentials': Error: 登录信息已清除，但旧登录状态清理未完成，请重启应用",
      ),
      'account-save',
    )

    expect(feedback).toEqual({
      title: '登录信息已清除，但清理未完成',
      message: '登录信息已清除，请重启应用以清理旧登录状态。',
    })
  })

  it('wraps unknown errors in a typed user-facing error', () => {
    const error = toUserFacingError(new Error('ENOSPC: disk full'), 'download')

    expect(error).toBeInstanceOf(UserFacingError)
    expect(error.feedback).toEqual({
      title: '存储空间不足',
      message: '请清理磁盘空间或更换下载目录后重试。',
      action: { label: '检查下载设置', href: '#/config' },
    })
  })
})
