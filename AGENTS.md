# AGENTS.md

## 适用范围

- 本文件适用于整个仓库。子目录可以用更具体的 `AGENTS.md` 补充模块约束，但不得放宽安全、数据和兼容性要求。
- 本文件只约束仓库产出、架构边界、质量门槛和协作流程；个人开发工具与工作方式由贡献者自行选择。
- 代码、配置、脚本和现有测试是事实来源。约束与实现不一致时，先核对真实调用链，再按任务范围修正。
- 目标是以简单、稳定、可维护的方式完成需求，优先最小改动，避免无关重构和过早抽象。

## 项目边界

- 项目使用 Electron、TypeScript、React、Zustand、Tailwind 和 Vitest。
- `src/main` 是特权主进程，负责文件、网络、配置、下载和系统能力。
- `src/preload` 是最小桥接层；`src/renderer` 是不可信 UI；`src/shared` 保存跨进程契约。
- 开始修改前应追踪与任务相关的入口、调用者、被调用者和副作用。可自由选择代码导航工具，但复杂跨模块改动不能只检查单个文件。

## 修改原则

- 只修改任务直接涉及的代码，保留现有命名、分层、接口和错误处理风格，不覆盖贡献者的无关改动。
- 优先复用现有组件、校验器、存储层、日志接口和测试工具；新增依赖必须有明确必要性。
- 不得顺手升级依赖、调整目录结构、格式化全仓库或改变无关行为。
- 不直接编辑 `out/`、`release/`、`node_modules/`、`.dev-user-data/`、`config/`、`downloads/` 和日志目录等生成物或本地运行数据。
- 真实或可用的密钥、Token、密码、Cookie、Authorization、签名和加密载荷不得进入代码、日志、fixture、快照、文档或 Git 历史。
- Bug 修复应在可行时增加回归测试。任何测试、构建或功能结论都必须有实际验证证据。

## 架构与安全约束

### Electron 与 IPC

- 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- `preload` 只暴露具名、类型化、最小能力；不暴露原始 `ipcRenderer`、任意频道调用或通用文件系统接口。
- renderer 输入一律视为不可信。主进程负责类型、长度、枚举、URL 和路径校验，不能只依赖前端校验或 TypeScript 类型。
- 文件路径、日志目录和可打开目标由主进程解析，不接受 renderer 控制的任意绝对路径或日志文件。
- 修改跨进程接口时，同步更新 `src/shared` 类型、preload 暴露、主进程处理器及两侧测试。
- 保持外部导航和新窗口默认拒绝；开放外链时沿用主进程的协议与目标校验。

### 配置与敏感数据

- 普通设置存放在 `settings.toml`；账号、密码和 Cookie 只能经 Electron `safeStorage` 加密后写入 `secrets.enc`，不得恢复明文凭证文件。
- 配置写入保持原子写入、写后校验和失败回滚；损坏文件应保留或备份，不得静默覆盖。
- 保留配置迁移、未知字段和“更高版本只读”语义。修改配置结构时同步更新版本、迁移、校验、序列化和测试。
- 开发环境与打包环境的数据目录保持分离，不把真实用户配置写入仓库。
- 默认值由配置 schema 的既有常量统一定义，不在主进程、preload 和 UI 重复硬编码。

### 下载、网络与文件

- 外部名称进入文件名之前使用 `safePathSegment` 等既有清理；派生路径通过 `resolveWithin` 约束在预期根目录内。
- 保持书籍键、卷键、缓存结构、输出命名和旧缓存迁移兼容性；改变持久化结构时必须提供迁移与回归覆盖。
- 调整请求间隔、并发、重试、限流、Cookie 同步或缓存时效时，需要测量依据和相应测试。
- 自动化测试不得访问真实 Wenku8 或其他外部服务；使用 mock、fixture 和临时目录隔离网络、时间与文件系统副作用。
- 不把完整响应体、原始请求头、HTML、图片、EPUB 或大 Buffer 写入日志。

### 日志

- 日志只保存在本地，不上传。初始化、格式化、轮转、清理或 renderer 上报失败必须被隔离，不能影响应用启动、下载或主进程执行。
- 普通日志按天写入 `app-*.log`；错误同时写入 `app-*.log` 和 `error-*.log`。轮转、保留天数、单文件上限和目录总上限由日志配置控制。
- 所有消息、错误、URL 和上下文在落盘或 stderr fallback 前经过 `src/main/logging/redaction.ts`。
- 可以记录有助于排查的安全请求参数、方法、状态、耗时、路径和堆栈；不得记录密码、Cookie、Token、Authorization、签名、密钥、加密内容、原始 headers/body 或逐项高频进度。
- renderer 错误上报保持有界、可校验和防刷屏，由主进程统一脱敏和写入，renderer 不得控制日志文件或注入多行记录。
- `DEFAULT_LOG_CONFIG` 是日志默认值唯一来源。未经明确需求，不改变保留 30 天、单文件 100 MB、目录总上限 200 MB 的当前默认策略。

### Renderer

