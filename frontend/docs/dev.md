# Agent 桌面应用开发指南（微信风格 UI）

> 本文档总结 D_UI（前端）与 diggdog（后端）的架构、技术栈选型、shadcn/ui 配置及 diggdog 对接要点。整体 UI 模仿微信，与 diggdog 交互聚焦任务管理、Agents、基本设置。

---

## 一、架构概览

### 1.1 UI 风格

- **整体模仿微信**：会话列表 + 主聊区 + 侧边信息/设置
- 简洁、紧凑、以对话为中心；暗色/浅色主题可切
- **样式约定**：全局色板用 `index.css` 的 CSS 变量 + Tailwind 语义色（`background`、`muted`、`border` 等）；第一列 `MainNav`、第二列 `ContentList`、第三列 `main` 均基于 `background`/`muted`，避免硬编码 `#fff`/`#f7f7f7`（易与暗色不一致）。第三列顶栏统一用 `ContentHeader`（`h-14`、`px-6`）；标题 `h2` 带 `data-tauri-drag-region` 可拖拽窗口，右侧操作区为 `data-tauri-drag-region="false"`。

### 1.2 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│  D_UI（本项目）                                                   │
│  - Tauri 2 壳 + React 18 + shadcn/ui                            │
│  - 微信风格 UI，纯前端，无 Agent 业务逻辑                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                     HTTP fetch / 读取配置文件
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  diggdog（后端，独立项目）                                        │
│  路径: ~/Documents/Program/diggdog/                              │
│  - agent-core: Orchestrator, Ralph Loop, Gateway                 │
│  - server: Axum HTTP API，默认端口 8080                          │
└─────────────────────────────────────────────────────────────────┘
```

**要点**：D_UI 通过 HTTP 与配置文件与 diggdog 交互；diggdog 需单独启动。

### 1.3 与 diggdog 的核心交互

| 模块 | 说明 | 交互方式 |
|------|------|----------|
| **任务管理** | 任务创建、执行、历史、 Cron 定时 | HTTP API（/execute, /api/v1/cron 等） |
| **Agents** | Agent 列表、配置、编排 | 读取 `~/.diggdog/agents/` + HTTP |
| **基本设置** | soul, memory, agent, llm, 系统权限 | 读写 `~/.diggdog/` 下配置或 HTTP（若后端暴露） |

---

## 二、整体技术栈

### 1. D_UI 前端（Node.js 20+）

| 类别 | 依赖 |
|------|------|
| 核心 | Tauri 2.x, React 18, React Router 6, Vite 5, TypeScript 5.3+ |
| UI 基础 | **shadcn/ui** + Tailwind 3.4, Lucide React, clsx, tailwind-merge |
| Agent 组件 | react-resizable-panels, @xyflow/react, Monaco, xterm.js, TipTap, shadcn Command, @tanstack/react-virtual, zustand |

### 2. D_UI 的 Tauri 壳（可选，用于桌面封装）

- **仅保留**：窗口管理、系统托盘、全局快捷键、通知
- **不包含**：Agent 逻辑、SQLite、Orchestrator
- 插件：shell（启动 diggdog）、notification、global-shortcut

### 3. diggdog 后端（独立项目）

- 路径：`~/Documents/Program/diggdog/`
- 结构：agent-core + server + cli
- 启动：`cargo run -p diggdog-server --bin diggdog-serve` 或 `diggdog-serve`
- 默认端口：**8080**（可在 config.toml 的 `[server]` 中配置）

### 4. D_UI 项目目录结构（微信风格布局）

```
D_UI/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn 组件
│   │   ├── layout/          # 微信式三栏：会话列表 | 主聊区 | 详情/设置
│   │   ├── chat/            # 会话列表、消息气泡、输入框
│   │   ├── tasks/           # 任务管理相关
│   │   ├── agents/          # Agents 管理相关
│   │   ├── settings/       # 设置页：soul, memory, agent, llm, 系统权限
│   │   ├── terminal/        # 终端输出（可选）
│   │   └── command/        # 命令面板 Cmd+K
│   ├── api/                 # diggdog API 调用封装
│   ├── hooks/
│   ├── stores/
│   ├── lib/
│   │   └── utils.ts        # cn() 等工具
│   └── types/
├── src-tauri/               # 仅 Tauri 壳（窗口、托盘等）
├── public/
├── package.json
└── dev.md
```

---

## 三、shadcn/ui 关键配置

### 3.1 Tailwind 配置

```typescript
// tailwind.config.ts
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // ... 其他 shadcn 变量
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

