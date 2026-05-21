# 轻小说文库下载器

基于 Electron + React + TypeScript 构建的桌面端工具，用于下载[轻小说文库](https://www.wenku8.net/)的小说并保存为 EPUB 格式。

纯 TypeScript 全栈实现，零 Python 依赖。

## 功能

- 按编号、书名、作者检索小说
- 展示详尽的书籍封面、状态与简介
- 整本下载（合并所有卷为单个 EPUB）
- 分卷下载（多选批量下载）
- 插图下载
- 个性化配置（代理、Cookie、封面偏好等）
- 自动突破 Cloudflare 拦截（通过内置 Chromium 窗口获取真实 Cookie）
- 下载历史管理与失败重试

## 安装

前往 [Releases](https://github.com/mj3622/Wenku8Downloader/releases) 页面下载对应平台的安装包：

- **macOS**: `.dmg` 或 `.zip`
- **Windows**: `.exe` 安装程序
- **Linux**: `.AppImage`

## 开发

### 环境要求

- Node.js >= 18

### 快速开始

```bash
git clone https://github.com/mj3622/Wenku8Downloader.git
cd Wenku8Downloader
npm install
npm run dev
```

### 项目结构

```
├── src/
│   ├── main/               # Electron 主进程（业务逻辑）
│   │   ├── index.ts         # 应用入口
│   │   ├── ipc-handlers.ts  # IPC 处理器
│   │   ├── crawler.ts       # HTTP 爬虫（Chromium TLS）
│   │   ├── book.ts          # 书籍模型
│   │   ├── downloader.ts    # EPUB/图片下载
│   │   ├── epub-builder.ts  # EPUB 组装
│   │   ├── cookie-acquirer.ts # 浏览器登录自动化
│   │   ├── config-manager.ts  # TOML 配置管理
│   │   └── types.ts         # 共享类型
│   ├── preload/            # 预加载脚本
│   └── renderer/           # React 渲染进程
│       ├── src/api/         # IPC 客户端
│       ├── src/components/  # UI 组件
│       ├── src/pages/       # 页面
│       └── src/stores/      # Zustand 状态管理
├── resources/              # 应用图标
└── config/                 # 配置文件
```

### 可用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（热重载） |
| `npm run build` | 构建生产版本 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run dist:mac` | 打包 macOS 安装包 |
| `npm run dist:win` | 打包 Windows 安装包 |
| `npm run dist:linux` | 打包 Linux 安装包 |

## 打包发布

```bash
npm run dist:mac    # macOS
npm run dist:win    # Windows
npm run dist:all    # 全平台
```

打包产物输出到 `release/` 目录。

## 常见问题

### 频繁提示被拦截或 403 错误

进入「配置」页面，点击「获取/更新 Cookie」按钮，会弹出内置浏览器窗口自动完成 Cloudflare 验证并登录获取 Cookie。

### 代理配置

在「配置」页面中填写 HTTP/HTTPS 代理地址即可。留空则使用直连。

### 分卷下载时封面异常

分卷下载默认使用首张插图作为封面。可在「配置」页面中修改 `default_cover_index` 选项。

## 技术栈

- **前端**: Electron + React 18 + TypeScript + Tailwind CSS
- **状态管理**: Zustand
- **HTTP 传输**: Electron `net.fetch()`（Chromium BoringSSL TLS 栈）
- **HTML 解析**: cheerio
- **EPUB 生成**: 手动 ZIP+XML 组装（jszip）
- **构建工具**: electron-vite + electron-builder

## License

MIT
