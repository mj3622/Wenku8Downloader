/**
 * EPUB 合并格式深度验证测试
 * 1. 获取真实 Wenku8 内容
 * 2. 模拟 downloadFullBook 的合并逻辑
 * 3. 对生成的 XHTML 做详细格式检查
 */
import { describe, it, expect } from 'vitest'
import iconv from 'iconv-lite'
import JSZip from 'jszip'
import { EpubBuilder } from './epub-builder'

const TIMEOUT = 30000

/** 下载章节内容 */
async function fetchChapterContent(url: string): Promise<{ title: string; content: string }> {
  const resp = await fetch(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const buf = Buffer.from(await resp.arrayBuffer())
  const html = iconv.decode(buf, 'gbk')

  const titleMatch = html.match(/<title>([^<]+)<\/title>/)
  const title = titleMatch ? titleMatch[1].split(' - ')[0]?.trim() : ''

  const contentMatch = html.match(/<div id="content">([\s\S]*?)<\/div>/)
  let content = ''
  if (contentMatch) {
    content = contentMatch[1]
    content = content.replace(/<ul[^>]*>[\s\S]*?<\/ul>/g, '').trim()
  }

  return { title, content }
}

/** 获取图片列表 */
async function fetchIllustrationUrls(illustUrl: string): Promise<string[]> {
  const resp = await fetch(illustUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  })
  if (!resp.ok) return []
  const buf = Buffer.from(await resp.arrayBuffer())
  const html = iconv.decode(buf, 'gbk')

  const urls: string[] = []
  const imgRegex = /<img[^>]+src="([^"]+)"/g
  let match
  while ((match = imgRegex.exec(html)) !== null) {
    urls.push(match[1])
  }
  return urls
}

