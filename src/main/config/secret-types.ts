export const COOKIE_NAMES = [
  'PHPSESSID',
  'jieqiUserInfo',
  'jieqiVisitInfo',
  'cf_clearance',
] as const

export type CookieName = typeof COOKIE_NAMES[number]

export interface Credentials {
  username: string
  password: string
}

export type CookieSnapshot = Record<CookieName, string>

export function emptyCookieSnapshot(): CookieSnapshot {
  return {
    PHPSESSID: '',
    jieqiUserInfo: '',
    jieqiVisitInfo: '',
    cf_clearance: '',
  }
}
