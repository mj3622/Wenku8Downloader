import { Link } from 'react-router-dom'
import {
  IconArrowRight,
  IconBook2,
  IconBrandGithub,
  IconCode,
  IconCompass,
  IconDownload,
  IconGauge,
  IconSearch,
  IconShieldLock,
  type Icon,
} from '@tabler/icons-react'
import logoUrl from '../../../../resources/icon.png'
import { api } from '../api/client'
import { toast } from '../stores/toastStore'
import { getUserFeedback } from '../utils/userFeedback'

const GITHUB_URL = 'https://github.com/mj3622/Wenku8Downloader'

const capabilities: Array<{ icon: Icon; title: string; description: string }> = [
  {
    icon: IconCompass,
    title: '发现与排行榜',
    description: '以封面浏览首页推荐、热门内容和完整榜单。',
  },
  {
    icon: IconSearch,
    title: '精准检索',
    description: '按书名、作者或作品编号快速定位目标作品。',
  },
  {
    icon: IconBook2,
    title: 'EPUB 导出',
    description: '支持整本合并或按分卷导出，保留目录、封面与插图。',
  },
  {
    icon: IconDownload,
    title: '下载管理',
    description: '集中查看进度、历史与失败任务，支持取消和重试。',
  },
]

const principles: Array<{ icon: Icon; title: string; description: string }> = [
  {
    icon: IconShieldLock,
    title: '本地优先',
    description: '配置、任务和缓存留在本机，不接入项目自建云端服务。',
  },
  {
    icon: IconGauge,
    title: '节制访问',
    description: '统一管理请求间隔、重试和限流，尽量降低对数据源的额外压力。',
  },
  {
    icon: IconCode,
    title: '开源透明',
    description: '项目以 MIT 许可证开源，实现、问题与发布记录均可在 GitHub 查看。',
  },
]

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
        <div className="flex items-start gap-5">
          <img src={logoUrl} alt="" aria-hidden="true" className="h-16 w-16 flex-none" />
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <span className="rounded-full bg-apple-accent-light px-2.5 py-1 text-xs font-medium text-apple-accent">
                v2.1.0
              </span>
              <span className="text-[13px] font-medium text-apple-secondary">
                面向 Wenku8 的桌面端开源工具
              </span>
            </div>
            <h1 className="text-[30px] font-bold tracking-tight text-apple-heading">
              轻小说文库下载器
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-apple-body">
              从轻小说文库发现、检索并整理喜欢的作品，将章节、封面和插图导出为适合阅读器的 EPUB 文件。
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Link
                to="/discover"
                className="motion-pressable inline-flex items-center gap-1.5 rounded-lg bg-apple-accent px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/30"
              >
                进入发现
                <IconArrowRight aria-hidden="true" size={17} stroke={1.8} />
              </Link>
              <a
                href={GITHUB_URL}
                onClick={(event) => {
                  event.preventDefault()
                  void openExternal(GITHUB_URL)
                }}
                className="motion-pressable inline-flex items-center gap-1.5 rounded-lg border border-apple-border-input bg-white px-4 py-2.5 text-sm font-medium text-apple-secondary hover:bg-apple-bg hover:text-apple-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-apple-accent/25"
              >
                <IconBrandGithub aria-hidden="true" size={17} stroke={1.8} />
                GitHub 仓库
              </a>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="about-project-title" className="mt-8 max-w-3xl">
        <SectionTitle id="about-project-title">项目定位</SectionTitle>
        <div className="space-y-3 text-sm leading-6 text-apple-body">
          <p>
            这是一款面向个人阅读整理的桌面工具，把找书、作品详情、下载任务和 EPUB 导出收拢到同一个简洁界面中。
          </p>
          <p className="text-apple-secondary">
            本项目不提供内容或独立账号服务，使用时仍需遵守数据源站点规则及相关版权要求。
          </p>
        </div>
      </section>

      <section aria-labelledby="capabilities-title" className="mt-8">
        <SectionTitle id="capabilities-title">核心能力</SectionTitle>
        <div className="grid gap-x-10 gap-y-6 rounded-xl border border-apple-border-subtle bg-white px-5 py-5 sm:grid-cols-2 lg:px-6">
          {capabilities.map(item => <InfoItem key={item.title} {...item} />)}
        </div>
      </section>

      <section aria-labelledby="principles-title" className="mt-8">
        <SectionTitle id="principles-title">项目原则</SectionTitle>
        <div className="grid gap-5 rounded-xl border border-apple-border-subtle bg-white px-5 py-5 md:grid-cols-3 lg:px-6">
          {principles.map(item => <InfoItem key={item.title} {...item} />)}
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

function InfoItem({
  icon: Glyph,
  title,
  description,
}: {
  icon: Icon
  title: string
  description: string
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-apple-bg text-apple-secondary">
        <Glyph aria-hidden="true" size={20} stroke={1.7} />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-apple-heading">{title}</h3>
        <p className="mt-1 text-sm leading-5 text-apple-secondary">{description}</p>
      </div>
    </div>
  )
}
