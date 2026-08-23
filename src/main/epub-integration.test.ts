import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { EpubBuilder } from './epub-builder'

describe('EpubBuilder deterministic integration', () => {
  it('writes XML-safe XHTML and every referenced image into the archive', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('XHTML 格式测试')
    builder.setAuthor('测试作者')
    builder.addImage({
      fileName: 'images/pic.png',
      data: Buffer.from('fixture-image'),
      mediaType: 'image/png',
    })
    builder.addChapter({
      title: '第一章',
      content: '<p>第一&nbsp;行<br>第二 & 未转义</p><img src="images/pic.png">',
      fileName: 'chapter.xhtml',
    })

    const zip = await JSZip.loadAsync(await builder.build())
    const xhtml = await zip.file('OEBPS/chapter.xhtml')!.async('string')

    expect(xhtml).toContain('第一&#160;行<br/>')
    expect(xhtml).toContain('第二 &amp; 未转义')
    expect(xhtml).toContain('<img src="images/pic.png"/>')
    expect(xhtml).not.toContain('&nbsp;')
    expect(zip.file('OEBPS/images/pic.png')).not.toBeNull()
  })

  it('preserves merged chapter order in the generated volume', async () => {
    const builder = new EpubBuilder()
    builder.setTitle('合并格式测试')
    builder.setAuthor('测试作者')
    builder.addChapter({
      title: '第一卷',
      content: '<h2>第一章</h2><p>甲</p><br/><h2>第二章</h2><p>乙</p><br/>',
      fileName: 'volume.xhtml',
    })

    const zip = await JSZip.loadAsync(await builder.build())
    const xhtml = await zip.file('OEBPS/volume.xhtml')!.async('string')

    expect(xhtml.indexOf('第一章')).toBeLessThan(xhtml.indexOf('第二章'))
    expect(xhtml.match(/<br\/>/g)).toHaveLength(2)
  })
})
