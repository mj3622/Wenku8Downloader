# 轻小说下载器

**Wenku8Downloader** 是基于 Python 和 [Streamlit](https://streamlit.io/) 构建的一款本地工具，提供基于Web的操作页面，用于下载 [轻小说文库](https://www.wenku8.net/) 的小说并保存为EPUB格式。

![search_page](./docs/pics/search_page.png)



# 基本功能
下载文件均存储在`/downloads`目录下
- ✅ 查询文库中的小说信息（支持按编号、书名、作者查询）
- ✅ 下载整本小说或分卷下载
- ✅ 单独下载小说插图
- ✅ 个性化下载配置
- ✅ **自动突破 Cloudflare 盾与 403 拦截（无需任何额外驱动，内置原生 TLS 指纹伪造）**
- ✅ **自带连接失败、网页限流 5 秒防刷等异常自愈与重挂机制**
- ⚠️ 暂不支持下载已下架小说



# 使用方法

本项目基于 `Python 3.9` 构建，请在使用前自行配置环境（无需额外配置 Playwright 或浏览器驱动）。

1. 将项目拉取到本地

   ```bash
   git clone https://github.com/mj3622/Wenku8Downloader.git
   cd Wenku8Downloader
   ```

2. 创建并激活虚拟环境

   ```bash
   # 创建
   python -m venv myenv
   
   # 激活
   myenv\Scripts\activate
   ```

3. 安装依赖

   ```bash
   pip install -r requirements.txt
   ```

4. 启动

   ```bash
   streamlit run app.py
   ```

   

**补充内容：**

为方便后续使用，可自行编写`start.bat`文件进行一键开启，此处给出参考示例

```bat
@echo off
:: 进入当前目录
cd /d %~dp0

:: 激活虚拟环境
call myenv\Scripts\activate

:: 运行 Streamlit 应用
streamlit run app.py

:: 保持命令行窗口开启
pause
```



# 常见问题

### 1. 下载或查询过程中频繁提示被拦截（界面报黄框/红框）

目前的底层请求由 `curl_cffi` 接管，在遭受 Cloudflare 的 100% 防御打击时，后台会自动休眠 5~8 秒并**自动更换一套全新的浏览器 TLS 指纹并重试（最高 3 次）**，通常你会在重试的第 2 次看到成功加载。如果你看到界面直接提示 403 并终止了：
1. 请进入全局「配置」页，将里面的 Cookie 留空并点击保存，重新获取。
2. 网站可能针对你的 IP 执行了长达分钟级的完全封禁，这种情况下请在 `config/secrets.toml` 端点**配置一个有效代理解决**。



### 2. 关于代理的配置相关问题？

项目不再硬性要求代理。如果在 `config/secrets.toml` 中留空（如 `http=""`），系统将会自动执行直连爬取。\n\n

### 3. 小说 查询/下载 失败（抛出 None 或者搜索不到）

请先检查该书是否为已下架小说，当前并未支持对下架小说的操作行为。或者当前网络完全阻断了文库站点的访问。



### 4. 分卷下载小说时封面异常

分卷下载时，默认以首张插图作为封面，可以自行在`基本-配置`页面进行修改。