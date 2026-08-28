export type FeedbackContext =
  | 'search'
  | 'book'
  | 'config-load'
  | 'config-save'
  | 'log-save'
  | 'account-save'
  | 'login'
  | 'config-reset'
  | 'download'
  | 'download-warning'
  | 'open-folder'
  | 'open-log-folder'
  | 'log-stats'
  | 'select-folder'
  | 'open-external'
  | 'unexpected'

export interface UserFeedbackAction {
  label: string
  href: `#/${string}`
}

export interface UserFeedback {
  title: string
  message: string
  action?: UserFeedbackAction
}

const FALLBACKS: Record<FeedbackContext, UserFeedback> = {
  search: {
    title: '搜索失败',
    message: '暂时无法完成搜索，请检查网络后重试。',
  },
  book: {
    title: '作品信息加载失败',
    message: '暂时无法读取作品信息，请稍后重试。',
  },
  'config-load': {
    title: '配置加载失败',
    message: '暂时无法读取设置，请重试。',
  },
  'config-save': {
    title: '设置保存失败',
    message: '设置没有保存，请检查后重试。',
  },
  'log-save': {
    title: '日志设置保存失败',
    message: '日志设置没有保存，请检查后重试。',
  },
  'account-save': {
    title: '账号保存失败',
    message: '账号信息没有保存，请检查后重试。',
  },
  login: {
    title: '登录失败',
    message: '未能更新登录状态，请检查账号和网络后重试。',
  },
  'config-reset': {
    title: '配置处理失败',
    message: '暂时无法处理配置问题，请重试。',
  },
  download: {
    title: '下载失败',
    message: '下载未能完成，请检查网络和下载设置后重试。',
  },
  'download-warning': {
    title: '下载完成，但有部分内容缺失',
    message: '部分附加资源未能保存，正文内容仍可正常阅读。',
  },
  'open-folder': {
    title: '无法打开文件夹',
    message: '文件夹可能已被移动或删除，请检查下载位置后重试。',
  },
  'open-log-folder': {
    title: '无法打开日志目录',
    message: '请稍后重试，或重启应用后再次打开。',
  },
  'log-stats': {
    title: '无法读取日志占用',
    message: '暂时无法读取日志占用空间，请稍后重试。',
  },
  'select-folder': {
    title: '无法选择文件夹',
    message: '系统没有打开文件夹选择窗口，请稍后重试。',
  },
  'open-external': {
    title: '无法打开链接',
    message: '请检查系统默认浏览器设置后重试。',
  },
  unexpected: {
    title: '应用遇到了一点问题',
    message: '当前操作未能完成，请重试；如果仍然失败，请重启应用。',
  },
}