### 3.2 路径别名

**tsconfig.json**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**vite.config.ts**

```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './src'),
  },
},
```

### 3.3 cn() 工具函数（必需）

```typescript
// src/lib/utils.ts
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### 3.4 初始化与组件安装

```bash
npx shadcn@latest init

# 按需添加组件
npx shadcn add button input dialog dropdown-menu command sonner table resizable

# 复杂表格需要时
npm install @tanstack/react-table
```

---

## 四、组件对照与微信风格布局

### 4.1 微信式布局要点

- **左侧**：会话/任务列表（类似微信聊天列表），可折叠
- **中间**：主聊区（消息气泡、输入框、发送）
- **右侧**：详情/设置面板（可选，类似微信联系人/群聊详情）

### 4.2 组件映射

| 需求 | shadcn 方案 | 说明 |
|------|-------------|------|
| 会话列表项 | `Button` + 自定义 | 头像 + 名称 + 摘要 + 未读数 |
| 消息气泡 | 自定义 `div` | 左/右对齐、时间戳、引用 |
| 输入框 | `Input` / `Textarea` | 支持 @ 提及可配合 TipTap |
| Modal | `Dialog` | 设置弹窗 |
| 设置表单 | `Form` (react-hook-form + zod) | soul, memory, llm 等 |
| Toast | `Sonner` | 操作反馈 |
| 命令面板 | `Command` | Cmd+K 快捷操作 |
| 布局 | Tailwind Grid | `grid-cols-[280px_1fr_320px]` 三栏 |

---

## 五、diggdog 对接（任务管理 / Agents / 基本设置）

### 5.1 基础 URL 与端口

```typescript
// diggdog 默认端口已改为 8080
const DIGGDOG_API_BASE = import.meta.env.VITE_DIGGDOG_URL ?? 'http://localhost:8080';
```

### 5.2 认证与限流（diggdog config.toml）

diggdog 已启用认证与限流，需在 `~/.diggdog/config.toml` 或 diggdog 配置中设置：

```toml
[server]
port = 8080
auth_enabled = true
rate_limit_per_minute = 60

[server.api_keys]
# 格式: "api_key" = "client_name"
"dfdae8e7411bf6036445169c2c380b0710cb69b5a240e8bf18f8f72d6684fc96" = "client"
```

前端需在 `.env.local` 中配置 API Key（勿提交到 Git）：

```
VITE_DIGGDOG_API_KEY=e117b002e4d56a56e52ac6814b79a58f
```

### 5.3 任务管理

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/v1/execute` | POST | 执行任务（`{ content, platform }`），需携带 `Authorization: Bearer <api_key>` |
| `/api/v1/cron` | GET/POST | 定时任务列表 / 新增 |
| `/api/v1/cron/:id` | DELETE | 删除定时任务 |
| `/api/v1/cron/:id/run` | POST | 手动触发 |
| `/api/v1/cron/:id/history` | GET | 执行历史 |
| `/api/v1/stats` | GET | 任务与 LLM 统计 |
| `/api/v1/status` | GET | 服务状态 |
| `/health` | GET | 健康检查 |

### 5.4 Agents

- **目录**：`~/.diggdog/agents/`（或 `diggdog_home()/agents`）
- **方式**：通过 Tauri `fs` 插件读取 YAML 配置，或后端增加 Agents 列表 API
- **内容**：Agent 定义、skills、topology 等

### 5.5 基本设置（soul / memory / agent / llm / 系统权限）

| 设置项 | 配置来源 | 说明 |
|--------|----------|------|
| **soul** | `~/.diggdog/` 或 unified config | 角色/人格设定 |
| **memory** | `~/.diggdog/memory/` | 记忆存储路径与策略 |
| **agent** | `~/.diggdog/agents/` | 默认 Agent、编排方式 |
| **llm** | `~/.diggdog/config.toml` 或 `.env.local` | 模型、API Key、提供商 |
| **系统权限** | diggdog 配置 | 文件访问、网络、命令执行等权限边界 |

- **读写方式**：Tauri `fs` 读写本地配置；若后端提供设置 API，则用 HTTP 更新

### 5.6 执行请求示例

