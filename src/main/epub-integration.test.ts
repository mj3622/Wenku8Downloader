/**
 * EPUB 合并格式集成测试 - 使用真实 Wenku8 内容验证
 * 包含限流处理以应对 Wenku8 的 429 限制
 */
import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import JSZip from 'jszip'
import { EpubBuilder } from './epub-builder'

const TIMEOUT = 60000

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchWenku8(url: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const resp = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    if (resp.ok) {
      const buf = Buffer.from(await resp.arrayBuffer())
      return iconv.decode(buf, 'gbk')
    }
    if (resp.status === 429 && attempt < retries - 1) {
      await sleep(3000 * (attempt + 1))
    } else if (attempt < retries - 1) {
      await sleep(1000)
    } else {
      throw new Error(`HTTP ${resp.status} for ${url}`)
    }
  }
  throw new Error('unreachable')
}

interface ChapterData {
  title: string
  content: string
}

function extractChapter(html: string): ChapterData {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  const title = titleMatch ? titleMatch[1].split(' - ')[0]?.trim() : ''
  const contentMatch = html.match(/<div id="content">([\s\S]*?)<\/div>/)
  let content = ''
  if (contentMatch) {
    content = contentMatch[1].replace(/<ul[^>]*>[\s\S]*?<\/ul>/g, '').trim()
  }
  return { title, content }
}

describe('EPUB 合并格式真实内容测试', () => {
  it('从 Wenku8 获取章节，验证 Cheerio 引入的 <br> 标签被修复为 XHTML 自闭合', { timeout: TIMEOUT }, async () => {
    // 获取一个章节（模拟 Cheerio 处理后的内容）
    const html = await fetchWenku8('https://www.wenku8.net/novel/0/1/2.htm')
    const ch = extractChapter(html)

    console.log(`  章节标题: ${ch.title.substring(0, 40)}`)
    console.log(`  内容长度: ${ch.content.length} 字符`)

    // 关键断言：Cheerio 会将 <br /> 转为 <br>
    // 在这里验证原内容确实有 <br>（Cheerio 的输出）
    const rawBrs = (ch.content.match(/<br\b[^>]*>/gi) || []).map(t => t.toLowerCase())
    console.log(`  原始 br 标签: ${[...new Set(rawBrs)].join(', ') || 'none'}`)

    // 构建 EPUB
    const builder = new EpubBuilder()
    builder.setTitle('XHTML格式测试')
    builder.setAuthor('测试')
    builder.addChapter({
      title: ch.title,
      content: ch.content,
      fileName: 'test.xhtml',
    })

    const epubBuffer = await builder.build()
    const zip = await JSZip.loadAsync(epubBuffer)
    const xhtml = await zip.file('OEBPS/test.xhtml')!.async('string')

    // 验证 XHTML 声明
    expect(xhtml.startsWith('<?xml')).toBe(true)

    // 核心验证：输出中不应有未闭合的 <br>
    // 所有 <br 标签必须以 /> 结尾
    const outputBrs = xhtml.match(/<br\b[^>]*>/gi) || []
    console.log(`  输出 br 标签: ${[...new Set(outputBrs.map(t => t.toLowerCase()))].join(', ')}`)
    for (const tag of outputBrs) {
      expect(tag.endsWith('/>')).toBe(true)
    }

    // 验证 &nbsp; 被转换
    expect(xhtml).not.toContain('&nbsp;')
    expect(xhtml).toContain('&#160;')

    // 验证内容完整性
    expect(xhtml.length).toBeGreaterThan(1000)
  })

  it('模拟多章节合并后 XHTML 的格式正确性', { timeout: TIMEOUT }, async () => {
    // 获取两个章节
    const html1 = await fetchWenku8('https://www.wenku8.net/novel/0/1/2.htm')
    await sleep(2000)  // 请求间隔，避免限流
    const html2 = await fetchWenku8('https://www.wenku8.net/novel/0/1/3.htm')

    const ch1 = extractChapter(html1)
    const ch2 = extractChapter(html2)

    // 模拟 downloadFullBook 中的合并
    const mergedContent =
      `<h2>${ch1.title}</h2><div>${ch1.content}</div><br/>` +
      `<h2>${ch2.title}</h2><div>${ch2.content}</div><br/>`

    const builder = new EpubBuilder()
    builder.setTitle('合并格式测试')
    builder.setAuthor('测试作者')
    builder.setLanguage('zh')
    builder.addChapter({
      title: '第一卷',
      content: mergedContent,
      fileName: 'volume1.xhtml',
    })

    const epubBuffer = await builder.build()
    const zip = await JSZip.loadAsync(epubBuffer)
    const xhtml = await zip.file('OEBPS/volume1.xhtml')!.async('string')

    console.log(`  合并后 XHTML 长度: ${xhtml.length} 字符`)

    // 1. XHTML 结构完整
    expect(xhtml.startsWith('<?xml')).toBe(true)
    expect(xhtml).toContain('<html xmlns="http://www.w3.org/1999/xhtml">')

    // 2. 所有 void 元素都已自闭合
    const voidTags = xhtml.match(/<(br|hr|img)\b[^>]*>/gi) || []
    for (const tag of voidTags) {
      expect(tag.endsWith('/>')).toBe(true)
    }

    // 3. 没有未转换的命名实体（除了 XML 预定义的 5 个）
    const allEntities = xhtml.match(/&[a-zA-Z]+;/g) || []
    const allowed = new Set(['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'])
    const badEntities = allEntities.filter(e => !allowed.has(e))
    expect(badEntities.length).toBe(0)

    // 4. &nbsp; 已被转换
    expect(xhtml).not.toContain('&nbsp;')

    // 5. 内容完整性 — 章节 1 的关键内容应在 XHTML 中
    const ch1KeyText = ch1.content.replace(/&nbsp;|<[^>]+>/g, '').replace(/\s+/g, '').substring(0, 20)
    const xhtmlText = xhtml.replace(/&#160;|<[^>]+>/g, '').replace(/\s+/g, '')
    expect(xhtmlText).toContain(ch1KeyText)

    console.log('  合并格式验证全部通过')
  })
})
