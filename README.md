<p align="center">
  <img src="resources/icon.png" width="96" alt="轻小说文库下载器图标" />
</p>

<h1 align="center">轻小说文库下载器</h1>

<p align="center">
  检索轻小说、下载插图并导出 EPUB，同时支持 Electron 桌面端和私有 Web 部署。
</p>

<p align="center">
  <a href="https://github.com/mj3622/Wenku8Downloader/releases"><img src="https://img.shields.io/github/v/release/mj3622/Wenku8Downloader?label=release" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Docker-blue" alt="Platform" />
</p>

<p align="center">
  <img src="resources/ShowPage.png" alt="应用截图" width="820" />
</p>

## 项目简介

轻小说文库下载器用于从[轻小说文库](https://www.wenku8.net/)检索作品，将正文和插图整理为 EPUB，或单独打包下载插图。

项目提供两种运行方式：

- **Electron 桌面端**：适合 macOS 和 Windows 用户，下载内容直接保存到本机。
- **私有 Web 端**：通过 Docker Compose 部署，使用管理员密码保护，下载任务和文件由服务器统一管理。

> 请在遵守目标站点规则、服务条款和版权要求的前提下使用。本项目仅用于个人学习、资料整理与技术交流。

## 功能

| 功能 | 说明 |
| --- | --- |
| 作品检索 | 支持按小说编号、书名和作者搜索 |
| EPUB 导出 | 支持整本合并和指定分卷导出 |
| 插图下载 | 支持单卷或整本插图提取与 ZIP 打包 |
| 登录状态 | 使用文库账号自动获取并刷新 Cookie |
| 下载管理 | 显示进度、历史、失败原因，并支持任务重试 |
| 断点续传 | 缓存已完成章节和插图，失败后可继续下载 |
| 安全限速 | Web 端使用串行请求、退避重试和会话回收降低封禁风险 |
| 出站代理 | 支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H 代理 |
| Cloudflare 处理 | Docker 部署内置 FlareSolverr，并复用已配置的代理出口 |
| 响应式界面 | 支持桌面窗口、窄窗口、平板和手机浏览器 |
| 图片代理 | Web 端通过同源鉴权接口加载封面和文库图片 |

## 桌面端安装

前往 [Releases](https://github.com/mj3622/Wenku8Downloader/releases) 下载最新版本：

- macOS Apple Silicon：选择名称包含 `macOS-arm64` 的 `.dmg`
- macOS Intel：选择名称包含 `macOS-x64` 的 `.dmg`
- Windows：选择名称包含 `Windows-x64` 的便携版 `.exe`

macOS 用户打开 `.dmg` 后将应用拖入 `Applications`，Windows 用户可直接运行便携版。

## 使用方法

1. 打开「配置」页面，填写轻小说文库账号和密码。
2. 保存账号，等待应用获取登录 Cookie。
3. 如服务器直连被拒绝，在「代理设置」中填写代理地址并启用。
4. 在「检索」页面按编号、书名或作者查找作品。
5. 进入详情页，选择整本、分卷或插图下载。
6. 在「下载历史」中查看进度、重试任务或下载生成的文件。

桌面端可在「下载设置」中选择本机保存目录。Web 端文件保存在 Docker 数据卷中，并通过「下载历史」获取生成的 EPUB 或 ZIP。

## 代理设置

支持以下代理格式：

```text
http://host:port
https://host:port
socks5://host:port
socks5h://host:port
http://username:password@host:port
socks5://username:password@host:port
```

代理凭据会随配置加密保存，API 和界面只显示脱敏后的地址。

FlareSolverr 可以在没有代理时使用服务器公网 IP，但它只能处理浏览器验证，不能解除 IP 封禁。如果服务器直连文库持续返回 `HTTP 403`，请配置一个可访问文库的代理，优先选择稳定的住宅网络出口。

## Docker Compose 私有部署

### 环境要求

- Docker Engine
- Docker Compose v2
- 推荐至少 2 GB 可用内存
- 一个仅供个人使用的域名和 HTTPS 反向代理

Compose 会启动：

- `wenku8-web`：Web API、前端和下载任务服务
- `flaresolverr`：Cloudflare 浏览器验证服务，仅在 Docker 内网使用

FlareSolverr 不会向宿主机发布端口。Web 服务默认也只绑定到 `127.0.0.1`，请通过 Nginx、OpenResty、Caddy 等反向代理提供 HTTPS 访问。

### 1. 创建部署密钥

```bash
mkdir -p secrets
umask 077
openssl rand -base64 24 > secrets/admin_password.txt
openssl rand -hex 32 > secrets/app_secret.txt
```

- `admin_password.txt`：Web 管理员登录密码
- `app_secret.txt`：用于加密文库账号、Cookie 和代理凭据

这两个文件已被 `.gitignore` 和 `.dockerignore` 排除，请勿提交或分享。

### 2. 创建环境文件

```bash
cat > .env <<'EOF'
PUBLIC_ORIGIN=https://novel.example.com
WEB_PORT=3000
EOF
```

`PUBLIC_ORIGIN` 必须与浏览器实际访问的协议和域名完全一致。`WEB_PORT` 是宿主机回环地址上的监听端口。

### 3. 启动服务

```bash
docker compose up -d --build
docker compose ps
```

查看日志：

```bash
docker compose logs -f wenku8-web flaresolverr
```

更新并重新构建：

```bash
git pull
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

命名数据卷 `wenku8-data` 会保留加密配置、任务历史、下载缓存和生成文件。不要使用 `docker compose down -v`，除非确定需要删除全部数据。

### 4. 配置反向代理

Nginx 或 OpenResty 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

必须使用 HTTPS，并确保代理上游端口与 `.env` 中的 `WEB_PORT` 一致。禁用缓冲可以保证下载进度事件及时到达浏览器。

### 5. 登录

浏览器打开 `PUBLIC_ORIGIN` 对应的网址，管理员密码可从本地密钥文件查看：

```bash
cat secrets/admin_password.txt
```

登录管理界面后，再到「配置」页面填写轻小说文库账号。

## 安全设计

- 管理员会话 Cookie 使用 `HttpOnly`、`SameSite=Strict`，HTTPS 部署时启用 `Secure`
- 修改类 API 校验精确来源和 CSRF 请求头
- 文库账号、Cookie 和代理凭据使用 AES-256-GCM 加密保存
- 配置接口不会返回密码、Cookie 或代理认证信息
- Web 容器使用非 root 用户、只读根文件系统、能力删除和本地回环端口
- 图片和文库请求限制到明确允许的目标主机
- 下载文件使用任务专属路径，避免任务之间覆盖

Web 管理页面应保持私有，不建议直接暴露给不受信任的用户。

## 本地开发

安装依赖：

```bash
git clone https://github.com/mj3622/Wenku8Downloader.git
cd Wenku8Downloader
npm install
```

启动 Electron：

```bash
npm run dev
```

启动 Web 开发环境：

```bash
ADMIN_PASSWORD='local-admin-password' \
APP_SECRET='replace-with-at-least-32-characters' \
npm run dev:web
```

开发环境地址为 `http://127.0.0.1:5173`，Vite 会将 `/api` 请求转发到本地 Web 服务。

## 构建与验证

```bash
# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 确定性测试
npm test

# 需要真实文库网络和有效账号的集成测试
npm run test:integration

# Electron 构建
npm run build

# Web 和服务端构建
npm run build:docker

# 全部构建
npm run build:all
```

生成桌面安装包：

```bash
npm run dist:mac
npm run dist:win
```

## 常见问题

### 登录返回 HTTP 403

先点击「刷新 Cookie」。如果仍然失败，请启用可访问文库的代理。FlareSolverr 会自动使用同一代理出口完成浏览器验证。

### 下载速度较慢

Web 端会主动降低并发并加入请求间隔，以减少 Cloudflare 封禁和文库限流。完成的章节和图片会缓存，失败重试时不需要从头下载。

### 图片无法显示或下载

Web 端封面通过同源图片代理加载。下载器只接受文库及已知图片 CDN，并会过滤广告和追踪图片。若图片 CDN 再次变更，需要更新允许列表。

### FlareSolverr 健康但仍然访问失败

FlareSolverr 能处理浏览器挑战，但无法绕过目标站点对出口 IP 的明确封禁。请更换代理出口，并避免短时间重复刷新或同时创建多个大型下载任务。

### Web 页面可以打开，但任务进度不更新

确认反向代理已禁用响应缓冲，并将读取超时设置为较长时间。

## 许可证

[MIT](LICENSE)