- 复用现有 React、Zustand 和 Tailwind 方案；局部功能不引入新的状态管理或 UI 框架。
- 用户可见的异步操作应覆盖 loading、error 和 empty 状态；组件卸载时清理 IPC 监听器。
- 外部 HTML 不直接注入 DOM；外链和本地文件操作经 preload 的受限接口进入主进程。

## 测试与验证

- 新测试文件放在被测模块最近的 `tests/` 子目录，命名为 `*.test.ts` 或 `*.test.tsx`。修改旧测试时可保持原位置，不为统一目录批量迁移无关测试。
- 单元测试应确定性、离线、可并行；文件测试使用临时目录并清理，时间相关逻辑使用可控时钟。
- 新增独立集成测试时同步维护 `tooling/vitest.integration.config.ts`，并确保不访问真实网络。
- 安全边界改动至少覆盖正常输入、非法输入、敏感信息脱敏和底层失败不影响主流程。
- 文档修改检查内容、链接、差异和 `git diff --check`，无需运行代码测试。
- 局部 TypeScript 修改运行相关 Vitest 测试，并按影响范围运行 node 或 web typecheck。
- IPC、配置、日志、下载、preload、共享类型或构建配置等跨模块改动，最终运行：
  - `npm test`
  - `npm run test:integration`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run build`
  - `git diff --check`
- 可见 Electron 行为变更应在环境允许时进行 smoke test；无法运行时如实说明，不以构建通过替代 UI 验证。
- 只有发布任务才运行 `dist:*`。

## 文档维护

- 使用方式、公开接口或长期架构约束变化时，更新对应持久文档。
- `README.md` 只在安装、配置、使用方式或项目入口信息实际变化时修改，不把 README 更新作为每个任务的固定步骤。
- Superpowers 产出的设计稿、实施计划和完成清单均为单次任务的临时产物，不得加入 Git 或随 Pull Request 提交；任务完成前必须从仓库工作区删除。仍有效的 ADR、用户文档和接口文档继续保留。

## Git 协作流程

### 长期分支

- 当前稳定主分支为 `master`：只保存经过发布验证、可交付的版本。
- `dev` 是下一版本的长期集成分支：保存已经审核、尚未发布的开发成果。
- 仓库管理员负责从选定的最新 `master` 基线创建并维护 `dev`。如果远程尚无 `dev`，贡献者先联系管理员，不各自创建同名集成分支。
- `master` 和 `dev` 都应设置分支保护：通过 Pull Request 合并，要求已配置的检查通过，禁止直接推送、强制推送和删除。
- 项目采用上述双长期分支模型，不混用“从 `master` 创建普通功能分支、再合入 `dev`”的流程。

### 工作分支

- 普通功能、修复、重构、测试、文档和维护工作都从规范仓库最新的 `dev` 创建短期分支，完成后通过 Pull Request 合入 `dev`；使用 fork 时，规范仓库的远程名可能是 `upstream` 而不是 `origin`。
- 分支名使用小写英文 kebab-case，格式如下：
  - `feature/<short-description>`：新功能，例如 `feature/log-retention-settings`
  - `fix/<short-description>`：普通缺陷修复，例如 `fix/renderer-error-reporting`
  - `refactor/<short-description>`：不改变行为的重构
  - `test/<short-description>`：测试改动
  - `docs/<short-description>`：文档改动
  - `chore/<short-description>`：依赖、工具或仓库维护
- 一个分支只承载一个逻辑任务，保持短期存在；合并确认完成后删除工作分支。
- 合并前将工作分支更新到最新 `dev`，解决冲突并重新运行受影响检查。个人分支可 rebase，共享分支优先 merge，避免改写他人历史。

### Pull Request 与发布

- 工作分支的 Pull Request 以 `dev` 为目标，包含变更目的、范围、验证结果、兼容性影响和已知风险。
- Pull Request 通过审核及必要检查后，由具备权限的维护者合入 `dev`；具体使用 merge、squash 或 rebase merge 由仓库合并策略决定。
- 仓库管理员定期从 `dev` 向 `master` 创建发布 Pull Request。发布前执行完整验证、检查发布差异；合并后按版本策略创建 tag。
- 需要独立稳定发布候选时，可从 `dev` 创建 `release/<version>`，只接受发布修复，最终由仓库管理员合入 `master`，并把发布分支中的额外修复同步回 `dev`。
- 线上稳定版本的紧急修复从最新 `master` 创建 `hotfix/<short-description>`，审核后合入 `master`，随后立即把同一修复同步到 `dev`，避免下次发布回归。
- `master` 上的任何发布修正或 hotfix 都必须回流 `dev`；普通工作分支不得直接合入 `master`。

### 提交质量

- 每个提交只表达一个可独立理解和回退的逻辑变更，不混合无关格式化、重构和功能修改。
- Commit Message 使用中文 Conventional Commits：`<type>(english-scope): 中文描述`。
- 提交或 Pull Request 不包含凭证、运行数据、构建产物、临时调试内容和任务外改动。
- 合并前检查 staged、unstaged 和 untracked 文件，并记录实际运行的验证及未运行原因。
