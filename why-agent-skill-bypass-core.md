# 为什么 Agent/Skill 管理直接由 Sidecar/Handlers 处理？

## 你的问题

> "为什么前端 agent 和 skill 接口以什么形式获取和编辑 agent 和 skill，都是直接和 sidecar 对接，sidecar 不是不负责具体对接数据处理吗？"

**这是一个非常好的架构问题！** 你的理解部分正确，但需要对 `sidecar/` 的职责进行更精确的划分。

---

## 🎯 核心答案

**Sidecar/ 确实负责协议层，但 `sidecar/handlers/` 是一个特殊的"业务逻辑层"，它直接处理 Agent 和 Skill 的 CRUD 操作，因为这些操作:**

1. ✅ **不涉及 QueryEngine** (不需要 AI 推理)
2. ✅ **是纯数据管理** (文件读写、配置解析)
3. ✅ **与 CLI 完全对齐** (复用 CLI 的加载系统)
4. ✅ **不需要通过 core/ 抽象** (core/ 主要抽象 AI 执行流程)

---

## 📐 重新理解 Sidecar/ 的内部结构

### Sidecar/ 包含两个子层

```
sidecar/
├── ┌─────────────────────────────────────────────────┐
│   │  协议核心层 (不处理业务逻辑)                     │
│   │  - jsonRpcServer.ts     ← JSON-RPC 路由         │
│   │  - streamHandler.ts     ← 流式传输              │
│   │  - permissionBridge.ts  ← 权限双向通信          │
│   │  - entry.ts             ← 进程启动              │
│   └─────────────────────────────────────────────────┘
│
├── ┌─────────────────────────────────────────────────┐
│   │  业务 Handlers 层 (直接处理数据)                 │
│   │  - agentHandler.ts      ← Agent CRUD + Memory   │
│   │  - skillHandler.ts      ← Skill CRUD            │
│   │  - sessionHandler.ts    ← 会话管理              │
│   │  - checkpointHandler.ts ← 检查点管理            │
│   │  - cronHandler.ts       ← 定时任务              │
│   └─────────────────────────────────────────────────┘
```

**关键区别**:

| 子层 | 职责 | 是否处理业务逻辑 |
|------|------|----------------|
| **协议核心层** | JSON-RPC 解析、流式传输、背压控制 | ❌ 不处理 |
| **业务 Handlers 层** | 文件读写、配置解析、数据转换 | ✅ 直接处理 |

---

## 🔍 为什么 Agent/Skill 不走 Core/?

### Core/ 的抽象范围

**Core/ 抽象的是 AI 执行流程**:

```
core/AgentCore.ts 抽象的核心接口:
├── execute()          ← AI 查询执行 (需要 QueryEngine)
├── abort()            ← 中断 AI 执行
├── createSession()    ← 创建 AI 会话
├── listTools()        ← 查询可用工具 (用于 AI 执行)
└── onPermissionRequest ← AI 工具调用权限
```

**Agent 和 Skill 管理不属于 AI 执行流程**:

```
Agent/Skill 管理的特点:
├── 纯 CRUD 操作 (文件系统)
├── 不需要调用 QueryEngine
├── 不需要流式输出
├── 不需要权限控制 (文件操作权限除外)
└── 直接读写配置文件
```

### 对比: Execute vs CreateAgent

#### Execute (走 core/)

```
前端 → JsonRpcServer 
     → AgentCore.execute()        ← 需要 core/ 抽象
     → QueryEngine.submitMessage() ← 需要 AI 引擎
     → 流式返回 SDKMessage
     → 转换为 SidecarStreamEvent
     → StreamHandler 发送
```

**为什么需要 core/?**
- 需要统一 CLI 和 Sidecar 的 AI 执行逻辑
- 需要转换消息格式 (SDKMessage → SidecarStreamEvent)
- 需要管理权限引擎、工具注册、状态管理
- 需要处理复杂的流式输出

#### CreateAgent (不走 core/)

```
前端 → JsonRpcServer
     → agentHandler.createAgent()  ← 直接处理
     → 写入 Markdown 文件
     → 返回结果
```

**为什么不需要 core/?**
- 纯文件操作，不涉及 AI 推理
- 没有流式输出，直接返回结果
- 不需要权限引擎 (除了文件系统权限)
- 不需要工具注册、状态管理等

---

## 💻 实际代码分析

