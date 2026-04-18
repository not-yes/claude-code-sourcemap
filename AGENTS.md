# AGENTS.md

本文档为 AI 编程助手提供本项目的架构指引、开发惯例和关键实现细节。阅读者应对本项目一无所知，因此本文力求自包含、准确、可执行。

## 项目概述

本项目是 **Claude Code Desktop** —— 基于 Claude Code 源码构建的桌面端 AI 编程助手。它将原本纯终端的 Claude Code 扩展为三层架构的桌面应用：

1. **React 前端** (`frontend/`)：基于 React 19 + TypeScript + Tailwind CSS + shadcn/ui 的桌面 UI，运行在 Tauri 2.x WebView 中。
2. **Rust 后端** (`frontend/src-tauri/`)：Tauri 应用，负责窗口生命周期、多 Agent Sidecar 进程管理、JSON-RPC IPC 桥接、安全存储和系统原生能力。
3. **Bun Sidecar (Claude Code)** (`claude-code/`)：基于 Bun 运行的 TypeScript 运行时，实现核心 assistant/agent/工具逻辑。以 Sidecar 模式运行时通过 stdin/stdout 上的 JSON-RPC 2.0 与 Rust 后端通信；以 CLI 模式运行时可独立作为终端工具使用。

项目 Git 根目录：`/Users/wangke/Documents/Program/Claude`
当前核心源码目录：`claude-code/`（Bun Sidecar / CLI）

---

## 技术栈

### 前端 (`frontend/`)

- **框架**: React 19 + TypeScript
- **构建工具**: Vite
- **桌面容器**: Tauri 2.x (WebView)
- **样式**: Tailwind CSS + tailwind-merge + tailwindcss-animate
- **UI 组件**: shadcn/ui (基于 Radix UI 原语)
- **状态管理**: Zustand (`frontend/src/stores/`)
- **路由**: react-router-dom
- **Markdown 渲染**: react-markdown + remark-gfm
- **测试**: Vitest (`vitest.config.ts`)
- **包管理器**: pnpm (`pnpm-lock.yaml`)

### Rust 后端 (`frontend/src-tauri/`)

- **语言**: Rust (Edition 2021, rust-version >= 1.77.2)
- **异步运行时**: tokio
- **Tauri 版本**: 2.8.5
- **插件**: tauri-plugin-shell, tauri-plugin-store, tauri-plugin-dialog, tauri-plugin-fs, tauri-plugin-single-instance, tauri-plugin-log
- **职责**: 窗口管理、Sidecar 进程启停与监控、JSON-RPC 桥接、Tauri Event 推送、安全存储（macOS Keychain）、音频采集、语音识别（阿里云 ASR）

### Bun Sidecar (`claude-code/`)

- **运行时**: Bun (^1.3.11)
- **语言**: TypeScript (ESM, `"type": "module"`)
- **构建**: `bun scripts/build.ts`（CLI 产物） / `bun scripts/build-sidecar.ts`（原生可执行文件，跨平台）
- **校验**: Zod（JSON 结构校验）
- **测试**: `bun test`（测试覆盖度较低，目前仅少量测试文件）
- **包管理**: Bun workspaces（`packages/*`, `packages/@ant/*`）
- **代码检查**: ESLint (typescript-eslint + react-hooks + 自定义规则 `eslint-custom-rules.cjs`)
- **Git 钩子**: Husky + lint-staged + commitlint (conventional commits)

---

## 目录结构

