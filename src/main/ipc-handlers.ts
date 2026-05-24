import { ipcMain, shell, dialog } from 'electron'
import { join } from 'path'
import { config } from './config-manager'
import { WebCrawler } from './crawler'
import { CookieService } from './cookie-service'
import { Book } from './book'
import { Downloader, getSavePath } from './downloader'

let crawler: WebCrawler | null = null

function getCrawler(): WebCrawler {
  if (!crawler) {
    crawler = new WebCrawler()
  }
  return crawler
}

export function registerIpcHandlers(): void {
  // ---- 配置 ----
  ipcMain.handle('config:get', async () => config.getAll())

  ipcMain.handle('config:set', async (_e, { section, key, value }) => {
    config.set(section, key, value)
    if (crawler) {
      if (section === 'cookie') crawler.syncCookies()
    }
    return { status: 'ok' }
  })

  // ---- Cookie 自动获取 ----
  ipcMain.handle('cookie:auto', async (event) => {
    try {
      const service = new CookieService(getCrawler())
      await service.acquire((progress) => {
        event.sender.send('cookie:progress', progress)
      })
      return { status: 'ok', message: '登录成功，已获取 Cookie' }
    } catch (e) {
      throw new Error(String(e))
    }
  })

  // ---- 搜索 ----
  ipcMain.handle('search:author', async (_e, { query }) => {
    const c = getCrawler()
    const results = await c.search(query, 'author')
    return { results }
  })

  ipcMain.handle('search:title', async (_e, { query }) => {
    const c = getCrawler()
    const results = await c.search(query, 'title')
    return { results }
  })

  // ---- 书籍 ----
  ipcMain.handle('book:get', async (_e, { bookId }) => {
    const book = await Book.create(bookId, getCrawler())
    return {
      book_id: book.bookId,
      basic_info: book.basicInfo,
      volumes: book.volumes,
    }
  })

  ipcMain.handle('book:images', async (_e, { bookId }) => {
    const book = await Book.create(bookId, getCrawler())
    return { images: book.pictureUrls }
  })

  // ---- 下载 ----
  ipcMain.handle('download:epub', async (event, { bookId, volumeName, taskId }) => {
    const book = await Book.create(bookId, getCrawler())
    const downloader = new Downloader(getCrawler())
    downloader.setOnProgress((p) => {
      event.sender.send('download:progress', { taskId, ...p })
    })
    await downloader.downloadNovel(book, volumeName ?? undefined)
    return { status: 'ok', message: '下载完成' }
  })

  ipcMain.handle('download:images', async (event, { bookId, volumeName, taskId }) => {
    const book = await Book.create(bookId, getCrawler())
    const downloader = new Downloader(getCrawler())
    downloader.setOnProgress((p) => {
      event.sender.send('download:progress', { taskId, ...p })
    })
    if (volumeName) {
      const urls = await book.getChapterImageUrls(volumeName)
      if (urls) {
        await downloader.downloadPictures(urls, volumeName, book.basicInfo['标题'])
      }
    } else {
      for (const vol of Object.keys(book.pictureUrls)) {
        const urls = await book.getChapterImageUrls(vol)
        if (urls) {
          await downloader.downloadPictures(urls, vol, book.basicInfo['标题'])
        }
      }
    }
    return { status: 'ok', message: '下载完成' }
  })

  // ---- 文件操作 ----
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle('shell:openFolder', async (_e, subdir: string) => {
    shell.openPath(join(getSavePath(), subdir))
  })

  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