### Agent Handler 的完整实现

```typescript
// sidecar/handlers/agentHandler.ts

// 1. 注册 RPC 方法
export function registerAgentHandlers(server: ServerLike): void {
  server.registerMethod('getAgents', async (_params: unknown) => {
    return getAgents()  // ← 直接调用,不经过 AgentCore
  })

  server.registerMethod('createAgent', async (params: unknown) => {
    return createAgent(params as { name: string; ... })
  })
  
  server.registerMethod('updateAgent', async (params: unknown) => {
    return updateAgent(params as { name: string; ... })
  })
}

// 2. 创建 Agent 的具体实现
async function createAgent(params: {
  name: string
  soul?: string
  description?: string
  // ...
}): Promise<{ name: string }> {
  // 纯文件操作!
  const userAgentsDir = join(homedir(), '.claude', 'agents')
  await fs.mkdir(userAgentsDir, { recursive: true })
  
  const agentFilePath = join(userAgentsDir, `${params.name}.md`)
  
  // 构建 Markdown 内容
  const content = [
    '---',
    `name: ${params.name}`,
    `description: ${params.description || ''}`,
    // ...
    '---',
    '',
    params.soul || `# ${params.name}`,
  ].join('\n')
  
  await fs.writeFile(agentFilePath, content, 'utf-8')
  clearAgentsCache()
  
  return { name: params.name }
}

// 3. 获取 Agents 的具体实现
async function loadAllAgents(): Promise<AgentInfo[]> {
  const cwd = getCwdState() || process.cwd()
  
  // 复用 CLI 的 Agent 加载系统!
  const result = await getAgentDefinitionsWithOverrides(cwd)
  
  // 转换为 AgentInfo
  const agents = result.allAgents.map(agentDefinitionToInfo)
  
  // 过滤、去重...
  return filteredAgents
}
```

**关键观察**:
- ✅ 直接调用文件系统 API
- ✅ 复用 CLI 的 `getAgentDefinitionsWithOverrides()`
- ✅ 不需要 `AgentCore` 的任何方法
- ✅ 不需要 `QueryEngine`
- ✅ 没有流式输出

### Skill Handler 的完整实现

```typescript
// sidecar/handlers/skillHandler.ts

export function registerSkillHandlers(server: ServerLike): void {
  server.registerMethod('getSkills', async (_params: unknown) => {
    return getSkills()  // ← 直接调用
  })

  server.registerMethod('createSkill', async (params: unknown) => {
    return createSkill(params as { name: string; ... })
  })
}

async function loadAllSkills(): Promise<Skill[]> {
  const cwd = getCwdState() || process.cwd()
  
  // 复用 CLI 的 Skill 加载系统!
  const [
    skillDirCommands,
    pluginSkills,
    bundledSkills,
    builtinPluginSkills,
    dynamicSkills,
  ] = await Promise.all([
    getSkillDirCommands(cwd),
    getPluginSkills(),
    getBundledSkills(),
    getBuiltinPluginSkillCommands(),
    getDynamicSkills(),
  ])
  
  // 合并、去重、转换
  const skills = uniqueCommands.map(commandToSkill)
  return skills
}
```

**同样**:
- ✅ 复用 CLI 的 Skill 加载系统
- ✅ 纯数据转换和文件操作
- ✅ 不需要 `AgentCore`

---

## 🔄 数据流对比

### Execute 的数据流 (经过 Core/)

```
┌──────────────────────────────────────────────────────────┐
│ 前端 (React)                                              │
│  tauri.invoke('execute', { content: '分析代码' })         │
└────────────────────┬─────────────────────────────────────┘
                     │ Tauri IPC
┌────────────────────▼─────────────────────────────────────┐
│ Rust 后端                                                 │
│  写入 stdin: JSON-RPC request                             │
└────────────────────┬─────────────────────────────────────┘
                     │ stdin
┌────────────────────▼─────────────────────────────────────┐
│ JsonRpcServer (sidecar/协议层)                            │
│  解析 JSON-RPC, 路由到 execute handler                    │
└────────────────────┬─────────────────────────────────────┘
                     │ 调用
┌────────────────────▼─────────────────────────────────────┐
│ AgentCore.execute() (core/抽象层) ← 需要抽象!             │
│  - 构造 canUseTool 回调                                   │
│  - 配置 QueryEngine                                       │
│  - 转换消息格式                                           │
│  - 管理权限、状态、工具                                    │
└────────────────────┬─────────────────────────────────────┘
                     │ 调用