```
claude-desktop/                    # Git 根目录
├── frontend/                      # React + Tauri 桌面前端
│   ├── src/                       # React 源码
│   │   ├── main.tsx               # React 入口
│   │   ├── App.tsx                # 根组件
│   │   ├── api/
│   │   │   └── tauri-api.ts       # ~43KB，前端与 Rust 的唯一集成点
│   │   ├── components/            # UI 组件与业务视图
│   │   ├── hooks/                 # 自定义 React Hooks
│   │   ├── stores/                # Zustand 状态仓库
│   │   └── types/                 # TypeScript 类型定义
│   ├── src-tauri/                 # Rust Tauri 后端
│   │   ├── src/
│   │   │   ├── main.rs            # Tauri 入口（仅调用 app_lib::run）
│   │   │   ├── lib.rs             # 命令注册、AgentManager 初始化、窗口事件
│   │   │   ├── agent/
│   │   │   │   ├── mod.rs         # AgentManager 定义
│   │   │   │   ├── ipc_bridge.rs  # JSON-RPC 协议处理与流式响应路由
│   │   │   │   ├── lifecycle.rs   # Sidecar 进程生命周期
│   │   │   │   └── process.rs     # 子进程启动与监控
│   │   │   ├── secure_storage.rs  # macOS Keychain / 安全存储
│   │   │   ├── audio_capture.rs   # 原生音频采集
│   │   │   └── sync.rs            # 配置同步
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── package.json               # pnpm 脚本与依赖
│   └── vitest.config.ts
│
├── claude-code/                   # Bun Sidecar / CLI 核心
│   ├── src/
│   │   ├── entrypoints/
│   │   │   ├── cli.tsx            # CLI 模式入口（含大量 fast-path 分支）
│   │   │   └── sdk/               # SDK 类型定义与 Schema
│   │   ├── main.tsx               # CLI 主逻辑（~254KB，Commander 命令树）
│   │   ├── sidecar/
│   │   │   ├── entry.ts           # Sidecar 模式入口（JSON-RPC Server）
│   │   │   ├── jsonRpcServer.ts   # JSON-RPC 2.0 Server 实现
│   │   │   ├── streamHandler.ts   # 流式事件处理与背压控制
│   │   │   ├── permissionBridge.ts# 权限桥接
│   │   │   ├── cronScheduler.ts   # Sidecar 内 Cron 调度器
│   │   │   ├── handlers/          # 各 JSON-RPC 方法处理器
│   │   │   │   ├── index.ts
│   │   │   │   ├── agentHandler.ts
│   │   │   │   ├── sessionHandler.ts
│   │   │   │   ├── checkpointHandler.ts
│   │   │   │   ├── mcpHandler.ts
│   │   │   │   ├── skillHandler.ts
│   │   │   │   └── cronHandler.ts
│   │   │   └── storage/           # Session/Checkpoint 持久化
│   │   ├── core/
│   │   │   ├── AgentCore.ts       # Agent 核心 (~54KB)
│   │   │   ├── PermissionEngine.ts# 权限引擎
│   │   │   ├── StateManager.ts    # 状态管理
│   │   │   ├── ToolRegistry.ts    # 工具注册表
│   │   │   └── types.ts           # 核心类型
│   │   ├── tools.ts               # 全局工具注册与组合（条件编译）
│   │   ├── tools/                 # 各工具实现目录
│   │   │   ├── BashTool/
│   │   │   ├── FileEditTool/
│   │   │   ├── FileReadTool/
│   │   │   ├── FileWriteTool/
│   │   │   ├── GlobTool/
│   │   │   ├── GrepTool/
│   │   │   ├── WebSearchTool/
│   │   │   ├── WebFetchTool/
│   │   │   ├── BrowserTool/
│   │   │   ├── MCPTool/
│   │   │   ├── TaskCreateTool/
│   │   │   ├── TodoWriteTool/
│   │   │   ├── ScheduleCronTool/  # Cron 创建/删除/列表
│   │   │   ├── SidecarCronTool/   # Sidecar 专用 Cron 工具
│   │   │   └── ... (40+ 工具)
│   │   ├── commands/              # 斜杠命令（100+ 个命令目录）
│   │   ├── services/              # API、MCP、LSP、遥测、OAuth 等
│   │   ├── assistant/             # Assistant 会话管理
│   │   ├── coordinator/           # 多 Agent 协调
│   │   ├── tasks/                 # 任务编排（DreamTask、LocalAgentTask 等）
│   │   ├── components/            # Ink CLI UI 组件
│   │   ├── utils/                 # 工具函数（git、bash、telemetry、settings 等）
│   │   ├── schemas/               # Zod Schema
│   │   └── types/                 # TypeScript 类型
│   ├── scripts/
│   │   ├── build.ts               # CLI 产物构建脚本
│   │   ├── build-sidecar.ts       # 跨平台 Sidecar 可执行文件编译
│   │   ├── config.ts              # 构建配置（feature flags、define、banner）
│   │   ├── dev.ts                 # 开发模式入口
│   │   └── debug.ts               # 调试模式入口
│   ├── packages/                  # Bun Workspace 子包
│   │   ├── audio-capture-napi/    # 音频采集 NAPI
│   │   ├── image-processor-napi/  # 图像处理 NAPI
│   │   ├── color-diff-napi/       # 颜色差异 NAPI
│   │   ├── modifiers-napi/        # 修饰符 NAPI
│   │   ├── url-handler-napi/      # URL 处理 NAPI
│   │   └── @ant/                  # 内部 @ant 包（computer-use 等）
│   ├── package.json
│   ├── tsconfig.json
│   ├── bunfig.toml
│   └── eslint.config.ts
│
├── docs/                          # 架构与实现文档
│   ├── desktop-implementation-plan.md   # 桌面端实现方案（中文）
│   ├── multi-sidecar-architecture.md    # 多 Sidecar 隔离架构（中文）
│   └── ...
│
└── AGENTS.md                      # 本文档
```

