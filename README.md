# 轻小说文库下载器

基于 Electron + React + TypeScript 的桌面端工具，用于从[轻小说文库](https://www.wenku8.net/)下载小说并保存为 EPUB 格式。

## 功能

- 按书名或作者检索小说，支持分页浏览
- 整本下载（合并所有卷为单个 EPUB）与分卷批量下载
- 章节级并发下载，自适应限流，避免触发反爬
- 插图下载，支持自定义封面图片
- 通过账号登录获取 Cookie，自动处理 Cloudflare 验证
- 下载历史管理，支持失败章节重试
- TOML 配置文件，支持代理、Cookie、封面偏好等自定义设置

## 安装

前往 [Releases](https://github.com/mj3622/Wenku8Downloader/releases) 页面下载对应平台的安装包：

- **macOS**: `.dmg` 或 `.zip`
- **Windows**: `.exe` 安装程序（NSIS）
- **Linux**: `.AppImage`

## 使用

### 基本流程

1. 在搜索页输入书名或作者关键词，点击搜索
2. 从搜索结果中点击进入书籍详情页
3. 选择「整本下载」或勾选需要的分卷后「下载选中」
4. 在下载历史页面查看进度和管理已完成的任务

### 配置

在「配置」页面可以修改以下选项：

| 配置项 | 说明 | 默认值 |
| ------ | ---- | ------ |
| 代理地址 | HTTP/HTTPS 代理 | 空（直连） |
| Cookie | 登录态 Cookie | 空 |
| 章节并发数 | 同时下载的章节数量 | 依赖速度分级自动调整 |
| 图片并发数 | 同时下载的插图数量 | 依赖速度分级自动调整 |
| 默认封面 | 分卷下载时的封面插图索引 | 0 |

### 获取 Cookie

轻小说文库需要登录后才能正常访问。在「配置」页面填写 wenku8 的用户名和密码，点击「获取/更新 Cookie」，应用会通过 HTTP POST 完成登录并自动保存返回的 Cookie。

## 开发

### 环境要求

- Node.js >= 18
- npm >= 9

### 快速开始

```bash
git clone https://github.com/mj3622/Wenku8Downloader.git
cd Wenku8Downloader
npm install
npm run dev
```

### 可用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（热重载） |
| `npm run build` | 构建生产版本 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm run test` | 运行测试 |
| `npm run dist:mac` | 打包 macOS 安装包 |
| `npm run dist:win` | 打包 Windows 安装包 |
| `npm run dist:linux` | 打包 Linux 安装包 |

### 打包发布

```bash
npm run dist:mac    # macOS（DMG + ZIP）
npm run dist:win    # Windows（NSIS 安装程序）
npm run dist:all    # 全平台
```

打包产物输出到 `release/` 目录。

如果在国内网络环境下打包 Electron 二进制下载较慢，可以设置镜像：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist:mac
```

### 项目结构

```text
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── index.ts             # 应用入口
│   │   ├── ipc-handlers.ts      # IPC 处理器
│   │   ├── crawler.ts           # HTTP 爬虫（基于 Chromium TLS 栈）
│   │   ├── book.ts              # 书籍信息模型
│   │   ├── downloader.ts        # 下载引擎（队列、限流、并行控制）
│   │   ├── epub-builder.ts      # EPUB 组装与校验
│   │   ├── cookie-service.ts    # Cookie 登录服务
│   │   ├── config-manager.ts    # TOML 配置读写
│   │   └── types.ts             # 共享类型定义
│   ├── preload/                # 预加载脚本
│   └── renderer/               # React 渲染进程
│       ├── src/api/             # IPC 客户端封装
│       ├── src/components/      # UI 组件
│       ├── src/pages/           # 页面（首页、搜索、详情、配置、历史）
│       └── src/stores/          # Zustand 状态管理
├── resources/                  # 应用图标
├── config/                     # 默认配置文件
└── release/                    # 打包产物
```

## 技术栈

| 层 | 技术 |
| ---- | ------ |
| 桌面框架 | Electron 31 |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态管理 | Zustand |
| 构建工具 | electron-vite + electron-builder |
| HTTP | Electron `net.fetch()`（Chromium BoringSSL TLS 栈） |
| HTML 解析 | cheerio |
| 编码转换 | iconv-lite |
| EPUB 生成 | 手动 ZIP + XML 组装（jszip） |
| 配置格式 | TOML（smol-toml） |
| 测试 | Vitest |

## 截图

> 截图位于 `screenshots/` 目录。

## 已知限制

- 仅支持 [轻小说文库](https://www.wenku8.net/)，不支持其他小说站点
- 下载功能需要配置有效的 wenku8 账号和登录态 Cookie
- 网络条件较差时下载速度下降明显，可调低并发数改善稳定性

## License

本项目基于 MIT License 开源，详情请查看 [LICENSE](LICENSE) 文件。
