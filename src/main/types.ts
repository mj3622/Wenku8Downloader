export interface SearchResult {
  title: string
  cover: string
  id: string
  author: string
  status: string
  tags: string
  desc: string
}

export interface BasicInfo {
  '标题': string
  '作者': string
  '出版社': string
  '最新章节': string | null
  '连载状态': string
  '更新时间': string | null
  '全文长度': string | null
  '简介': string
  'cover': string | null
}

export interface Chapter {
  name: string
  link: string
}

export interface BookInfo {
  book_id: string
  basic_info: BasicInfo
  volumes: Record<string, Chapter[]>
}

export interface Wenku8Config {
  cookie: {
    PHPSESSID: string
    jieqiUserInfo: string
    jieqiVisitInfo: string
    cf_clearance: string
  }
  login: {
    username: string
    password: string
  }
  proxy: {
    http: string
    https: string
  }
  download: {
    full_title: string
    default_cover_index: number
  }
}