/** 下载图片 */
async function downloadImage(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url.replace('http://', 'https://'), {
      headers: {
        'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    })
    if (resp.ok) return Buffer.from(await resp.arrayBuffer())
    return null
  } catch {
    return null
  }
}

describe('EPUB 合并格式深度测试', () => {
  it('模拟 downloadFullBook 合并流程：章节+图片，验证完整 EPUB 格式', { timeout: TIMEOUT }, async () => {
    // Step 1: 获取真实章节
    const ch1 = await fetchChapterContent('https://www.wenku8.net/novel/0/1/2.htm')
    const ch2 = await fetchChapterContent('https://www.wenku8.net/novel/0/1/3.htm')

    // Step 2: 获取插图 URL
    const illustUrls = await fetchIllustrationUrls('https://www.wenku8.net/novel/0/1/24315.htm')
    console.log(`  插图数量: ${illustUrls.length}`)

    // Step 3: 下载第一张插图（如果有的话）
    let imageData: Buffer | null = null
    let imageExt = 'jpg'
    if (illustUrls.length > 0) {
      imageData = await downloadImage(illustUrls[0])
      imageExt = illustUrls[0].split('.').pop() || 'jpg'
      console.log(`  下载插图: ${imageData ? '成功' : '失败'} (${illustUrls[0].substring(0, 60)})`)
    }

    // Step 4: 模拟 downloadFullBook 的合并逻辑
    const volName = '第一卷 渴望死亡的小丑'
    let mergedContent = ''

    // 插图部分
    if (imageData) {
      mergedContent += `<img src="images/${volName}_1.${imageExt}"/><br/>`
    }

    // 合并多个章节
    mergedContent += `<h2>${ch1.title}</h2><div>${ch1.content}</div><br/>`
    mergedContent += `<h2>${ch2.title}</h2><div>${ch2.content}</div><br/>`

    // Step 5: 构建 EPUB（与 downloadFullBook 相同的方式）
    const builder = new EpubBuilder()
    builder.setTitle('测试全本EPUB')
    builder.setAuthor('野村美月')
    builder.setLanguage('zh')

    // 设置封面（模拟 setCover）
    if (imageData) {
      builder.setCover(`cover.${imageExt}`, imageData)
    }

    // 添加合并后的章节
    builder.addChapter({
      title: volName,
      content: mergedContent,
      fileName: `${volName}.xhtml`,
    })

    // 如果有额外图片（非封面），添加到 builder
    // 注：封面已在 setCover 中添加，这里只添加不同图片

    // Step 6: 生成并验证
    const epubBuffer = await builder.build()
    const zip = await JSZip.loadAsync(epubBuffer)

    console.log(`  EPUB 大小: ${epubBuffer.length} 字节`)
    console.log('  ZIP 内容:')
    for (const [path] of Object.entries(zip.files)) {
      if (!path.startsWith('OEBPS/')) {
        console.log(`    ${path}`)
      }
    }
    const oebpsFiles = Object.keys(zip.files).filter(f => f.startsWith('OEBPS/'))
    console.log(`  OEBPS 文件数: ${oebpsFiles.length}`)
    for (const f of oebpsFiles) {
      const size = zip.file(f)?.name ? '(有)' : '(无)'
      console.log(`    ${f}`)
    }

    // Step 7: 检查 XHTML 格式
    const volXhtml = await zip.file(`OEBPS/${volName}.xhtml`)!.async('string')

    console.log(`\n  XHTML 分析:`)
    console.log(`  - 长度: ${volXhtml.length} 字符`)

    // 检查 XML 声明
    const hasXmlDecl = volXhtml.startsWith('<?xml')
    console.log(`  - XML 声明: ${hasXmlDecl ? '✓' : '✗ 缺失!'}`)

    // 检查命名实体（除了预定义的5个）
    const allEntities = volXhtml.match(/&[a-zA-Z]+;/g) || []
    const allowed = new Set(['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'])
    const badEntities = allEntities.filter(e => !allowed.has(e))
    console.log(`  - 非标准命名实体: ${badEntities.length > 0 ? '✗ ' + [...new Set(badEntities)].join(', ') : '✓ 无'}`)

    // 检查数值实体
    const numericEntities = volXhtml.match(/&#\d+;/g) || []
    console.log(`  - 数值实体数量: ${numericEntities.length}`)
    if (numericEntities.length > 0) {
      const uniqueNumeric = [...new Set(numericEntities)]
      console.log(`    类型: ${uniqueNumeric.slice(0, 10).join(', ')}`)
    }

    // 检查 &nbsp; 是否被转换
    const hasNbsp = volXhtml.includes('&nbsp;')
    console.log(`  - &nbsp; 已转换: ${hasNbsp ? '✗ 仍有 &nbsp;' : '✓'}`)

    // Step 8: 检查内容完整性
    // 取章节内容的前 30 个非空白字符，验证它们是否在 XHTML 中
    const ch1Text = ch1.content.replace(/&nbsp;|&#160;|<[^>]+>/g, '').replace(/\s+/g, '').substring(0, 30)
    const xhtmlClean = volXhtml.replace(/&#160;/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, '')
    const contentPresent = xhtmlClean.includes(ch1Text)
    console.log(`  - 章节1内容完整性: ${contentPresent ? '✓' : '✗ 内容可能丢失!'}`)

    // Step 9: 检查 OPF
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    console.log(`\n  OPF 分析:`)

    // 检查 manifest 是否完整
    const manifestItems = opf.match(/<item[^>]+>/g) || []
    console.log(`  - Manifest items: ${manifestItems.length}`)

    // 检查 spine
    const spineItems = opf.match(/<itemref[^>]+>/g) || []
    console.log(`  - Spine items: ${spineItems.length}`)

    // 检查封面 meta
    const hasCoverMeta = opf.includes('meta name="cover"')
    console.log(`  - 封面 meta: ${hasCoverMeta ? '✓' : (imageData ? '✗ 缺失!' : '- 无封面')}`)

    // Step 10: 检查 NCX
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string')
    const navPoints = ncx.match(/<navPoint[^>]*>/g) || []
    console.log(`\n  NCX 分析:`)
    console.log(`  - NavPoints: ${navPoints.length}`)

    // Step 11: 检查是否有重复 ID 问题
    const allIds = opf.match(/id="([^"]+)"/g) || []
    const idSet = new Set(allIds)
    console.log(`\n  ID 检查:`)
    console.log(`  - 总 ID 数: ${allIds.length}, 唯一 ID 数: ${idSet.size}`)
    console.log(`  - ID 重复: ${allIds.length !== idSet.size ? '✗ 有重复!' : '✓ 无重复'}`)

    // Final assertions
    expect(hasXmlDecl).toBe(true)
    expect(badEntities.length).toBe(0)
    expect(hasNbsp).toBe(false)
    expect(contentPresent).toBe(true)
  })

  it('检查 bare & 字符问题 — 模拟含特殊字符的内容合并', { timeout: TIMEOUT }, async () => {
    // 模拟可能包含未转义 & 的内容
    const problematicContent = [
      '<p>Tom &amp; Jerry</p>',           // 已转义的 & (网站正常 HTML)
      '<p>查看 id=1&amp;type=2 页面</p>', // URL 参数中的 &
      '<p>使用 &quot;引号&quot; 测试</p>', // 引号实体
      '<p>a &lt; b &amp;&amp; c &gt; d</p>', // 混合实体
    ].join('\n')

    const builder = new EpubBuilder()
    builder.setTitle('特殊字符测试')
    builder.setAuthor('测试')
    builder.addChapter({
      title: '测试章 & 节',
      content: problematicContent,
      fileName: 'test.xhtml',
    })

    const epubBuffer = await builder.build()
    const zip = await JSZip.loadAsync(epubBuffer)
    const xhtml = await zip.file('OEBPS/test.xhtml')!.async('string')

    console.log('\n  含特殊字符的 XHTML 片段:')
    const bodyMatch = xhtml.match(/<body>([\s\S]*)<\/body>/)
    if (bodyMatch) console.log(`  ${bodyMatch[1].substring(0, 500)}`)

    // XHTML 中不应该有未转义的 &
    // 排除 XML 预定义实体和数值实体后的 & 字符
    const stripped = xhtml
      .replace(/&amp;/g, '')
      .replace(/&lt;/g, '')
      .replace(/&gt;/g, '')
      .replace(/&quot;/g, '')
      .replace(/&apos;/g, '')
      .replace(/&#\d+;/g, '')
      .replace(/&#x[0-9a-fA-F]+;/g, '')

    const hasBareAmp = stripped.includes('&')
    console.log(`  含未转义 &: ${hasBareAmp ? '✗ 发现!' : '✓ 无'}`)

    // 验证标题中 & 被正确转义
    expect(xhtml).toContain('测试章 &amp; 节')

    // 验证内容实体被正确转换
    expect(xhtml).toContain('&amp;')  // XML 预定义实体保留

    // 验证没有 &nbsp; 等命名实体
    expect(xhtml).not.toContain('&nbsp;')
  })
})
