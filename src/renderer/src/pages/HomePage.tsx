import { Link } from 'react-router-dom'
import {
  IconBook2,
  IconBrandGithub,
  IconChevronRight,
  IconPhoto,
  IconRefresh,
  IconStack2,
} from '@tabler/icons-react'
import { api } from '../api/client'
import { toast } from '../stores/toastStore'
import { getUserFeedback } from '../utils/userFeedback'

const GITHUB_URL = 'https://github.com/mj3622/Wenku8Downloader'

export default function HomePage() {
  const openExternal = async (url: string): Promise<void> => {
    try {
      await api.openExternal(url)
    } catch (error) {
      toast.error(getUserFeedback(error, 'open-external'))
    }
  }

  return (
    <div className="max-w-5xl pb-8">
      <section className="rounded-2xl border border-apple-border-subtle bg-white px-6 py-6 lg:px-8 lg:py-7">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-apple-accent-light px-2.5 py-1 text-xs font-medium text-apple-accent">
            v2.0.0
          </span>
          <a
            onClick={(event) => {
              event.preventDefault()
              void openExternal(GITHUB_URL)
            }}
            href={GITHUB_URL}
            className="motion-pressable inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-apple-secondary hover:bg-apple-bg hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
          >
            <IconBrandGithub aria-hidden="true" size={16} stroke={1.8} />
            GitHub 仓库
          </a>
        </div>

        <h1 className="mb-3 text-[30px] font-bold tracking-tight text-apple-heading">
          轻小说文库下载器
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-apple-body">
          按编号、作者或书名检索作品，导出 EPUB 或单独下载插图
        </p>

      </section>

      <section aria-labelledby="getting-started-title" className="mt-8">
        <SectionTitle id="getting-started-title">快速入门</SectionTitle>
        <div className="overflow-hidden rounded-xl border border-apple-border-subtle bg-apple-card p-1.5 lg:grid lg:grid-cols-3">
          <Step index={1} title="配置登录信息" to="/config">
            填写文库账号并确认登录状态，也可设置文件保存目录
          </Step>
          <Step index={2} title="检索作品" to="/search">
            按书籍编号、作者或书名检索，选择目标作品查看详情
          </Step>
          <Step index={3} title="下载小说" to="/download">
            下载整本、分卷或插图，完成后可从下载历史打开目录
          </Step>
        </div>
      </section>

      <section aria-labelledby="features-title" className="mt-8">
        <SectionTitle id="features-title">功能概览</SectionTitle>
        <div className="grid gap-x-10 gap-y-6 rounded-xl border border-apple-border-subtle bg-apple-card px-5 py-5 sm:grid-cols-2 lg:px-6">
          <Feature icon="book" title="EPUB 整本下载" desc="合并卷册、封面、插图与目录" />
          <Feature icon="layers" title="分卷下载" desc="每卷独立导出为 EPUB" />
          <Feature icon="image" title="插图下载" desc="单独保存指定卷插图" />
          <Feature icon="refresh" title="自动更新登录状态" desc="使用已保存账号自动更新" />
        </div>
      </section>

    </div>
  )
}

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mb-3 text-lg font-semibold tracking-tight text-apple-heading">
      {children}
    </h2>
  )
}

function Step({ index, title, to, children }: {
  index: number
  title: string
  to: string
  children: string
}) {
  return (
    <Link
      to={to}
      className="group relative flex gap-4 rounded-lg px-4 py-3.5 before:pointer-events-none before:absolute before:-inset-x-1.5 before:inset-y-0 before:rounded-lg before:bg-[linear-gradient(90deg,transparent,rgba(0,113,227,0.05)_7%,rgba(0,113,227,0.05)_93%,transparent)] before:opacity-0 before:transition-opacity before:duration-200 before:ease-out-emphasized after:pointer-events-none after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-gradient-to-r after:from-transparent after:via-apple-border-subtle after:to-transparent after:content-[''] last:after:hidden hover:before:opacity-100 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-apple-accent/25 lg:after:bottom-4 lg:after:left-auto lg:after:right-0 lg:after:top-4 lg:after:h-auto lg:after:w-px lg:after:bg-gradient-to-b"
    >
      <span className="relative z-[1] flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-apple-accent-light text-sm font-semibold text-apple-accent transition-shadow duration-200 ease-out-emphasized group-hover:ring-1 group-hover:ring-inset group-hover:ring-apple-accent/20">
        {index}
      </span>
      <span className="relative z-[1] min-w-0 pr-3">
        <span className="mb-2 block text-sm font-semibold text-apple-heading transition-colors duration-200 ease-out-emphasized group-hover:text-apple-accent">
          {title}
        </span>
        <span className="block text-sm leading-6 text-apple-secondary">
          {children}
        </span>
      </span>
      <IconChevronRight
        aria-hidden="true"
        size={18}
        stroke={1.8}
        className="absolute right-4 top-1/2 z-[1] -translate-y-1/2 text-apple-tertiary transition-colors duration-200 ease-out-emphasized group-hover:text-apple-accent"
      />
    </Link>
  )
}

type FeatureIcon = 'book' | 'layers' | 'image' | 'refresh'

const FEATURE_ICONS = {
  book: IconBook2,
  layers: IconStack2,
  image: IconPhoto,
  refresh: IconRefresh,
} as const

function Feature({
  icon,
  title,
  desc,
}: {
  icon: FeatureIcon
  title: string
  desc: string
}) {
  const Glyph = FEATURE_ICONS[icon]
  return (
    <div className="flex gap-3">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-apple-bg text-apple-secondary">
        <Glyph aria-hidden="true" size={20} stroke={1.7} />
      </span>
      <div>
        <h3 className="text-sm font-semibold text-apple-heading">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-apple-secondary">{desc}</p>
      </div>
    </div>
  )
}
