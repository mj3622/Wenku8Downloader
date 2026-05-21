import { Link } from 'react-router-dom'

export default function HomePage() {
  return (
    <div className="max-w-2xl">
      {/* Hero */}
      <div className="mb-10">
        <h2 className="text-[22px] font-bold text-apple-heading tracking-tight mb-2">
          轻小说文库下载器
        </h2>
        <p className="text-[15px] text-apple-body leading-relaxed">
          一款桌面端轻小说下载工具，支持按编号、作者、书名检索轻小说文库的作品，并将小说导出为 EPUB 格式，同时支持插图下载。
        </p>
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

      {/* 底部说明 */}
      <div className="rounded-xl border border-apple-border-subtle bg-apple-card p-4">
        <h4 className="text-[12px] font-semibold text-apple-heading mb-2">使用提示</h4>
        <ul className="text-[12px] text-apple-secondary space-y-1.5 leading-relaxed">
          <li>· 本工具仅支持 <strong className="text-apple-heading">轻小说文库 (wenku8.net)</strong> 的内容下载</li>
          <li>· 下载前请确保网络可正常访问轻小说文库，必要时在配置页设置代理</li>
          <li>· Cookie 有效期为数小时至数天不等，下载失败时可重新获取 Cookie 后再试</li>
          <li>· EPUB 文件默认保存在程序所在目录的 <code className="text-[11px] text-apple-accent bg-apple-accent-light px-1 py-0.5 rounded">downloads</code> 文件夹</li>
        </ul>
      </div>
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
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-apple-accent-light text-apple-accent
                         text-[12px] font-semibold flex items-center justify-center mt-0.5">
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
