export interface BasicInfo {
  '标题': string
  '作者': string
  '出版社': string
  '最新章节': string | null
  '连载状态': string
  '更新时间': string | null
  '全文长度': string | null
  '简介': string
  '标签': string[]
  '动画化': boolean
  '热度': string | null
  cover: string | null
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

export interface BookVersionFields {
  updatedAt: string
  latestChapter: string
  status: string
}