```typescript
// POST /api/v1/execute
// 需携带 Authorization: Bearer <api_key>
// 成功返回 text/plain，失败返回 JSON { error }
const apiKey = import.meta.env.VITE_DIGGDOG_API_KEY ?? '';
const res = await fetch(`${DIGGDOG_API_BASE}/api/v1/execute?session_id=main`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
  },
  body: JSON.stringify({
    content: '用户输入的自然语言任务',
    platform: 'http',
  }),
});
const text = await res.text();
const result = res.ok ? text : (JSON.parse(text || '{}').error ?? text);
```

### 5.7 CORS

diggdog 使用 tower-http CORS，需确保允许 D_UI 开发地址（如 `http://localhost:1420`）。

---

## 六、Vite 与 Tauri 配置要点

### vite.config.ts

```typescript
server: {
  port: 1420,
  strictPort: true,
  watch: { ignored: ["**/src-tauri/**"] },
  proxy: {
    // 可选：开发时代理到 diggdog（端口 8080），避免 CORS
    '/api': { target: 'http://localhost:8080', changeOrigin: true },
    '/health': { target: 'http://localhost:8080', changeOrigin: true },
  },
},
```

### Tauri 壳（可选）

若使用 Tauri，仅保留窗口管理；业务数据全部通过 fetch 与 diggdog 交互，无需 Tauri Commands/Events。

### macOS 窗口圆角与投影（最佳实践）