---

## 通信架构与数据流

### 请求路径（非流式与流式通用）

1. **React 前端** 调用 `frontend/src/api/tauri-api.ts` 中的函数。
2. `tauri-api.ts` 通过 `@tauri-apps/api` 的 `invoke` 调用 **Rust 后端** Tauri Command。
3. **Rust 后端** (`lib.rs` / `agent/`) 构造 JSON-RPC 2.0 请求，写入 Bun Sidecar 进程的 stdin。
4. **Bun Sidecar** (`claude-code/src/sidecar/`) 处理请求，执行工具/Agent 逻辑，通过 stdout 返回 JSON-RPC 响应或通知。
5. **Rust IPC Bridge** (`ipc_bridge.rs`) 解析 JSON-RPC 消息：
   - 对于请求-响应模式：解析 `result` / `error` 并 resolve 原始 Tauri Command。
   - 对于流式通知：映射为 Tauri Event，推送给前端。
6. **React 前端** 通过 `listen` 订阅 Tauri Event，更新 UI/状态。

### 流式路径

- Sidecar 通过 stdout 发送 JSON-RPC **Notification**（如 `$/stream`、`$/permissionRequest`）。
- Rust 收到后转换为 Tauri Event，事件名格式：`agent:{agentId}:stream:{streamId}`。
- 前端先注册 `listen` 监听器，再调用 `agent_execute`，避免竞态条件。
- 流结束时 Rust 发送 `agent:{agentId}:stream:{streamId}:done` 事件。

### Sidecar 就绪协议

Sidecar 启动后向 stdout 发送首个 JSON-RPC Notification：

```json
{
  "jsonrpc": "2.0",
  "method": "$/ready",
  "params": {
    "version": "1.0.0",
    "cwd": "...",
    "permissionMode": "interactive",
    "hasApiKey": true,
    "configErrors": [],
    "configWarnings": []
  }
}
```

Rust 端等待此信号确认 Sidecar 初始化完成。

---

## 构建与开发命令

### 前端 + Tauri

在 `frontend/` 目录下执行：

```bash
# 启动 Vite 开发服务器（不启动 Tauri）
pnpm dev

# 构建前端生产包
pnpm build

# 运行测试
pnpm test

# 构建 Sidecar（自动检测当前平台）并启动 Tauri 开发模式
pnpm tauri:dev

# 构建 Sidecar（所有平台）并打包 Tauri 应用
pnpm tauri:build:all
```

### Bun Sidecar / CLI

在 `claude-code/` 目录下执行：

```bash
# 开发模式（直接运行 CLI，带动态编译宏）
bun run dev

# 调试模式
bun run debug

# 类型检查
bun run typecheck

# 构建 CLI 产物（dist/cli.js）
bun run build

# 构建 Sidecar 可执行文件（当前平台）
bun run build:sidecar

# 构建 Sidecar（所有平台：darwin-arm64/x64, linux-x64, windows-x64）
bun run build:sidecar:all

# 运行测试
bun run test

# 代码检查
bun run lint
bun run lint:fix
```

---

## 关键开发惯例

### 1. 三层隔离原则

- **前端** 不得直接访问文件系统、网络或 spawn 进程；一切通过 Tauri IPC → Rust → Sidecar。
- **Rust** 负责进程管理、IPC、安全存储、系统原生能力（音频、Keychain）。
- **Bun Sidecar** 负责核心 AI 逻辑、工具执行、会话状态、Agent 协调。

### 2. Bun Feature Flags（编译时条件）

`claude-code/scripts/config.ts` 中定义了 `features` 数组和 `defines` 对象。构建时通过 `bun:bundle` 的 `feature()` 宏实现死代码消除（Dead Code Elimination）。

当前 Sidecar 构建启用的特性：
- `AGENT_TRIGGERS`：启用 Cron 相关工具（ScheduleCronTool、SidecarCronTool）

新增功能时，若需编译时开关：
1. 在 `scripts/config.ts` 的 `features` 数组中添加 flag。
2. 在代码中使用 `feature('FLAG_NAME')` 做条件分支。
3. 确保 Sidecar 构建时通过 `--feature=FLAG_NAME` 启用。

### 3. 双模式兼容（CLI vs Sidecar）

同一套 TypeScript 源码同时支持两种运行模式：

