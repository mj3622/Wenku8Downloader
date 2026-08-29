export interface SearchResult {
  title: string
  cover: string
  id: string
  author: string
  status: string
  updateTime: string
  wordCount: string
  isAnimated: boolean
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