社区实践（[tauri#9287](https://github.com/tauri-apps/tauri/issues/9287) 等）：

| 配置/实现 | 说明 |
|-----------|------|
| `tauri.conf.json`: `shadow: true` + `setup` 里 `set_shadow(true)` | 整窗与桌面分离应用 **系统原生投影**（自然渐变）；勿依赖 WebView 内 padding + CSS 模拟（易错位、呈平片） |
| `transparent: true` + `decorations: false` | 透明无边框窗口，便于自定义样式 |
| `macOSPrivateApi: true` | 使圆角在 macOS 上正常生效 |
| **透明窗口投影** | 整窗与桌面的分离用 **Tauri 原生**：`tauri.conf.json` 中 `shadow: true`，并在 `lib.rs` `setup` 里对 `main` 窗口 `set_shadow(true)`。勿在 `App` 根节点加 `p-*` 内嵌卡片 + CSS 投影——透明 WebView 里 CSS 阴影易呈「平片」，且与窗口客户区不同步会导致缩放时鼠标错位 |
| **勿与 `overflow-hidden` 同层** | 同一 DOM 上同时 `overflow-hidden` + `box-shadow` 会裁掉投影；应外层 `p-3` + 中层阴影与背景 + 内层 `overflow-hidden`（见 `App.tsx`） |

无需使用 `window-shadows` 等插件；CSS 投影即可实现与圆角兼容的轻投影效果。

---

## 七、状态与样式分离原则

| 存储 | 数据类型 | 示例 |
|------|----------|------|
| Zustand | 纯 UI 状态 | sidebarCollapsed, activeTab, theme |
| diggdog SQLite | 业务数据 | taskHistory, agentConfig, executionLogs（后端维护） |
| 前端内存 | 运行时 UI 状态 | currentSession, runningTasks 展示 |

**样式优先级**：shadcn 组件 → Tailwind 布局/间距 → CSS 变量（主题）

---

## 八、开发命令

```bash
# 1. 启动 diggdog 后端（另开终端）
cd ~/Documents/Program/diggdog
cargo run -p diggdog-server --bin diggdog-serve

# 2. 启动 D_UI 前端
cd ~/Documents/Program/D_UI
npm run dev

# 3. 若使用 Tauri 桌面壳
npm run tauri dev

# 4. 构建发布
npm run tauri build

# 5. 运行测试
npm run test
```

---

## 九、迁移清单（Arco → shadcn）

- [ ] `npx shadcn@latest init`
- [ ] 确认 Tailwind HSL 变量、darkMode、tailwindcss-animate
- [ ] 配置 `@/*` 路径别名
- [ ] 实现 `cn()` 工具
- [ ] 按需添加 shadcn 组件，Message 用 Sonner
- [ ] Tree 选用 react-arborist 或保留 Arco
- [ ] 移除 Arco 及独立 cmdk 依赖

---

## 十、适用场景与注意事项

- **单机 Agent 桌面工具 + 微信风格 UI**：✅ 完全适用（D_UI + diggdog）
- **交互重心**：任务管理、Agents、基本设置（soul / memory / agent / llm / 系统权限）
- **启动顺序**：先启动 diggdog，再启动 D_UI；或 Tauri 启动时自动 spawn diggdog 子进程（需自行实现）

---

## 十一、开发前架构审查结论

### 11.1 已就绪可开始开发

| 项目 | 状态 |
|------|------|
| 整体架构 | ✅ D_UI 纯前端 + diggdog HTTP，职责清晰 |
| 技术栈选型 | ✅ React + shadcn/ui + Tauri，文档完整 |
| 任务管理 API | ✅ `/execute`、`/api/v1/cron`、`/api/v1/stats` 已实现 |
| 配置文件路径 | ✅ `~/.diggdog/` 结构已明确（paths.rs） |
| 项目 scaffold | ⚠️ D_UI 目前仅有 dev.md，需执行脚手架创建 |

### 11.2 需在开发前补齐的项

| 缺口 | 影响 | 建议 |
|------|------|------|
| **CORS** | diggdog 未配置 CORS，浏览器 fetch 会跨域失败 | 方案 A：diggdog 增加 CorsLayer 放行 `localhost:1420`；方案 B：Vite proxy 代理到 8080（dev.md 已写） |
| **/execute 响应格式** | 成功返回 `text/plain`，失败返回 JSON | 前端按 `Content-Type` 分支：成功用 `res.text()`，失败用 `res.json()` |
| **session_id** | 当前从 query 或 `whoami` 取，无 body 支持 | 桌面端可用 `?session_id=main` 或接受默认 username；多人会话后续再扩展 |
| **Agents 列表 API** | 无 | 前端用 Tauri `fs` 读 `~/.diggdog/agents/` 目录；或 diggdog 新增 `GET /api/v1/agents` |
| **配置读写 API** | soul/memory/llm 无 HTTP 接口 | 前端用 Tauri `fs` 读写 `config.toml`、`soul/`、`memory/`；或 diggdog 新增设置 API |
| **流式输出** | `/execute` 同步阻塞直到完成 | 长任务无实时进度；后续可考虑 SSE 或 WebSocket |

### 11.3 diggdog 路径速查（与 dev.md 对齐）

```
~/.diggdog/
├── config.toml       # 统一配置（llm、engine、hitl 等）
├── diggdog.db        # 任务、日志、统计
├── agents/           # Agent 定义（YAML/MD）
├── soul/             # SOUL.md, purpose.md
├── memory/           # 记忆存储
├── skills/           # 技能目录
├── exec-approvals.json  # 命令执行权限
└── workspace/        # 默认工作区
```

### 11.4 结论

**可以开始开发。** 建议顺序：

1. **脚手架**：`npm create vite@latest` + `npx shadcn@latest init` + Tauri init
2. **CORS**：开发期先用 Vite proxy，避免改 diggdog
3. **MVP 范围**：先做任务执行 + 会话列表 + 基础设置（llm、soul 路径展示），Agents 与配置编辑用 Tauri fs 或占位页
4. **后续**：与 diggdog 协作补充 Agents/Config API、流式输出

---

## 十二、P1–P3 实现摘要

### P1 已完成

| 功能 | 实现 |
|------|------|
| 任务统计 | 左侧「任务统计」入口 + `StatsPanel`，调用 `/api/v1/stats` |
| Agents 列表 | 左侧「Agents」入口 + `AgentsPanel`，Tauri fs 读取 `~/.diggdog/agents/`（.md / .yaml / .yml） |

### P2 已完成

| 功能 | 实现 |
|------|------|
| Cron 管理 UI | 左侧「定时任务」入口 + `CronPanel`，对接 GET/POST `/api/v1/cron`、DELETE、run、history |
| 配置编辑 | SettingsPanel 支持编辑 `config.toml`（soul、llm 等），Tauri `writeTextFile` 保存 |

### P3 已完成

| 功能 | 实现 |
|------|------|
| 流式输出 | 前端已支持：`executeStream` 消费 SSE，ChatArea 增量更新，Markdown 渲染；后端若返回 `text/event-stream` 则流式，否则 fallback 到同步 `execute()` |
| 系统权限 | SettingsPanel 展示 `~/.diggdog/exec-approvals.json` 内容 |