┌────────────────────▼─────────────────────────────────────┐
│ QueryEngine.submitMessage() (底层引擎)                    │
│  - 调用 Anthropic API                                     │
│  - 管理工具调用循环                                       │
│  - 流式返回 SDKMessage                                    │
└────────────────────┬─────────────────────────────────────┘
                     │ AsyncGenerator<SDKMessage>
┌────────────────────▼─────────────────────────────────────┐
│ AgentCore (core/)                                         │
│  mapSDKMessageToStreamEvent()                             │
│  → AsyncGenerator<SidecarStreamEvent>                     │
└────────────────────┬─────────────────────────────────────┘
                     │ 调用
┌────────────────────▼─────────────────────────────────────┐
│ StreamHandler (sidecar/协议层)                            │
│  消费 AsyncGenerator                                      │
│  发送 $/stream notifications                              │
└────────────────────┬─────────────────────────────────────┘
                     │ stdout
┌────────────────────▼─────────────────────────────────────┐
│ Rust 后端                                                 │
│  解析 notifications, 发送 Tauri events                    │
└────────────────────┬─────────────────────────────────────┘
                     │ Tauri events
┌────────────────────▼─────────────────────────────────────┐
│ 前端 (React)                                              │
│  监听 events, 更新 UI                                     │
└──────────────────────────────────────────────────────────┘
```

### CreateAgent 的数据流 (不经过 Core/)

```
┌──────────────────────────────────────────────────────────┐
│ 前端 (React)                                              │
│  tauri.invoke('createAgent', { name: 'coder', ... })      │
└────────────────────┬─────────────────────────────────────┘
                     │ Tauri IPC
┌────────────────────▼─────────────────────────────────────┐
│ Rust 后端                                                 │
│  写入 stdin: JSON-RPC request                             │
└────────────────────┬─────────────────────────────────────┘
                     │ stdin
┌────────────────────▼─────────────────────────────────────┐
│ JsonRpcServer (sidecar/协议层)                            │
│  解析 JSON-RPC, 路由到 createAgent handler                │
└────────────────────┬─────────────────────────────────────┘
                     │ 调用
┌────────────────────▼─────────────────────────────────────┐
│ agentHandler.createAgent() (sidecar/handlers/)            │
│  - 直接操作文件系统                                       │
│  - 写入 Markdown 文件                                     │
│  - 清除缓存                                               │
│  - 返回结果                                               │
└────────────────────┬─────────────────────────────────────┘
                     │ 直接返回
┌────────────────────▼─────────────────────────────────────┐
│ JsonRpcServer                                             │
│  发送 JSON-RPC response                                   │
└────────────────────┬─────────────────────────────────────┘
                     │ stdout
┌────────────────────▼─────────────────────────────────────┐
│ Rust 后端                                                 │
│  解析 response, resolve Tauri invoke                      │
└────────────────────┬─────────────────────────────────────┘
                     │ Tauri invoke result
┌────────────────────▼─────────────────────────────────────┐
│ 前端 (React)                                              │
│  更新 UI                                                  │
└──────────────────────────────────────────────────────────┘
```

**关键区别**:
- Execute: 经过 **5 层** (前端 → Rust → JsonRpcServer → **Core/** → QueryEngine)
- CreateAgent: 只经过 **3 层** (前端 → Rust → JsonRpcServer → **Handler**)

---

## 🎯 架构设计原则

### 何时走 Core/?

**需要 AI 执行流程的功能**:

| 功能 | 是否走 Core/ | 原因 |
|------|------------|------|
| 执行查询 (execute) | ✅ 是 | 需要 QueryEngine、流式输出 |
| 中断执行 (abort) | ✅ 是 | 需要管理 AbortController |
| 会话管理 (session) | ✅ 是 | 与 AI 执行相关 |
| 工具列表 (listTools) | ✅ 是 | 用于 AI 工具调用 |
| 权限请求 | ✅ 是 | 工具调用权限 |

**判断标准**:
- 是否需要调用 QueryEngine?
- 是否有流式输出?
- 是否需要权限引擎 (AI 工具调用权限)?
- 是否需要状态管理 (AI 会话状态)?

### 何时不走 Core/?

**纯数据管理功能**:

| 功能 | 是否走 Core/ | 原因 |
|------|------------|------|
| Agent CRUD | ❌ 否 | 纯文件操作,复用 CLI 加载系统 |
| Skill CRUD | ❌ 否 | 纯文件操作,复用 CLI 加载系统 |
| Checkpoint 管理 | ❌ 否 | 文件快照管理 |
| Cron 任务管理 | ❌ 否 | 定时任务调度 |
| 会话历史查询 | ❌ 否 | 只读数据查询 |

**判断标准**:
- 是否只是文件读写?
- 是否复用 CLI 的现有加载系统?
- 是否不需要 AI 推理?
- 是否没有流式输出?

---

## 🤔 那 Core/ 的价值在哪里?

### Core/ 抽象的价值

Core/ 的核心价值是**统一 AI 执行流程**,让 CLI 和 Sidecar 共享:

```typescript
// CLI 模式
const transport = new DirectTransport(agentCore)
for await (const event of transport.execute('分析代码')) {
  console.log(event.content)
}

