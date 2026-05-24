<p align="center">
  <img src="resources/icon.png" width="96" alt="icon" />
</p>

<h1 align="center">轻小说文库下载器</h1>

<p align="center">
  <a href="https://github.com/mj3622/Wenku8Downloader/releases"><img src="https://img.shields.io/github/v/release/mj3622/Wenku8Downloader" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/mj3622/Wenku8Downloader" /></a>
  <a href="https://github.com/mj3622/Wenku8Downloader/releases"><img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey" /></a>
</p>

<p align="center">
  从<a href="https://www.wenku8.net/">轻小说文库</a>下载小说并导出为 EPUB 格式，支持 macOS 和 Windows。
</p>

## 功能

- **多维度检索** — 支持按编号、作者、书名查找作品
- **EPUB 下载** — 支持整本合并与分卷独立导出，含封面、插图与目录
- **插图下载** — 提取指定卷的插图原图
- **自适应限流** — 根据服务器响应自动调节并发等级，避免触发访问限制
- **自动登录** — 填写账号密码后自动完成认证，内置浏览器绕过 Cloudflare 验证
- **下载管理** — 任务队列实时进度展示，失败任务可重试
- **自定义路径** — 支持指定下载文件的存储目录

## 安装

从 [Releases](https://github.com/mj3622/Wenku8Downloader/releases) 下载对应平台的安装包：

- **macOS** — 打开 `.dmg`，将应用拖入 Applications 文件夹
- **Windows** — 运行 `.exe` 安装程序

## 使用

1. **配置账号** — 在「配置」页填写文库用户名与密码，保存后自动登录获取 Cookie
2. **检索作品** — 在「检索」页输入编号、作者或书名查找目标小说
3. **选择下载** — 进入书籍详情页，选择整本下载或勾选所需分卷
4. **管理任务** — 在「下载历史」页查看进度，失败任务可重试

登录态过期后，在配置页点击「刷新 Cookie」重新获取即可。

## 开发

```bash
git clone https://github.com/mj3622/Wenku8Downloader.git
cd Wenku8Downloader
npm install
npm run dev          # 启动开发模式
npm run dist:mac     # 构建 macOS 安装包
npm run dist:win     # 构建 Windows 安装包
npm run dist         # 同时构建 macOS 与 Windows
npm test             # 运行测试
```

国内网络环境下可设置 Electron 镜像加速下载：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist:mac
```

## 技术栈

Electron · React · TypeScript · Tailwind CSS · Zustand · electron-vite · cheerio · JSZip · Puppeteer

## License

[MIT](LICENSE)
