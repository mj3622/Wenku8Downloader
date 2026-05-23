import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { EpubBuilder } from './epub-builder'

async function readTextFromZip(buffer: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const file = zip.file(path)
  if (!file) throw new Error(`File not found in zip: ${path}`)
  return file.async('string')
}

describe('EpubBuilder', () => {
  it('generates a valid zip buffer with epub structure', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('测试书名')
    builder.setAuthor('测试作者')
    builder.setLanguage('zh')
    builder.addChapter({
      title: '第一章',
      content: '<p>测试内容</p>',
      fileName: 'chapter1.xhtml',
    })

    const result = await builder.build()

    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBeGreaterThan(100)
    expect(result[0]).toBe(0x50)
    expect(result[1]).toBe(0x4b)

    const zip = await JSZip.loadAsync(result)
    expect(zip.file('mimetype')).toBeTruthy()
    expect(zip.file('META-INF/container.xml')).toBeTruthy()
    expect(zip.file('OEBPS/content.opf')).toBeTruthy()
    expect(zip.file('OEBPS/toc.ncx')).toBeTruthy()
    expect(zip.file('OEBPS/chapter1.xhtml')).toBeTruthy()

    const mimetype = await zip.file('mimetype')!.async('string')
    expect(mimetype).toBe('application/epub+zip')
  })

  it('includes cover metadata in opf when cover is set', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('覆盖测试')
    builder.setAuthor('作者')
    builder.addChapter({ title: '第一章', content: '<p>测试</p>', fileName: 'ch1.xhtml' })
    builder.setCover('cover.png', Buffer.from('png-data'))

    const result = await builder.build()
    const zip = await JSZip.loadAsync(result)

    expect(zip.file('OEBPS/images/cover.png')).toBeTruthy()

    const opf = await readTextFromZip(result, 'OEBPS/content.opf')
    expect(opf).toContain('cover.png')
    expect(opf).toContain('meta name="cover"')
  })

  it('escapes XML special characters', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('测试 <书>& 号"作品\'')
    builder.setAuthor('作者 & 公司')
    builder.addChapter({ title: '第一章', content: '<p>内容</p>', fileName: 'ch1.xhtml' })

    const result = await builder.build()
    const opf = await readTextFromZip(result, 'OEBPS/content.opf')

    expect(opf).toContain('&lt;书&gt;&amp; 号&quot;作品&apos;')
    expect(opf).toContain('作者 &amp; 公司')
  })

  it('converts &nbsp; to numeric entity in chapter content', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('空白测试')
    builder.setAuthor('作者')
    builder.addChapter({
      title: '第一章',
      content: '<p>这是&nbsp;一个&nbsp;空格</p>',
      fileName: 'ch1.xhtml',
    })

    const result = await builder.build()
    const xhtml = await readTextFromZip(result, 'OEBPS/ch1.xhtml')

    // 必须包含数值实体，不能包含 &nbsp;
    expect(xhtml).toContain('&#160;')
    expect(xhtml).not.toContain('&nbsp;')
  })

  it('converts common HTML entities to numeric in content', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('实体测试')
    builder.setAuthor('作者')
    builder.addChapter({
      title: '第一章',
      content: '<p>&mdash;破折号&hellip;省略号&middot;间隔号</p>',
      fileName: 'ch1.xhtml',
    })

    const result = await builder.build()
    const xhtml = await readTextFromZip(result, 'OEBPS/ch1.xhtml')

    expect(xhtml).toContain('&#8212;')
    expect(xhtml).toContain('&#8230;')
    expect(xhtml).toContain('&#183;')
    expect(xhtml).not.toContain('&mdash;')
    expect(xhtml).not.toContain('&hellip;')
  })

  it('preserves XML predefined entities in content', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('预定义实体')
    builder.setAuthor('作者')
    builder.addChapter({
      title: '第一章',
      content: '<p>&amp; &lt; &gt; &quot; &apos;</p>',
      fileName: 'ch1.xhtml',
    })

    const result = await builder.build()
    const xhtml = await readTextFromZip(result, 'OEBPS/ch1.xhtml')

    expect(xhtml).toContain('&amp;')
    expect(xhtml).toContain('&lt;')
    expect(xhtml).toContain('&gt;')
    expect(xhtml).toContain('&quot;')
    expect(xhtml).toContain('&apos;')
  })

  it('generates nav and ncx with correct chapter entries', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('NCX测试')
    builder.setAuthor('作者')
    builder.addChapter({ title: '序章', content: '<p>序</p>', fileName: 'prologue.xhtml' })
    builder.addChapter({ title: '第一章', content: '<p>一</p>', fileName: 'chapter1.xhtml' })
    builder.addChapter({ title: '第二章', content: '<p>二</p>', fileName: 'chapter2.xhtml' })

    const result = await builder.build()

    const ncx = await readTextFromZip(result, 'OEBPS/toc.ncx')
    expect(ncx).toContain('序章')
    expect(ncx).toContain('第一章')
    expect(ncx).toContain('第二章')

    const nav = await readTextFromZip(result, 'OEBPS/nav.xhtml')
    expect(nav).toContain('prologue.xhtml')
    expect(nav).toContain('chapter1.xhtml')
    expect(nav).toContain('chapter2.xhtml')
  })

  it('converts HTML5 void elements to XHTML self-closing tags', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('Void元素测试')
    builder.setAuthor('作者')
    builder.addChapter({
      title: '测试',
      content: '<p>第一行<br>第二行<br>第三行</p><br>结尾<hr>分隔',
      fileName: 'ch1.xhtml',
    })

    const result = await builder.build()
    const xhtml = await readTextFromZip(result, 'OEBPS/ch1.xhtml')

    // <br> 应该转为 <br/>
    expect(xhtml).toContain('<br/>')
    // <hr> 应该转为 <hr/>
    expect(xhtml).toContain('<hr/>')
    // 不应该有未闭合的 <br>（即后紧跟非 /> 的上下文）
    expect(xhtml).not.toMatch(/<br[^/]/)
    expect(xhtml).not.toMatch(/<hr[^/]/)
  })

  it('preserves already self-closing void elements', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('已有自闭合')
    builder.setAuthor('作者')
    builder.addChapter({
      title: '测试',
      content: '<p>自闭合的br</p><br/><br /><img src="a.jpg" /><img src="b.jpg"/>',
      fileName: 'ch1.xhtml',
    })

    const result = await builder.build()
    const xhtml = await readTextFromZip(result, 'OEBPS/ch1.xhtml')

    // 已有的自闭合标签不应该被双重闭合（如 <br/>/>）
    expect(xhtml).not.toContain('/>/>')
    // 所有 br 标签应该是自闭合的
    const brTags = xhtml.match(/<br[^>]*>/g) || []
    expect(brTags.length).toBe(2)
    for (const tag of brTags) {
      expect(tag.endsWith('/>')).toBe(true)
    }
  })

  it('handles merged chapter content with mixed void elements and entities', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('合并内容测试')
    builder.setAuthor('作者')

    // 模拟 downloadFullBook 合并后的内容：含 &nbsp;、<br>、多个章节
    const mergedContent =
      '<h2>序章</h2><div>&nbsp;&nbsp;&nbsp;&nbsp;第一段<br>继续<br>结束</div><br>' +
      '<h2>第一章</h2><div>&nbsp;&nbsp;新章节<br>内容</div><br>' +
      '<h2>第二章</h2><div>最后一章&mdash;结束<hr>分隔线</div>'

    builder.addChapter({
      title: '合并卷',
      content: mergedContent,
      fileName: 'merged.xhtml',
    })

    const result = await builder.build()
    const xhtml = await readTextFromZip(result, 'OEBPS/merged.xhtml')

    // 不应有命名实体（除了 XML 预定义）
    expect(xhtml).not.toContain('&nbsp;')
    expect(xhtml).not.toContain('&mdash;')
    // 数值实体应存在
    expect(xhtml).toContain('&#160;')
    expect(xhtml).toContain('&#8212;')
    // 不应有未闭合的 void 元素
    expect(xhtml).not.toMatch(/<br[^/]/)
    expect(xhtml).not.toMatch(/<hr[^/]/)
  })
})
