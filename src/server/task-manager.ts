import { randomUUID } from 'crypto'
import {
  existsSync,
  copyFileSync,
  createWriteStream,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs'
import { basename, join, resolve, sep } from 'path'
import archiver from 'archiver'
import { Book } from '../main/book'
import { WebCrawler } from '../main/crawler'
import { Downloader, getSavePath, safeFileName } from '../main/downloader'

export type WebDownloadTask = {
  id: string
  bookId: string
  title: string
  cover?: string
  type: 'epub_full' | 'epub_volume' | 'images'
  volume?: string
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  progress: number
  phase?: string
  error?: string
  createdAt: number
  hasArtifact?: boolean
}

type StoredTask = WebDownloadTask & {
  artifactPath?: string
  artifactName?: string
}

export type TaskEventSink = (tasks: WebDownloadTask[]) => void

function publicTask(task: StoredTask): WebDownloadTask {
  const { artifactPath: _artifactPath, artifactName: _artifactName, ...value } = task
  return { ...value, hasArtifact: Boolean(task.artifactPath) }
}

async function zipDirectory(sourceDir: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const output = createWriteStream(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolvePromise)
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(sourceDir, false)
    void archive.finalize()
  })
}

export class DownloadTaskManager {
  private readonly crawler: WebCrawler
  private readonly tasksPath: string
  private readonly artifactsDir: string
  private readonly onChange: TaskEventSink
  private tasks: StoredTask[] = []
  private running = false

  constructor(dataDir: string, crawler: WebCrawler, onChange: TaskEventSink) {
    this.crawler = crawler
    this.onChange = onChange
    const tasksDir = join(dataDir, 'tasks')
    this.artifactsDir = join(getSavePath(), 'artifacts')
    this.tasksPath = join(tasksDir, 'tasks.json')
    mkdirSync(tasksDir, { recursive: true })
    mkdirSync(this.artifactsDir, { recursive: true })
    this.load()
    setImmediate(() => void this.executeNext())
  }

  list(): WebDownloadTask[] {
    return this.tasks.map(publicTask)
  }

  enqueue(input: {
    id?: string
    bookId: string
    title?: string
    type: WebDownloadTask['type']
    volume?: string
  }): WebDownloadTask {
    const id = input.id || randomUUID()
    const existing = this.tasks.find((task) => task.id === id)
    if (existing) return publicTask(existing)

    const task: StoredTask = {
      id,
      bookId: input.bookId,
      title: input.title?.slice(0, 200) || `作品 ${input.bookId}`,
      type: input.type,
      volume: input.volume,
      status: 'pending',
      progress: 0,
      phase: '等待下载...',
      createdAt: Date.now(),
    }
    this.tasks.unshift(task)
    this.commit()
    void this.executeNext()
    return publicTask(task)
  }

  retry(id: string): WebDownloadTask | null {
    const task = this.tasks.find((item) => item.id === id)
    if (!task || task.status !== 'failed') return null
    task.status = 'pending'
    task.progress = 0
    task.phase = '等待下载...'
    delete task.error
    delete task.artifactPath
    delete task.artifactName
    this.commit()
    void this.executeNext()
    return publicTask(task)
  }

  remove(id: string): boolean {
    const task = this.tasks.find((item) => item.id === id)
    if (!task || task.status === 'downloading') return false
    this.tasks = this.tasks.filter((item) => item.id !== id)
    this.commit()
    return true
  }

  clearHistory(): void {
    this.tasks = this.tasks.filter(
      (task) => task.status === 'pending' || task.status === 'downloading',
    )
    this.commit()
  }

  getArtifact(id: string): { path: string; name: string } | null {
    const task = this.tasks.find((item) => item.id === id)
    if (!task?.artifactPath || !task.artifactName || !existsSync(task.artifactPath)) return null
    const libraryRoot = resolve(getSavePath())
    const artifactPath = resolve(task.artifactPath)
    if (artifactPath !== libraryRoot && !artifactPath.startsWith(`${libraryRoot}${sep}`)) return null
    return { path: artifactPath, name: task.artifactName }
  }

  private load(): void {
    if (!existsSync(this.tasksPath)) return
    try {
      this.tasks = JSON.parse(readFileSync(this.tasksPath, 'utf-8')) as StoredTask[]
      for (const task of this.tasks) {
        if (task.status === 'downloading') {
          task.status = 'pending'
          task.progress = 0
          task.phase = '服务器重启，任务已重新排队'
        }
      }
      this.persist()
    } catch {
      this.tasks = []
    }
  }

  private persist(): void {
    const tempPath = `${this.tasksPath}.tmp`
    writeFileSync(tempPath, JSON.stringify(this.tasks, null, 2), 'utf-8')
    renameSync(tempPath, this.tasksPath)
  }

  private commit(): void {
    this.persist()
    this.onChange(this.list())
  }

  private emitProgress(task: StoredTask, current: number, total: number, phase: string): void {
    task.progress = total > 0 ? Math.round((current / total) * 100) : 0
    task.phase = phase
    this.onChange(this.list())
  }

  private async executeNext(): Promise<void> {
    if (this.running) return
    const task = [...this.tasks].reverse().find((item) => item.status === 'pending')
    if (!task) return

    this.running = true
    task.status = 'downloading'
    task.phase = '正在读取作品信息...'
    this.commit()

    try {
      const book = await Book.create(task.bookId, this.crawler)
      task.title = book.basicInfo['标题']
      task.cover = book.basicInfo.cover || undefined

      const downloader = new Downloader(this.crawler)
      downloader.setOnProgress((progress) => {
        this.emitProgress(task, progress.current, progress.total, progress.phase)
      })

      if (task.type === 'images') {
        const downloadedDirs: string[] = []
        const volumes = task.volume ? [task.volume] : Object.keys(book.pictureUrls)
        for (const volume of volumes) {
          const urls = await book.getChapterImageUrls(volume)
          if (urls?.length) {
            downloadedDirs.push(
              await downloader.downloadPictures(urls, volume, book.basicInfo['标题']),
            )
          }
        }
        if (downloadedDirs.length === 0) throw new Error('该作品没有可下载的插图')

        const sourceDir = task.volume
          ? downloadedDirs[0]
          : join(getSavePath(), 'pics', safeFileName(book.basicInfo['标题']))
        const artifactPath = join(this.artifactsDir, `${task.id}.zip`)
        task.phase = '正在打包插图...'
        this.onChange(this.list())
        await zipDirectory(sourceDir, artifactPath)
        task.artifactPath = artifactPath
        task.artifactName = `${safeFileName(book.basicInfo['标题'])}${task.volume ? `-${safeFileName(task.volume)}` : ''}-插图.zip`
      } else {
        const downloadedPath = await downloader.downloadNovel(book, task.volume)
        const artifactPath = join(this.artifactsDir, `${task.id}.epub`)
        copyFileSync(downloadedPath, artifactPath)
        task.artifactPath = artifactPath
        task.artifactName = basename(downloadedPath)
      }

      task.status = 'completed'
      task.progress = 100
      task.phase = '下载完成'
    } catch (error) {
      task.status = 'failed'
      task.error = error instanceof Error ? error.message : String(error)
      task.phase = '下载失败'
    } finally {
      this.running = false
      this.commit()
      void this.executeNext()
    }
  }
}