// Sidecar 模式 (前端通过 JsonRpcServer)
// 但 JsonRpcServer 内部调用的也是同一个 agentCore.execute()!
const generator = agentCore.execute('分析代码')
await streamHandler.consume(executeId, generator)
```

**共享的内容**:
- ✅ QueryEngine 配置和调用
- ✅ 消息格式转换 (SDKMessage → SidecarStreamEvent)
- ✅ 权限评估逻辑 (PermissionEngine)
- ✅ 工具注册和过滤 (ToolRegistry)
- ✅ 状态管理 (StateManager)

**不共享的内容**:
- ❌ Agent/Skill 的文件管理 (各自直接用 CLI 加载系统)
- ❌ Checkpoint 管理 (文件系统操作)
- ❌ Cron 任务 (调度逻辑)

---

## 📊 完整的功能分类

### 通过 Core/ 的功能 (AI 执行相关)

```
core/AgentCore.ts 提供的接口:
├── execute()              → 走 core/ (AI 查询)
├── abort()                → 走 core/ (中断 AI)
├── createSession()        → 走 core/ (AI 会话)
├── getSession()           → 走 core/ (AI 会话)
├── listSessions()         → 走 core/ (AI 会话)
├── clearSession()         → 走 core/ (AI 会话)
├── listTools()            → 走 core/ (AI 工具)
├── isToolEnabled()        → 走 core/ (AI 工具)
├── getState()             → 走 core/ (AI 状态)
└── onStateChange()        → 走 core/ (AI 状态)
```

### 不通过 Core/ 的功能 (纯数据管理)

```
sidecar/handlers/* 直接处理:
├── agentHandler
│   ├── getAgents          → 不走 core/ (文件读取)
│   ├── getAgent           → 不走 core/ (文件读取)
│   ├── createAgent        → 不走 core/ (文件写入)
│   ├── updateAgent        → 不走 core/ (文件更新)
│   ├── deleteAgent        → 不走 core/ (文件删除)
│   ├── getAgentMemoryStats → 不走 core/ (文件统计)
│   ├── searchAgentMemory  → 不走 core/ (文件搜索)
│   ├── getAgentMemoryRecent → 不走 core/ (文件读取)
│   └── clearAgentMemory   → 不走 core/ (文件清空)
│
├── skillHandler
│   ├── getSkills          → 不走 core/ (文件读取)
│   ├── getSkill           → 不走 core/ (文件读取)
│   ├── createSkill        → 不走 core/ (文件写入)
│   ├── installSkill       → 不走 core/ (文件下载)
│   ├── updateSkill        → 不走 core/ (文件更新)
│   ├── deleteSkill        → 不走 core/ (文件删除)
│   └── searchRemoteSkills → 不走 core/ (网络搜索)
│
├── checkpointHandler
│   ├── saveCheckpoint     → 不走 core/ (文件快照)
│   ├── rollbackCheckpoint → 不走 core/ (文件恢复)
│   └── listCheckpoints    → 不走 core/ (文件列表)
│
├── cronHandler
│   ├── getCronJobs        → 不走 core/ (调度器查询)
│   ├── addCronJob         → 不走 core/ (调度器注册)
│   └── removeCronJob      → 不走 core/ (调度器删除)
│
└── sessionHandler
    ├── getSessions        → 不走 core/ (文件索引)
    └── ...
```

**注意**: 虽然 `sessionHandler` 不走 core/,但 `core/AgentCore` 也有 `createSession/getSession/listSessions`,这是因为:
- **core/ 的会话管理**: 用于 AI 执行时的会话状态
- **sidecar/ 的会话管理**: 用于前端展示的会话列表和历史

---

## 🔧 如果 Agent 管理走 Core/ 会怎样?

### 假设的错误设计

```typescript
// ❌ 错误的设计: 让 Agent CRUD 走 core/
export interface AgentCore {
  // 现有的 AI 执行相关接口
  execute(): AsyncGenerator<SidecarStreamEvent>
  
  // ❌ 不应该在这里!
  createAgent(params: AgentParams): Promise<Agent>
  updateAgent(name: string, params: AgentParams): Promise<void>
  deleteAgent(name: string): Promise<void>
}
```

### 为什么这是错误的?

1. **违反单一职责**:
   - AgentCore 应该抽象 AI 执行流程
   - Agent CRUD 是文件管理,与 AI 执行无关

2. **没有复用价值**:
   - CLI 模式不需要通过 AgentCore 管理 Agent
   - CLI 直接用 `/agents` 命令操作文件

3. **增加复杂度**:
   - 需要在 core/ 中添加文件操作逻辑
   - 需要处理 Markdown 解析
   - 与 QueryEngine 没有任何关系

4. **破坏抽象层次**:
   - Core/ 应该是高层次抽象
   - 文件操作是低层次实现细节

---

## ✅ 正确的设计 (当前实现)

```typescript
// ✅ Core/ 只抽象 AI 执行流程
export interface AgentCore {
  execute(): AsyncGenerator<SidecarStreamEvent>
  abort(): void
  createSession(): Promise<Session>
  listTools(): ToolInfo[]
  // ... AI 执行相关的接口
}

// ✅ Sidecar/handlers/ 直接处理数据管理
export function registerAgentHandlers(server: ServerLike): void {
  server.registerMethod('createAgent', async (params) => {
    return createAgent(params)  // ← 直接实现,不经过 AgentCore
  })
}
```

---

## 📝 总结

### 你的理解需要调整的地方

**之前的理解**:
> "Sidecar 不负责具体数据处理"

**更精确的理解**:
> "Sidecar 的**协议核心层** (JsonRpcServer, StreamHandler) 不处理业务逻辑,但 **Sidecar 的 handlers 层** 直接处理 Agent/Skill/Checkpoint 等数据管理操作"

### 为什么这样设计?

1. **职责分离**:
   - 协议核心层: 专注 JSON-RPC 和流式传输
   - Handlers 层: 专注数据管理和业务逻辑
   - Core 层: 专注 AI 执行流程抽象

2. **避免不必要的抽象**:
   - Agent/Skill 管理不需要 QueryEngine
   - 不需要流式输出
   - 直接操作文件即可

3. **复用 CLI 系统**:
   - Handlers 直接调用 CLI 的加载系统
   - 保持与 CLI 行为一致
   - 避免重复实现

4. **保持 Core/ 的纯粹性**:
   - Core/ 只抽象 AI 执行流程
   - 不混入文件管理逻辑
   - 便于测试和维护

### 类比理解

```
Sidecar/ ≈ 完整的 Web 服务器
├── Nginx (协议核心层)
│   └── 负责 HTTP 协议解析、路由
│   └── 不处理业务逻辑
│
└── PHP/Node.js (Handlers 层)
    └── 负责具体业务逻辑
    └── 数据库操作、文件读写

Core/ ≈ 微服务中的 AI 服务
└── 专门负责 AI 推理
└── 被 Web 服务器调用
```

**完整架构图**:

```
前端 (React)
    ↓ Tauri IPC
Rust 后端
    ↓ JSON-RPC
Sidecar/
├── 协议核心层 (JsonRpcServer)
│   └── 路由请求到对应 handler
│
├── Handlers 层 (业务逻辑)
│   ├── agentHandler    ← 直接处理 Agent 数据
│   ├── skillHandler    ← 直接处理 Skill 数据
│   ├── sessionHandler  ← 直接处理会话数据
│   └── ...
│
└── 调用
    ↓
    Core/ (AgentCore)
    └── 只处理 AI 执行流程
        └── QueryEngine
            └── Anthropic API
```

---

**文档生成时间**: 2026-04-09  
**基于代码**: claude-code/src/sidecar/handlers/*.ts
