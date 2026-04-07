# Claude Code 改造为 Agentic 框架方案

**创建日期**: 2026-04-01 13:20:00
**状态**: [DRAFT] 草稿

## 一、当前项目分析

### 1.1 目录结构

```
Claude/
├── package/                   # 原始 npm 包（可运行）
│   ├── cli.js                 # 编译后的单文件可执行程序
│   ├── cli.js.map             # source map
│   └── package.json
│
└── restored-src/              # 还原的源码（不可运行）
    ├── src/                   # TypeScript 源码
    ├── node_modules/          # 依赖
    └── vendor/                # 原始 vendor
```

### 1.2 技术栈

| 技术 | 用途 |
|------|------|
| Bun | 打包器，编译成单文件可执行程序 |
| `bun:bundle` | Bun 特有的编译时 feature flags |
| TypeScript | 源码语言 |
| React + Ink | TUI 框架 |
| Commander.js | CLI 框架 |
| Anthropic SDK | LLM API 调用 |
| MCP SDK | Model Context Protocol |

### 1.3 核心组件

```
src/
├── main.tsx              # CLI 入口
├── QueryEngine.ts        # 核心 ReAct 循环引擎
├── query.ts              # 查询循环逻辑
├── tools/                # 30+ 内置工具
├── services/             # API、MCP、压缩等服务
├── utils/                # 工具函数
├── commands/             # 40+ CLI 命令
└── skills/               # 技能系统
```

### 1.4 关键依赖

```typescript
// Bun 特有模块（需要处理）
import { feature } from 'bun:bundle'

// 核心依赖
@anthropic-ai/sdk       // LLM API
@commander-js/extra-typings  // CLI
ink                     // TUI
react                   // UI
lodash-es               // 工具函数
chalk                   // 终端颜色
```

## 二、改造方案

### 2.1 方案概述

**目标**：创建一个最小可运行的 Agentic 框架

**策略**：
1. 简化架构，移除 CLI/TUI 相关代码
2. Mock `bun:bundle` 的 feature flags
3. 保留核心 ReAct 循环
4. 提取工具系统作为独立模块

### 2.2 架构改造

```
改造前（完整 CLI 应用）：
main.tsx → Commander CLI → REPL/UI → QueryEngine → Tools

改造后（Agentic 框架）：
index.ts → QueryEngine → Tools
         ↓
         简化的 API 入口
```

### 2.3 需要处理的模块

#### A. `bun:bundle` Feature Flags

```typescript
// 原始代码
import { feature } from 'bun:bundle'
if (feature('COORDINATOR_MODE')) { ... }

// 改造方案 1：环境变量
export function feature(name: string): boolean {
  return process.env[`FEATURE_${name}`] === 'true'
}

// 改造方案 2：配置文件
const features = {
  COORDINATOR_MODE: false,
  EXPERIMENTAL_SKILL_SEARCH: false,
  // ...
}
export function feature(name: string): boolean {
  return features[name] ?? false
}
```

#### B. 需要移除/简化的模块

| 模块 | 处理方式 | 原因 |
|------|---------|------|
| `main.tsx` CLI 入口 | 移除 | 不需要 CLI |
| `replLauncher.tsx` | 移除 | 不需要 REPL |
| `dialogLaunchers.tsx` | 移除 | 不需要交互式对话框 |
| `components/` TUI | 移除 | 不需要 TUI |
| `screens/` | 移除 | 不需要屏幕 |
| `hooks/` 部分 | 简化 | 只保留核心逻辑 |
| `commands/` | 移除 | 不需要 slash commands |
| `services/analytics/` | 简化 | 移除遥测 |
| `services/voiceStreamSTT.ts` | 移除 | 不需要语音 |

#### C. 核心保留模块

| 模块 | 保留原因 |
|------|---------|
| `QueryEngine.ts` | 核心 ReAct 循环 |
| `query.ts` | 查询逻辑 |
| `Tool.ts` | 工具接口 |
| `tools/` | 工具实现 |
| `services/api/` | API 调用 |
| `services/compact/` | 上下文压缩 |
| `utils/messages.ts` | 消息处理 |
| `utils/attachments.ts` | 附件注入 |
| `utils/context.ts` | 上下文管理 |

### 2.4 创建必要的配置文件

#### package.json

```json
{
  "name": "agentic-core",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.40.0",
    "lodash-es": "^4.17.21",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/lodash-es": "^4.17.0",
    "typescript": "^5.7.0"
  }
}
```

#### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### src/bundle.ts（Mock bun:bundle）

