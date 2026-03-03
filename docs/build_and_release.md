# 项目打包与发版指南

为了方便社区用户在不同的操作系统上免除配置 Python、安装浏览器等繁琐前置条件，本项目内建了一套**完全独立的便携版（绿色版）应用打包系统**。

此系统能在任意支持的操作系统上，自动化生成自带 Python 与内置版本 Chromium 浏览器的 Zip 压缩包，方便全球用户开箱即用。

---

## 一、方案概述

该套自动化系统主要由位于本目录外 `tools/build_release.py` 的自主打包引擎与位于 `.github/workflows/build-release.yml` 的云端 CI/CD 发版工作流协同构成。

### 它解决了什么痛点？
* **隔离依赖危机**：依赖树无需污染用户的全局 Python 环境。系统将按平台单独抓取官方独立发行的 CPython Standalone 便携版嵌入根目录。
* **摆脱浏览器要求**：集成了 Playwright 引擎进行初始化提取，自动将 Chromium 内核无头浏览器封装进 `bin/browsers` 目录随安装包一起分发，告别环境缺失报错。
* **原生跨平台兼容**：在 Windows、macOS(ARM & Intel)、Linux 三端均已测试，各自平台均可利用云打包服务器原生构建。

---

## 二、开发者与贡献者：如何在本地手工打包？

如果您希望在您的开发电脑上测试修改后的打包成果，或为特定的局域网用户手动发布定制的安装包，可以通过运行下述命令在本地执行打包逻辑。

### 1. 前置要求
* 拥有任意版本的 Python 3 (推荐 > 3.9)。
* 执行命令时位于项目的**根目录**。
* 网络良好（脚本需实时拉取约 200MB 的 Chromium 与独立 Python 包）。

### 2. 执行指令

运行以下命令，即可针对您当前的系统架构进行打包：

```bash
# 通常情况，它会自动识别您的平台（Windows/macOS）并执行对应的构建打包逻辑
python tools/build_release.py

# 您也可以强制为其指定参数（用于跨平台抓包测试，但不保证原生依赖二进制库完全兼容）
python tools/build_release.py windows
python tools/build_release.py macos
```

### 3. 生成产物位置
当控制台提示 `Done!` 后，所有生成资源文件会被自动转移至项目根目录的 `release/` 文件夹内：
* 打包完的便携解压包将形如 `Wenku8Downloader-Windows.zip` 位于该目录下。
* `release/` 以及内部中间产物**已添加至 `.gitignore` 黑名单中**，您完全不用担心不小心将其 Push 至代码仓库造成拥堵。

---

## 三、作为发版者：如何在 GitHub 全自动触发打包与 Release 发布？

**本项目采用了 Github Actions 自动化架构。除非您出于深度定制目的，强烈建议您永远不要在个人电脑上手动打包。**

当您的代码开发告一段落，希望发布一个正式的更新（例如版本 `v1.2.0`）给全网用户体验时，请依照如下步骤操作：

**1. 正常提交并 Push 您最后的工作.**

**2. 在 Git 打上带有版本号的标签 (Tag)**，注意标签名**必须**是以小写字母 `v` 开头：

```bash
git tag v1.2.0
git push origin v1.2.0
```

或者，您也可以直接在 GitHub 项目网页版右上角的 **Releases -> Draft a new release** 中创建并发布这个 Tag（比如命名为 `v1.2.0`）。

**3. 去喝杯咖啡 ☕**
当包含 `v*` 标准格式的 Tag 被推送到云端那一刻，GitHub Actions 服务器就会被自动唤醒：
1. 它会在后台并发出动 Ubuntu、macOS、Windows 三台虚拟主机机器。
2. 它们将同步独立执行 `build_release.py` 操作。
3. 约 2~4 分钟后，三端的 `Wenku8Downloader-***.zip` 完全免安装打包体将被自动上传至您刚刚创建发布的 `v1.2.0` Release 页面附件中。

普通用户只需去您的网页 Release 下载这些附件双击运行即可。