const TECHNICAL_DETAIL = /(?:Error invoking remote method|remote method|\bIPC\b|\b(?:Type|Reference|Range|Syntax)Error\b|\bError\s*:|\bHTTP(?:\s+status(?:\s+code)?|\/\d+(?:\.\d+)?)?\s*[:=]?\s*\d{3}\b|\bstatus(?:\s+code)?\s*[:=]?\s*\d{3}\b|状态码\s*[:：=]?\s*\d{3}\b|响应状态(?:码)?\s*[:：=]?\s*\d{3}\b|\bCookie\b|(?:https?|file):\/\/|(?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}\/\S*|[A-Za-z]:[\\/]|\\\\[^\\]+\\|(?:^|[\s:：'"(（])\/(?!\/)[^\s,，。；;!?！？]+|\n\s*at\s|\b(?:ENOSPC|ENOENT|EACCES|EPERM|ECONN\w*|ENOTFOUND|ETIMEDOUT)\b)/i

function rawMessage(error: unknown): string {
  if (error instanceof Error) return error.message.trim()
  if (typeof error === 'string') return error.trim()
  return ''
}

function unwrapElectronRemoteMessage(message: string): string {
  const unwrapped = message.replace(
    /^Error invoking remote method\s+['"][^'"]+['"]:\s*/i,
    '',
  )
  if (unwrapped === message) return message
  return unwrapped.replace(/^(?:Error\s*:\s*)+/i, '').trim()
}

function isSafeBusinessMessage(message: string): boolean {
  return message.length > 0
    && message.length <= 100
    && /[\u3400-\u9fff]/u.test(message)
    && !TECHNICAL_DETAIL.test(message)
}

function hasHttpStatus(message: string, status: 403 | 429): boolean {
  return new RegExp(
    `(?:\\bHTTP(?:\\s+status(?:\\s+code)?|\\/\\d+(?:\\.\\d+)?)?\\s*[:=]?\\s*${status}\\b|`
      + `\\bstatus(?:\\s+code)?\\s*[:=]?\\s*${status}\\b|`
      + `(?:状态码|响应状态(?:码)?).{0,4}${status})`,
    'i',
  ).test(message)
}

export class UserFacingError extends Error {
  readonly feedback: UserFeedback
  readonly cause: unknown

  constructor(feedback: UserFeedback, cause?: unknown) {
    super(feedback.message)
    this.name = 'UserFacingError'
    this.feedback = feedback
    this.cause = cause
  }
}

export function getUserFeedback(
  error: unknown,
  context: FeedbackContext = 'unexpected',
): UserFeedback {
  if (error instanceof UserFacingError) return error.feedback

  const message = rawMessage(error)
  const businessMessage = unwrapElectronRemoteMessage(message)

  if (
    hasHttpStatus(message, 403)
    || /(?:访问被拒绝|cookie.{0,20}(?:过期|失效)|登录状态.{0,12}(?:过期|失效))/i.test(message)
  ) {
    return {
      title: '登录状态已失效',
      message: '请前往配置页重新登录，然后再试一次。',
      action: { label: '前往配置', href: '#/config' },
    }
  }

  if (
    hasHttpStatus(message, 429)
    || /(?:too many requests|(?:请求|操作).{0,8}(?:过于频繁|太频繁))/i.test(message)
  ) {
    return {
      title: '操作太频繁',
      message: '请稍等一会儿再试。',
    }
  }

  if (/(?:ENOSPC|disk full|磁盘.{0,8}(?:已满|空间不足)|存储空间不足)/i.test(message)) {
    return {
      title: '存储空间不足',
      message: '请清理磁盘空间或更换下载目录后重试。',
      action: { label: '检查下载设置', href: '#/config' },
    }
  }

  if (/(?:EACCES|EPERM|permission denied|没有权限|无权限)/i.test(message)) {
    return {
      title: '没有文件访问权限',
      message: '请选择有写入权限的下载目录后重试。',
      action: { label: '检查下载设置', href: '#/config' },
    }
  }

  if (/(?:ETIMEDOUT|timed?\s*out|请求超时|连接超时)/i.test(message)) {
    return {
      title: '连接超时',
      message: '网络响应较慢，请稍后重试。',
    }
  }

  if (/(?:ECONN\w*|ENOTFOUND|network\s*(?:error|failed)|网络.{0,8}(?:异常|不可用|失败))/i.test(message)) {
    return {
      title: '网络连接失败',
      message: '请检查网络连接后重试。',
    }
  }

  if (/账号设置已保存，但登录状态同步失败/.test(businessMessage)) {
    return {
      title: '账号已保存，但登录未完成',
      message: '账号已保存，但登录状态没有更新，请点击“刷新登录状态”重试。',
    }
  }

  if (/登录信息已清除，但旧登录状态清理未完成/.test(businessMessage)) {
    return {
      title: '登录信息已清除，但清理未完成',
      message: '登录信息已清除，请重启应用以清理旧登录状态。',
    }
  }

  if (/配置已重置，但登录状态同步失败/.test(businessMessage)) {
    return {
      title: '配置已重置，但登录未完成',
      message: '配置已重置，请重启应用后再次登录。',
    }
  }

  if (isSafeBusinessMessage(businessMessage)) {
    return { ...FALLBACKS[context], message: businessMessage }
  }

  return { ...FALLBACKS[context] }
}

export function toUserFacingError(
  error: unknown,
  context: FeedbackContext = 'unexpected',
): UserFacingError {
  if (error instanceof UserFacingError) return error
  return new UserFacingError(getUserFeedback(error, context), error)
}