- **CLI 模式**：入口 `src/entrypoints/cli.tsx` → `src/main.tsx`，使用 Ink 渲染终端 UI。
- **Sidecar 模式**：入口 `src/sidecar/entry.ts`，无 Ink/React 依赖，通过 JSON-RPC 通信。

模式切换通过构建时 `--define 'process.env.SIDECAR_MODE="true"'` 实现。
新增功能时需考虑是否应在两种模式下均可用，或通过 `process.env.SIDECAR_MODE` / `feature()` 做条件隔离。

### 4. 工具实现模式

`claude-code/src/tools/` 下每个工具通常包含：

- `ToolName.ts` — 主工具实现（继承 Tool 基类）
- `UI.tsx` — Ink CLI UI 组件（CLI 模式使用）
- `prompt.ts` — 工具描述与 prompt 片段
- `constants.ts` — 工具名与常量

工具在 `src/tools.ts` 中集中注册。注意 `tools.ts` 中大量使用条件 `require()` 以打破循环依赖并支持编译时 DCE。

### 5. JSON-RPC 契约同步

新增 JSON-RPC 方法时必须三端同步：
1. **Bun Sidecar**：在 `src/sidecar/handlers/` 中实现 handler，并在 `jsonRpcServer.ts` 注册。
2. **Rust**：在 `agent/ipc_bridge.rs` 中处理消息路由，在 `lib.rs` 中暴露对应的 Tauri Command（如需要）。
3. **前端**：在 `frontend/src/api/tauri-api.ts` 中新增调用函数，更新类型定义。

---

## 代码风格与检查

### ESLint 配置 (`claude-code/eslint.config.ts`)

- 使用 `typescript-eslint` 的推荐配置。
- 启用 `react-hooks/rules-of-hooks`（error）和 `react-hooks/exhaustive-deps`（warn）。
- 自定义规则插件：`eslint-custom-rules.cjs`。
- 忽略 `dist/`, `node_modules/`, `packages/`, `eslint-custom-rules.cjs`。
- `@typescript-eslint/no-explicit-any`: warn
- `@typescript-eslint/no-unused-vars`: warn（允许 `_` 前缀参数）

### TypeScript 配置 (`claude-code/tsconfig.json`)

- `target`: ESNext, `module`: ESNext, `moduleResolution`: bundler
- `strict`: true, `noImplicitAny`: true
- `noEmit`: true（仅类型检查，由 Bun 负责编译/打包）
- `allowImportingTsExtensions`: true
- Path mapping: `src/*` → `./src/*`, `@/*` → `./*`

### Git 提交规范

- 使用 **Conventional Commits**（由 `@commitlint/config-conventional` 校验）。
- Husky `pre-commit` 钩子目前为空壳；`lint-staged` 配置在 `package.json` 中：
  - `*.{ts,tsx}` → `eslint --fix --quiet`

---

## 测试策略

> ⚠️ 当前测试覆盖度较低，以手动集成测试和类型检查为主。

- **Bun Sidecar**: `bun test`（Bun 内置测试运行器）。目前源码中仅有极少量 `.test.ts` 文件（如 `src/native-ts/color-diff/index.test.ts`）。
- **前端**: `pnpm test`（Vitest）。
- **Rust**: 未观察到显式测试目录，以编译期检查和集成测试为主。

开发新功能时，优先通过 `bun run typecheck` 和 `bun run lint` 保证基础质量；关键工具/Handler 建议补充单元测试。

---

## 安全注意事项

### 1. 认证与密钥管理

- **API Key / Auth Token**：Sidecar 从 `~/.claude/settings.json` 的 `env` 字段读取 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`。
- **前端不直接持有密钥**：Rust 后端通过 `secure_storage.rs` 与 macOS Keychain 交互；前端仅调用 Tauri Command 进行存取。
- **Sidecar 凭证隔离**：`sidecar/entry.ts` 设置 `process.env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'`，使 `auth.ts` 等模块识别为桌面模式，避免回退到 macOS Keychain 触发额外弹窗。

### 2. 权限模式

Sidecar 支持四种权限模式（`SIDECAR_PERMISSION_MODE`）：
- `auto-approve`：自动批准所有工具调用（危险，仅受信任环境使用）。
- `interactive`：每次工具调用请求用户确认（默认）。
- `plan-only`：仅生成计划，不执行工具。
- `deny-all`：拒绝所有工具调用。

权限请求通过 JSON-RPC 从 Sidecar → Rust → 前端弹窗 → 用户决策 → Rust → Sidecar 回传。

### 3. Sidecar 进程安全

