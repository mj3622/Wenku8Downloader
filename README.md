# 轻小说文库下载器

基于 Electron + React 构建的桌面端工具，用于下载[轻小说文库](https://www.wenku8.net/)的小说并保存为 EPUB 格式。

## 功能

- 支持按编号、书名、作者检索小说
- 展示详尽的书籍封面、状态与简介
- 整本下载（合并所有卷为单个 EPUB）
- 分卷下载（多选批量下载）
- 插图下载
- 个性化配置（代理、Cookie、封面偏好等）
- 自动突破 Cloudflare 拦截（通过 `DrissionPage` 拉起浏览器获取真实 Cookie）
- 下载历史管理与失败重试

## 安装

前往 [Releases](https://github.com/mj3622/Wenku8Downloader/releases) 页面下载对应平台的安装包：

- **macOS**: `.dmg` 或 `.zip`
- **Windows**: `.exe` 安装程序
- **Linux**: `.AppImage`

首次使用前请确保本机已安装 Chrome 浏览器（用于自动获取 Cookie 突破网站验证）。

## 开发

### 环境要求

- Node.js >= 18
- Python >= 3.9
- Chrome 浏览器

### 快速开始

```bash
# 克隆项目
git clone https://github.com/mj3622/Wenku8Downloader.git
cd Wenku8Downloader

# 安装 Node.js 依赖
npm install

# 安装 Python 依赖
pip install -r requirements.txt

# 启动开发模式
npm run dev
```

### 项目结构

```
├── src/                    # Electron + React 前端
│   ├── main/               # Electron 主进程
│   ├── preload/            # 预加载脚本
│   └── renderer/           # React 渲染进程
│       ├── src/api/        # API 客户端
│       ├── src/components/ # UI 组件
│       ├── src/pages/      # 页面
│       └── src/stores/     # Zustand 状态管理
├── tools/                  # Python 后端
│   ├── api_server.py       # FastAPI 服务
│   ├── book.py             # 书籍模型
│   ├── crawler.py          # 网页爬虫
│   ├── downloader.py       # EPUB/图片下载
│   └── config_manager.py   # 配置管理
├── resources/              # 应用图标等资源
└── config/                 # 配置文件模板
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
# 单平台
npm run dist:mac

# 全平台
npm run dist:all
```

打包产物输出到 `release/` 目录。

## 常见问题

### 频繁提示被拦截或 403 错误

进入「配置」页面，点击「获取/更新 Cookie」按钮，后台会自动启动 Chrome 浏览器完成验证并获取有效 Cookie。

如果持续失败，可在配置中设置代理或手动填入浏览器 Cookie。

### 代理配置

在「配置」页面中填写 HTTP/HTTPS 代理地址即可。留空则使用直连。

### macOS 下代理报 SSL 警告

如果控制台出现 `NotOpenSSLWarning`，降级 urllib3 可解决：

```bash
pip install "urllib3<2"
```

### 分卷下载时封面异常

分卷下载默认使用首张插图作为封面。可在「配置」页面中修改 `default_cover_index` 选项。

## 技术栈

- **前端**: Electron + React 18 + TypeScript + Tailwind CSS
- **状态管理**: Zustand
- **构建工具**: electron-vite + electron-builder
- **后端**: Python FastAPI + curl_cffi + DrissionPage + EbookLib

## License

MIT