```typescript
// 替代 bun:bundle
type FeatureFlags = {
  [key: string]: boolean
}

const DEFAULT_FEATURES: FeatureFlags = {
  // 启用的功能
  HISTORY_SNIP: false,
  REACTIVE_COMPACT: false,
  CONTEXT_COLLAPSE: false,
  COORDINATOR_MODE: false,
  KAIROS: false,
  EXPERIMENTAL_SKILL_SEARCH: false,
  TEMPLATES: false,
  BG_SESSIONS: false,
  TOKEN_BUDGET: false,
}

let features = { ...DEFAULT_FEATURES }

export function feature(name: string): boolean {
  return features[name] ?? false
}

export function setFeature(name: string, value: boolean): void {
  features[name] = value
}

export function setFeatures(newFeatures: Partial<FeatureFlags>): void {
  features = { ...features, ...newFeatures }
}
```

### 2.5 简化后的入口文件

```typescript
// src/index.ts
export { QueryEngine } from './QueryEngine.js'
export type { QueryEngineConfig } from './QueryEngine.js'

export { Tool, buildTool, type ToolUseContext } from './Tool.js'
export { getTools } from './tools.js'

export * from './utils/messages.js'
export * from './utils/attachments.js'

// 工具导出
export { BashTool } from './tools/BashTool/BashTool.js'
export { FileReadTool } from './tools/FileReadTool/FileReadTool.js'
export { FileEditTool } from './tools/FileEditTool/FileEditTool.js'
export { FileWriteTool } from './tools/FileWriteTool/FileWriteTool.js'
export { GlobTool } from './tools/GlobTool/GlobTool.js'
export { GrepTool } from './tools/GrepTool/GrepTool.js'
// ... 其他工具
```

### 2.6 使用示例

```typescript
// examples/basic-usage.ts
import { QueryEngine, getTools, BashTool, FileReadTool } from 'agentic-core'

async function main() {
  const engine = new QueryEngine({
    cwd: process.cwd(),
    tools: getTools(),
    commands: [],
    mcpClients: [],
    agents: [],
    canUseTool: async (tool, input, context) => ({ behavior: 'allow' }),
    getAppState: () => ({ /* ... */ }),
    setAppState: () => {},
    readFileCache: new Map(),
  })

  // 运行查询
  for await (const message of engine.submitMessage('帮我分析当前项目')) {
    console.log(message)
  }
}

main()
```

## 三、实施步骤

### Phase 1: 基础配置（预计工作量：小）

1. [ ] 创建 `package.json`
2. [ ] 创建 `tsconfig.json`
3. [ ] 创建 `src/bundle.ts` mock `bun:bundle`
4. [ ] 创建 `src/index.ts` 入口文件

### Phase 2: 核心模块迁移（预计工作量：中）

1. [ ] 迁移 `Tool.ts` 工具接口
2. [ ] 迁移 `QueryEngine.ts` 核心引擎
3. [ ] 迁移 `query.ts` 查询逻辑
4. [ ] 迁移 `utils/messages.ts` 消息处理
5. [ ] 迁移 `utils/attachments.ts` 附件注入

### Phase 3: 工具系统（预计工作量：中）

1. [ ] 迁移 `tools/BashTool/`
2. [ ] 迁移 `tools/FileReadTool/`
3. [ ] 迁移 `tools/FileEditTool/`
4. [ ] 迁移 `tools/FileWriteTool/`
5. [ ] 迁移 `tools/GlobTool/`
6. [ ] 迁移 `tools/GrepTool/`

### Phase 4: API 服务（预计工作量：小）

1. [ ] 迁移 `services/api/claude.ts`
2. [ ] 迁移 `services/api/errors.ts`
3. [ ] 简化 `services/analytics/`

### Phase 5: 测试与文档（预计工作量：中）

1. [ ] 编写单元测试
2. [ ] 编写使用文档
3. [ ] 编写示例代码

## 四、替代方案

### 方案 A：使用原始 cli.js

**优点**：无需修改，直接可用
**缺点**：无法定制，只能作为 CLI 使用

```bash
# 直接运行
node package/cli.js

# 或作为依赖
npm install ./package
```

### 方案 B：参考架构重写

**优点**：代码更清晰，更易维护
**缺点**：工作量大，需要完全重写

```
重新实现核心组件：
1. QueryEngine - ReAct 循环
2. Tool 接口 - 工具系统
3. Message 结构 - 消息格式
4. Context 管理 - 上下文处理
```

### 方案 C：Fork 并最小化修改

**优点**：保留完整功能，可逐步定制
**缺点**：代码冗余，维护困难

```bash
# 复制源码
cp -r restored-src/src ./agentic-core/

# 逐步移除不需要的模块
rm -rf components/ screens/ commands/
```

## 五、推荐方案

**推荐方案 C（Fork 并最小化修改）**，理由：

1. 保留完整功能，可以选择性使用
2. 可以逐步简化和定制
3. 工作量可控
4. 可以对比学习原始架构

## 六、下一步行动

1. 确定改造方案（A/B/C）
2. 创建基础配置文件
3. 开始 Phase 1 实施
