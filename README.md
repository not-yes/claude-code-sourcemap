# Claude Code Desktop

基于 `@anthropic-ai/claude-code` npm 包还原源码改造的桌面端 AI 编程助手。

## 项目简介

本项目采用**前端自开发 + 后端基于 claude-code 源码优化**的架构模式，在保留 Claude Code 强大能力的基础上，提供更友好的桌面端交互体验。

核心特性：
- 🖥️ **桌面原生体验**：基于 Tauri 2.x 的跨平台桌面应用
- 🔄 **会话管理**：完整的历史记录与回滚机制
- 🤖 **多智能体系统**：内置 Agents 协作能力
- 🔐 **权限控制**：细粒度的操作权限管理
- 📦 **技能扩展**：可插拔的 Skills 系统
- ⏰ **定时任务**：Cron 任务调度支持

## 架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    React 前端                           │
│            (frontend/src/components/)                   │
└─────────────────────┬───────────────────────────────────┘
                      │ Tauri invoke
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   Rust 后端                             │
│        (frontend/src-tauri/src/ipc/)                    │
│         进程管理 │ IPC 桥接 │ 事件推送                   │
└─────────────────────┬───────────────────────────────────┘
                      │ JSON-RPC 2.0 (stdin/stdout)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Bun Sidecar                            │
│              (claude-code/src/)                         │
│         Claude Code TS 核心引擎                         │
└─────────────────────────────────────────────────────────┘
```

### 通信链路

- **请求链路**：React 前端 → Tauri invoke → Rust 后端 → JSON-RPC → Bun Sidecar
- **流式输出**：Bun Sidecar → stdout notification → Rust IPC Bridge → Tauri EventEmitter → React 前端

## 技术栈

| 层级 | 技术选型 |
|------|----------|
| 桌面框架 | Tauri 2.x |
| 前端 | React 19 + TypeScript + Tailwind CSS + shadcn/ui + Zustand |
| 后端 | Rust (tokio 异步运行时) |
| 核心引擎 | Claude Code TypeScript (Bun Sidecar) |
| 打包工具 | Bun build --compile |
| IPC 协议 | JSON-RPC 2.0 |

## 目录结构

```
Claude/
├── claude-code/              # Claude Code TS 源码（基于还原版改造）
│   ├── src/
│   │   ├── commands/         # CLI 子命令
│   │   ├── components/       # Ink UI 组件
│   │   ├── hooks/            # React Hooks
│   │   ├── services/         # 服务层 (API、MCP、LSP 等)
│   │   ├── tools/            # 58+ 工具实现
│   │   ├── sidecar/          # Sidecar 模式相关代码
│   │   ├── coordinator/      # 多 Agent 协调模式
│   │   ├── assistant/        # 助手模式 (KAIROS)
│   │   ├── buddy/            # AI 伴侣 UI
│   │   ├── remote/           # 远程会话
│   │   ├── plugins/          # 插件系统
│   │   ├── skills/           # 技能系统
│   │   ├── voice/            # 语音交互
│   │   └── vim/              # Vim 模式
│   ├── packages/             # 本地依赖包
│   └── package.json
├── frontend/                 # Tauri 桌面端
│   ├── src/
│   │   ├── api/              # Tauri API 层
│   │   ├── components/       # UI 组件
│   │   ├── hooks/            # React Hooks
│   │   ├── stores/           # Zustand 状态管理
│   │   ├── lib/              # 工具库
│   │   └── types/            # TypeScript 类型定义
│   ├── src-tauri/            # Rust 后端
│   │   ├── src/
│   │   │   ├── ipc/          # IPC Bridge
│   │   │   └── ...
│   │   └── tauri.conf.json
│   └── package.json
├── docs/                     # 项目文档
├── package/                  # SDK 打包输出
└── AGENTS.md                 # AI Agent 开发指南
```

## 双模式运行

项目支持两种运行模式，通过构建时配置切换：

### CLI 模式
- 用途：开发调试
- 特点：保留完整 CLI 交互能力
- 启动方式：直接运行 Bun 进程

### Sidecar 模式
- 用途：桌面端打包
- 特点：移除 CLI 层，仅保留核心引擎
- 实现原理：通过 `bun build --define` 注入标识，利用 dead code elimination 移除 CLI 相关代码

```typescript
// 构建时注入
bun build --define="process.env.SIDECAR_MODE=true" ...
```

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- Bun >= 1.3
- Rust (latest stable)
- Tauri CLI 2.x

### 安装依赖

```bash
# 安装 claude-code 依赖
cd claude-code
bun install

# 安装前端依赖
cd ../frontend
npm install
```

### 开发命令

**Claude Code 核心 (claude-code/)**
```bash
bun run dev          # 开发模式
bun run debug        # 调试模式
bun run build        # 构建
bun run build:ant    # 构建 (ANT 版本)
bun run lint         # 代码检查
bun run test         # 运行测试
```

**Tauri 桌面端 (frontend/)**
```bash
npm run dev          # 启动 Vite 开发服务器
npm run tauri dev    # 启动 Tauri 开发模式
npm run build        # 构建前端
npm run tauri build  # 构建桌面应用
npm run test         # 运行测试
```

### 构建发布

```bash
# TODO: 待补充完整的构建发布流程
```

## 相关文档

- [AGENTS.md](./AGENTS.md) - AI Agent 开发指南
- [docs/desktop-implementation-plan.md](./docs/desktop-implementation-plan.md) - 桌面端实现计划
- [docs/agentic-framework-plan.md](./docs/agentic-framework-plan.md) - 智能体框架计划
- [claude-code/docs/](./claude-code/docs/) - Claude Code 原始文档

## License

MIT
