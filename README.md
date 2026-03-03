# 轻小说下载器

**Wenku8Downloader** 是基于 Python 和 [Streamlit](https://streamlit.io/) 构建的一款本地工具，提供基于 Web 的操作页面，用于下载 [轻小说文库](https://www.wenku8.net/) 的小说并保存为 EPUB 格式。

![search_page](./docs/pics/search_page.png)

## 基本功能

下载文件均默认存储在 `/downloads` 目录下：

- ✅ 查询文库中的小说信息（支持按编号、书名、作者查询），展示详尽的书籍封面、状态与简介
- ✅ 下载整本小说或分卷下载
- ✅ 单独下载小说插图
- ✅ 个性化下载配置
- ✅ **自动突破 Cloudflare 盾与 403 拦截**（内置使用 `DrissionPage` 自动拉起浏览器获取真实 Cookie 等机制）
- ✅ **自带异常自愈与重试机制**（包含连接失败、网页限流 5 秒防刷等处理）
- ⚠️ 暂不支持下载已下架小说

## 使用方法

本项目基于 `Python 3.9` 构建，请在使用前自行配置环境。最新版本已引入基于 `DrissionPage` 的浏览器自动化以绕过验证拦截，请确保本机已安装 Chrome 浏览器。

1. **将项目拉取到本地**

   ```bash
   git clone https://github.com/mj3622/Wenku8Downloader.git
   cd Wenku8Downloader
   ```

2. **创建并激活虚拟环境**

   ```bash
   # 创建
   python -m venv myenv
   
   # 激活 (Windows)
   myenv\Scripts\activate
   
   # 激活 (macOS/Linux)
   source myenv/bin/activate
   ```

3. **安装依赖**

   ```bash
   pip install -r requirements.txt
   ```

4. **配置应用（可选）**

   系统首次启动时会自动基于模板生成 `config/secrets.toml` 配置文件。
   你可以直接在应用内置的 Web 端「配置」页面中设定各项参数（如代理、登录账号、Cookie 及默认封面等），无需手动复制或修改配置文件。如不配置，系统将以默认设定直连运行。

5. **启动应用**

   ```bash
   streamlit run app.py
   ```

**补充说明（全自动免配置便携版）：**

项目最新版本已支持跨平台全自动便携打包发行。如果你不想在本地手动配置上述 Python 环境并解决复杂的依赖问题，你可以直接前往本项目 GitHub Releases 页面，下载对应平台的独立压缩包（如 `Wenku8Downloader-Windows.zip` 或 `.macOS.zip`）。

解压后双击其中的 `start.bat`（Windows）或 `start.command`（macOS）即可开箱直接启动——内部已自带所有 Python 运行环境以及绕过防刷验证所需的独立 Chromium 浏览器，**完全无需其余前置安装要求**。详情可参阅代码仓库内的 `docs/build_and_release.md` 发版说明。

## 常见问题

### 1. 频繁提示被拦截或抛出 403 错误

目前的底层请求由 `curl_cffi` 配合 `requests` 等接管。对于 Cloudflare 的强拦截，当前版本已升级为通过 `DrissionPage` 自动拉起后台浏览器访问页面，以真实用户身份通过人机验证并获取 `cf_clearance` 及其它重要 Cookie，有效解决传统的 403 错误。
1. 请进入 Web 端的全局「配置」页，点击「获取/更新 Cookie」按钮。后台会自动启动无头 Chrome 浏览器进行自动化登录和获取 Cookie，并随后自动应用到配置中。
2. 网站可能针对你的 IP 执行了长达分钟级的完全封禁，这种情况下请在 `config/secrets.toml` 的 `[proxy]` 节点配置有效代理。
3. 如果自动获取持续失败，你也可以按照页面提示手动提取浏览器内的 Cookie。

### 2. 代理的配置问题

项目不再硬性要求配置代理。如果在 `config/secrets.toml` 中留空（如 `http=""`），系统将会自动使用直连网络进行爬取。

**macOS 用户代理注意事项**：
如果在 macOS 环境下配置并启用了代理，控制台频繁弹出以下警告：
`NotOpenSSLWarning: urllib3 v2 only supports OpenSSL ... compiled with 'LibreSSL 2.8.3'`
这是由于 macOS 自带环境编译构建的 Python 加密库与 `urllib3` v2.x 版本之间存在兼容性问题。这通常只会作为警告输出，但这期间所有基于底层库的代理请求可能会异常出错。
**解决方法**：进入虚拟环境后，执行命令降级 urllib3 即可完美解决：
```bash
pip install "urllib3<2"
```

### 3. 小说查询或下载失败

请先检查该书是否为已下架小说，当前暂不支持对下架小说的下载操作。若仍有问题，可能是当前网络完全阻断了该文库站点的访问。

### 4. 分卷下载时封面异常

分卷下载时，默认首张插图作为当卷的封面。你可以在 Web 端的「基本-配置」页面中进行修改，或设置 `config/secrets.toml` 中的 `default_cover_index` 选项以调整默认行为。