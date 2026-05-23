import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      {/* 版本号 + GitHub */}
      <div className="flex items-center gap-2 mb-4">
        <span className="inline-block px-2.5 py-0.5 rounded-full bg-apple-accent-light text-apple-accent text-[11px] font-medium">
          v2.0.0
        </span>
        <a
          href="https://github.com/mj3622/Wenku8Downloader"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full border border-apple-border-subtle text-[11px] text-apple-heading font-medium hover:text-apple-accent hover:border-apple-accent/30 transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          GitHub 仓库
        </a>
      </div>

      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-[30px] font-bold text-apple-heading tracking-tight mb-4">
          轻小说文库下载器
        </h1>
        <div className="w-11 h-1 bg-apple-accent rounded-full mb-4" />
        <p className="text-[14px] text-apple-body whitespace-nowrap">
          一款桌面端轻小说下载工具，支持按编号、作者、书名检索作品，并导出为 EPUB 格式，同时支持插图下载。
        </p>
      </div>

      {/* 操作按钮 */}
      <div className="flex gap-3 mb-10">
        <Link
          to="/search"
          className="flex-1 px-4 py-2.5 rounded-lg bg-apple-accent text-white text-[13px] font-semibold text-center hover:opacity-90 transition-opacity"
        >
          检索作品
        </Link>
        <Link
          to="/download"
          className="flex-1 px-4 py-2.5 rounded-lg border border-apple-border-subtle text-apple-heading text-[13px] font-semibold text-center hover:border-apple-accent/30 hover:text-apple-accent transition-colors"
        >
          下载历史
        </Link>
        <Link
          to="/config"
          className="flex-1 px-4 py-2.5 rounded-lg border border-apple-border-subtle text-apple-heading text-[13px] font-semibold text-center hover:border-apple-accent/30 hover:text-apple-accent transition-colors"
        >
          配置
        </Link>
      </div>

      {/* 快速入门 */}
      <section className="mb-10">
        <h3 className="text-[13px] font-semibold text-apple-heading mb-4">快速入门</h3>
        <div className="space-y-3">
          <Step index={1} title="配置账号与 Cookie" to="/config">
            首次使用请先在「配置」页面填写文库账号密码，点击「一键获取 / 刷新 Cookie」自动完成登录认证。Cookie 是下载小说的必要凭证。
          </Step>
          <Step index={2} title="检索作品" to="/search">
            进入「检索」页面，可以通过编号直接查询指定书籍，或输入作者名 / 书名模糊搜索，找到目标作品后点击「查看详情」。
          </Step>
          <Step index={3} title="下载小说" to="/download">
            进入「下载」页面，查询到书籍后可以选择「整本下载」导出完整 EPUB，或按卷选择「分卷下载」；也可以单独下载书籍插图。
          </Step>
        </div>
      </section>

      {/* 功能概览 */}
      <section className="mb-10">
        <h3 className="text-[13px] font-semibold text-apple-heading mb-4">功能概览</h3>
        <div className="grid grid-cols-2 gap-3">
          <FeatureCard
            title="EPUB 整本下载"
            desc="将所有卷合并导出为一个 EPUB 文件，包含封面、插图与目录"
          />
          <FeatureCard
            title="分卷下载"
            desc="按卷分别下载，每卷生成独立的 EPUB 文件，方便分册阅读"
          />
          <FeatureCard
            title="插图下载"
            desc="单独提取并下载指定卷的插图图片，适合收藏高清原图"
          />
          <FeatureCard
            title="自动获取 Cookie"
            desc="内置 Chrome 浏览器自动化，一键绕过 Cloudflare 防护获取有效 Cookie"
          />
        </div>
      </section>

      {/* 提示 */}
      <section>
        <h3 className="text-[13px] font-semibold text-apple-heading mb-4">提示</h3>
        <div className="rounded-xl border border-apple-border-subtle bg-apple-card p-4">
          <ul className="text-[12px] text-apple-secondary space-y-1.5 leading-relaxed">
            <li>
              · 本工具仅支持{' '}
              <strong className="text-apple-heading">
                轻小说文库 (<a href="https://www.wenku8.net" target="_blank" rel="noopener noreferrer" className="text-apple-accent hover:underline">wenku8.net</a>)
              </strong>{' '}
              的内容下载
            </li>
            <li>· Cookie 有效期为数小时至数天不等，下载失败时可重新获取 Cookie 后再试</li>
            <li>
              · EPUB 文件默认保存在程序所在目录的{' '}
              <code className="text-[11px] text-apple-accent bg-apple-accent-light px-1 py-0.5 rounded">downloads</code>{' '}
              文件夹
            </li>
          </ul>
        </div>
      </section>
    </div>
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
      className="block p-4 rounded-xl border border-apple-border-subtle bg-apple-card
                 hover:border-apple-accent/20 transition-all"
    >
      <div className="flex items-start gap-4">
        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-apple-accent-light text-apple-accent
                         text-[13px] font-semibold flex items-center justify-center mt-0.5">
          {index}
        </span>
        <div>
          <h4 className="text-[14px] font-semibold text-apple-heading mb-1">{title}</h4>
          <p className="text-[12px] text-apple-secondary leading-relaxed">{children}</p>
        </div>
      </div>
    </Link>
  )
}

function FeatureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="p-4 rounded-xl border border-apple-border-subtle bg-apple-card">
      <h4 className="text-[13px] font-semibold text-apple-heading mb-1">{title}</h4>
      <p className="text-[12px] text-apple-secondary leading-relaxed">{desc}</p>
    </div>
  )
}
