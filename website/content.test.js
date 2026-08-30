import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { URL } from 'node:url'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

describe('website product copy', () => {
  it('states the permanent unsigned release policy', () => {
    assert.match(html, /所有发布包均未签名/)
    assert.match(html, /项目所有正式发布包均保持未签名/)
  })

  it('describes the current discovery, search, bookshelf and download flows', () => {
    assert.match(html, /src="assets\/discover\.webp"/)
    assert.match(html, /发现好书/)
    assert.match(html, /异世界咖啡厅/)
    assert.match(html, /src="assets\/bookshelf\.webp"/)
    assert.match(html, /04 \/ 04/)
    assert.match(html, /年度专题/)
    assert.match(html, /浏览与精准检索/)
    assert.match(html, /同步与更新提醒/)
    assert.match(html, /批次与产物管理/)
    assert.match(html, /缓存与节制访问/)
    assert.match(html, /检查正式版本/)
  })
})