- Rust 通过 `agent/process.rs` 启动 Sidecar，设置 `CLAUDE_CODE_USE_NATIVE_FILE_SEARCH=true` 避免嵌入的 ripgrep 在编译二进制中失效。
- Sidecar 监听 `SIGTERM`/`SIGINT`/`stdin close` 实现优雅关闭，保存会话成本数据后退出。
- 内存监控：Sidecar 每 60 秒记录内存；RSS > 4GB 时主动退出，触发宿主重启。

### 4. 配置安全

- 配置文件路径：`~/.claude-desktop/config.toml`、`~/.claude-desktop/exec-approvals.json`。
- Rust 端提供 `get_claude_config` / `save_claude_config` Tauri Command 进行受控读写。

---

## 典型修改场景

### 场景 A：新增一个 JSON-RPC 方法（端到端）

1. **Bun Sidecar**：
   - 在 `claude-code/src/sidecar/handlers/` 新增 handler 文件。
   - 在 `claude-code/src/sidecar/jsonRpcServer.ts` 注册方法名与 handler。
   - 使用 Zod 校验参数（如有必要）。

2. **Rust**：
   - 若需要前端直接调用，在 `frontend/src-tauri/src/lib.rs` 新增 `#[tauri::command]` 函数。
   - 在 `run()` 的 `generate_handler!` 宏中注册新命令。
   - 在 `agent/ipc_bridge.rs` 中确保消息路由正确（通常无需修改，通用路由已覆盖）。

3. **前端**：
   - 在 `frontend/src/api/tauri-api.ts` 新增调用函数。
   - 在 `frontend/src/types/` 补充类型定义。
   - 在组件或 store 中调用并处理结果/事件。

### 场景 B：新增或修改工具

- 修改 `claude-code/src/tools/目标工具/` 目录下的实现文件。
- 若新增工具，在 `claude-code/src/tools.ts` 中导入并注册。
- 注意：工具在 CLI 和 Sidecar 两种模式下通常都可用；若行为需要区分，使用 `process.env.SIDECAR_MODE` 或环境变量做条件判断。
- 若工具涉及文件系统或命令执行，确保遵循 `PermissionEngine` 的权限检查逻辑。

### 场景 C：前端 UI 修改

- 修改 `frontend/src/components/` 或 `frontend/src/hooks/`。
- 若需要新的后端数据，**不要**直接 fetch API；先扩展 `frontend/src/api/tauri-api.ts` 中的 IPC 调用。
- 全局状态优先使用 `frontend/src/stores/` 中的 Zustand store。

---

## 注意事项与常见陷阱

1. **不要绕过 Tauri IPC**：前端代码禁止直接 spawn 进程或访问文件系统/网络。
2. **保持 JSON-RPC 契约同步**：方法名、参数结构、payload 字段的变更必须同时反映到 Bun、Rust、前端三端。
3. **Sidecar 生命周期关键**：修改 `sidecar/entry.ts`、`jsonRpcServer.ts`、Rust `agent/` 模块时保持向后兼容；`$/ready` 信号和事件命名空间是前端依赖的稳定契约。
4. **流式事件竞态**：前端必须先 `listen` 再 `invoke agent_execute`。`tauri-api.ts` 中已实现此模式，新增流式调用时请遵循。
5. **Feature Flag 与 DCE**：`feature()` 和 `process.env.SIDECAR_MODE` 的判断在构建时可能被 Bun 死代码消除，因此这些条件分支不能依赖于运行时动态计算的值（除非通过环境变量注入）。
6. **宏定义垫片**：Sidecar 编译时 `MACRO.*` 宏在 `sidecar/entry.ts` 中有垫片定义；CLI 构建时由 `scripts/config.ts` 提供真实值。若新增宏，需同时更新垫片。
7. **循环依赖**：`tools.ts` 中大量使用 `require()` 而非顶层 `import` 来打破循环依赖（如 TeamCreateTool/TeamDeleteTool/SendMessageTool）。新增工具时注意导入顺序。

---

## 参考文档

- `docs/desktop-implementation-plan.md` — 桌面端三层架构与 Sidecar 实现细节
- `docs/multi-sidecar-architecture.md` — 多 Agent Sidecar 隔离与生命周期设计
- `docs/feature-flags.md` — Bun Feature Flags 完整清单与功能说明
- `docs/environment-variables.md` — 环境变量参考（认证、功能开关、调试）
- `claude-code/docs/environment-variables.md` — Sidecar 环境变量详解
- `claude-code/docs/feature-flags.md` — Sidecar Feature Flags 分析

---

*本文档基于实际代码结构与配置生成。若项目结构发生重大变化，请及时更新本文件。*
