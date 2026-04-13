# Sidecar/ 与 Core/ 架构关系深度解析

## 核心问题回答

**Q: `sidecar/` 是否也是抽象层？跟 `core/` 是什么关系？**

**A: `sidecar/` 不是抽象层，而是协议适配层和运行时基础设施。它与 `core/` 是消费者与被消费者的关系。**

---

## 📐 架构分层详解

### 完整的五层架构

```
┌─────────────────────────────────────────────────────────────────────┐
│  Layer 5: 前端应用层 (React + Tauri WebView)                         │
│  - UI 组件、状态管理、用户交互                                        │
│  - 调用: tauri.invoke() → Rust 后端                                  │
└────────────────────────┬────────────────────────────────────────────┘
                         │ Tauri IPC (命令 + 事件)
┌────────────────────────▼─────────────────────────────────────────────┐
│  Layer 4: Rust 桥接层 (frontend/src-tauri/)                          │
│  - 进程管理 (spawn/supervise Bun sidecar)                            │
│  - JSON-RPC 序列化/反序列化                                           │
│  - stdin/stdout 读写                                                 │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ JSON-RPC 2.0 over stdin/stdout (NDJSON)
┌────────────────────────▼─────────────────────────────────────────────┐
│  Layer 3: Sidecar 协议层 (claude-code/src/sidecar/) ← 协议适配层     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  JsonRpcServer      - JSON-RPC 请求路由和响应                 │    │
│  │  StreamHandler      - 流式事件转换和背压控制                  │    │
│  │  PermissionBridge   - 双向权限请求/响应桥接                   │    │
│  │  handlers/*         - 各功能域的 RPC 方法实现                 │    │
│  │  storage/*          - 会话/检查点持久化                       │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                        │ 调用                                        │
│  ┌─────────────────────▼───────────────────────────────────────┐    │
│  │  entry.ts           - Sidecar 进程启动入口                   │    │
│  │  - 读取环境变量配置                                          │    │
│  │  - 创建 AgentCore 实例                                      │    │
│  │  - 启动 JsonRpcServer                                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ 调用 AgentCore 接口
┌────────────────────────▼─────────────────────────────────────────────┐
│  Layer 2: Core 抽象层 (claude-code/src/core/) ← 统一抽象层           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  AgentCore          - 统一业务接口 (CLI + Sidecar 共享)       │    │
│  │  - execute()        - 执行查询                               │    │
│  │  - createSession()  - 会话管理                               │    │
│  │  - listTools()      - 工具查询                               │    │
│  │  - abort()          - 中断执行                               │    │
│  └─────────────────────┬───────────────────────────────────────┘    │
│                        │                                             │
│  ┌─────────────────────▼───────────────────────────────────────┐    │
│  │  Transport          - 通信接口抽象                           │    │
│  │  - DirectTransport  - CLI 模式直接使用                       │    │
│  │  - JsonRpcTransport - Sidecar 模式的客户端视图               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                        │                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  StateManager       - 状态管理 (替代 React useState)         │    │
│  │  ToolRegistry       - 工具注册和调度                         │    │
│  │  PermissionEngine   - 权限规则评估                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ 包装和调用
┌────────────────────────▼─────────────────────────────────────────────┐
│  Layer 1: 底层引擎层 (claude-code/src/)                               │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  QueryEngine        - 核心查询引擎                           │    │
│  │  - submitMessage()  - 提交消息并流式返回                     │    │
│  │  - 管理消息历史、工具调用、API 交互                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                        │                                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Tools              - 工具实现 (Bash, FileRead, etc.)        │    │
│  │  Agents             - Agent 定义和路由                       │    │
│  │  Skills             - 技能系统                               │    │
│  │  MCP                - MCP 服务器集成                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔍 逐层职责分析

### Layer 3: Sidecar 协议层 (`sidecar/`)

**定位**: **协议适配器 + 运行时基础设施**

**核心职责**:
1. **JSON-RPC 协议实现**
   - 解析 stdin 上的 NDJSON 消息
   - 路由到对应的 handler 方法
   - 序列化响应并写入 stdout
   - 处理请求/响应/通知三种消息类型

2. **流式传输管理**
   - 将 `AsyncGenerator<SidecarStreamEvent>` 转换为 `$/stream` notifications
   - 实现背压控制 (backpressure)
   - 管理活跃流的生命周期

3. **双向通信桥接**
   - `$/permissionRequest`: sidecar → host 请求权限决策
   - `permissionResponse`: host → sidecar 返回决策结果
   - 超时处理和错误恢复

4. **功能域 RPC Handlers**
   - `sessionHandler`: 会话管理 (create/get/list)
   - `checkpointHandler`: 检查点管理 (save/rollback/list)
   - `agentHandler`: Agent 管理 (CRUD + memory)
   - `skillHandler`: 技能管理 (CRUD + search)
   - `cronHandler`: 定时任务管理

5. **进程生命周期管理**
   - `entry.ts`: 读取环境变量、初始化、优雅关闭
   - SIGTERM/SIGINT 信号处理
   - 日志输出到 stderr (不干扰 stdout 协议)

**不做的事情**:
- ❌ 不包含业务逻辑 (调用 `core/` 实现)
- ❌ 不定义统一接口 (使用 `core/` 的接口)
- ❌ 不管理状态 (通过 `core/` 的状态访问器)
- ❌ 不评估权限规则 (通过 `core/PermissionEngine`)

**关键特征**:
```typescript
// sidecar/jsonRpcServer.ts - 协议层典型代码
class JsonRpcServer {
  private agentCore: AgentCore  // ← 依赖 core/ 的接口
  
  async handleRequest(request: JsonRpcRequest): Promise<void> {
    switch (request.method) {
      case 'execute':
        // 调用 core/ 的方法
        const generator = this.agentCore.execute(content, options)
        // 协议转换: AsyncGenerator → JSON-RPC notifications
        const streamHandler = new StreamHandler(this.writeLine.bind(this))
        await streamHandler.consume(executeId, generator)
        break
    }
  }
}
```

---

### Layer 2: Core 抽象层 (`core/`)

**定位**: **统一业务抽象 + CLI/Sidecar 共享接口**

**核心职责**:
1. **定义统一接口**
   - `AgentCore` 接口: CLI 和 Sidecar 都使用相同的业务接口
   - `Transport` 接口: 统一通信抽象 (Direct vs JsonRpc)
   - 类型定义: `SidecarStreamEvent`, `ExecuteOptions`, `CoreState` 等

2. **包装底层引擎**
   - 适配 `QueryEngine` (原始 CLI 的查询引擎)
   - 转换消息格式: `SDKMessage` → `SidecarStreamEvent`
   - 管理 QueryEngine 生命周期

3. **提供可注入的依赖**
   - `StateManager`: 替代 React 的 useState，提供状态管理
   - `ToolRegistry`: 工具注册和过滤
   - `PermissionEngine`: 权限规则评估

4. **解耦 UI 依赖**
   - 不导入 React/Ink/readline
   - 通过回调注入 UI 相关行为 (如 `onPermissionRequest`)
   - 可在 CLI 和 Sidecar 两种模式下运行

**关键设计原则**:
```typescript
// core/AgentCore.ts - 抽象层典型代码
export interface AgentCore {
  // 统一的业务接口，不关心通信协议
  execute(content: string, options?: ExecuteOptions): 
    AsyncGenerator<SidecarStreamEvent>
  
  createSession(params?: SessionParams): Promise<Session>
  listTools(): ToolInfo[]
  abort(): void
}

// 两种模式的 Transport 都实现这个接口
export interface Transport {
  execute(content: string, options?: ExecuteOptions): 
    AsyncGenerator<SidecarStreamEvent>
  // ...
}

// CLI 模式: 直接调用
const directTransport = new DirectTransport(agentCore)

// Sidecar 模式: 通过 JSON-RPC
const jsonRpcTransport = new JsonRpcTransport()
```

---

## 🔄 Sidecar/ 与 Core/ 的关系

### 1. **依赖方向**

```
sidecar/ ──依赖──→ core/ ──依赖──→ 底层引擎 (QueryEngine, Tools, etc.)
```

**具体依赖**:
```typescript
// sidecar/entry.ts
import { createAgentCore } from '../core/AgentCore'  // ← 依赖 core/

// sidecar/jsonRpcServer.ts
import type { AgentCore } from '../core/AgentCore'    // ← 依赖 core/ 的接口
import type { ExecuteOptions, SessionParams } from '../core/types'

// sidecar/handlers/sessionHandler.ts
import type { AgentCore } from '../../core/AgentCore'
```

**反向依赖不存在**:
```typescript
// core/AgentCore.ts - 不依赖 sidecar/
import type { SessionStorage } from '../sidecar/storage/sessionStorage.js'
// ↑ 这个导入是可选的 (通过构造函数注入)，且仅用于持久化
// core/ 的核心逻辑不依赖 sidecar/
```

### 2. **数据流对比**

#### CLI 模式的数据流
```
用户输入 (readline)
    ↓
CLI UI (Ink/React)
    ↓
DirectTransport (core/transport/DirectTransport.ts)
    ↓
AgentCore.execute() (core/AgentCore.ts)
    ↓
QueryEngine.submitMessage() (底层引擎)
    ↓
AsyncGenerator<SidecarStreamEvent>
    ↓
DirectTransport 直接 yield
    ↓
CLI UI 渲染
```

#### Sidecar 模式的数据流
```
Tauri Host (Rust)
    ↓ stdin: JSON-RPC request
JsonRpcServer.handleRequest() (sidecar/jsonRpcServer.ts)
    ↓
解析 params, 验证 schema (Zod)
    ↓
AgentCore.execute() (core/AgentCore.ts)  ← 同一个接口!
    ↓
QueryEngine.submitMessage() (底层引擎)
    ↓
AsyncGenerator<SidecarStreamEvent>
    ↓
StreamHandler.consume() (sidecar/streamHandler.ts)
    ↓ stdout: JSON-RPC notifications ($/stream, $/complete)
Tauri Host (Rust)
```

**关键观察**: 
- `AgentCore.execute()` 在两种模式下是**同一个实现**
- 区别在于 Transport 层: CLI 用 `DirectTransport`, Sidecar 用 `JsonRpcServer + StreamHandler`

### 3. **职责边界**

| 职责 | Sidecar/ (协议层) | Core/ (抽象层) |
|------|------------------|---------------|
| **JSON-RPC 解析** | ✅ 负责 | ❌ 不涉及 |
| **NDJSON 读写** | ✅ 负责 | ❌ 不涉及 |
| **流式事件转换** | ✅ AsyncGenerator → Notifications | ❌ 只提供 AsyncGenerator |
| **背压控制** | ✅ 负责 stdout 背压 | ❌ 不涉及 |
| **权限双向通信** | ✅ 桥接 request/response | ❌ 只提供回调接口 |
| **业务逻辑** | ❌ 委托给 core/ | ✅ 实现核心逻辑 |
| **接口定义** | ❌ 使用 core/ 的接口 | ✅ 定义 AgentCore/Transport |
| **消息格式转换** | ❌ 不转换 | ✅ SDKMessage → SidecarStreamEvent |
| **状态管理** | ❌ 不管理 | ✅ StateManager |
| **权限评估** | ❌ 不评估 | ✅ PermissionEngine |
| **工具注册** | ❌ 不注册 | ✅ ToolRegistry |

### 4. **类比理解**

可以将两者类比为网络协议栈:

```
Sidecar/ ≈ TCP/IP 协议层
- 负责数据包的分段、重组、传输
- 不关心数据内容的业务含义
- 确保数据可靠传输

Core/ ≈ HTTP 应用层
- 定义请求/响应的语义 (GET, POST, etc.)
- 实现业务逻辑
- 不关心底层如何传输
```

或者类比为操作系统:

```
Sidecar/ ≈ 系统调用接口 (syscall)
- 提供进程间通信机制
- 管理 I/O 操作
- 不关心应用程序逻辑

Core/ ≈ 标准库 (libc)
- 提供高级抽象 (fopen, fprintf)
- 实现业务功能
- 可在不同 OS 上运行
```

---

## 🎯 为什么需要两层?

### 如果只有 Core/ (没有 Sidecar/)

```
问题:
- Core/ 需要直接处理 JSON-RPC 协议
- 混入 stdin/stdout 读写逻辑
- 无法在不修改 core/ 的情况下更换通信协议
- 违反了单一职责原则
```

### 如果只有 Sidecar/ (没有 Core/)

```
问题:
- CLI 模式无法复用 Sidecar 的逻辑
- 需要为 CLI 单独实现一套
- 无法统一两种模式的接口
- 代码重复，维护成本高
```

### 两层分离的优势

```
✅ 职责清晰:
   - Sidecar/ 专注协议和传输
   - Core/ 专注业务逻辑

✅ 可复用:
   - Core/ 可被 CLI 和 Sidecar 共享
   - Sidecar/ 可更换不同的底层实现

✅ 可测试:
   - Core/ 可独立单元测试 (不依赖 I/O)
   - Sidecar/ 可模拟 AgentCore 进行测试

✅ 可扩展:
   - 可添加新的 Transport (如 WebSocket, HTTP)
   - 可在不修改 sidecar/ 的情况下扩展 core/ 功能
```

---

## 📂 代码组织映射

### Sidecar/ 目录结构
```
sidecar/
├── entry.ts              # 进程启动入口 (运行时)
├── index.ts              # Barrel export
├── jsonRpcServer.ts      # JSON-RPC 协议核心 (协议)
├── streamHandler.ts      # 流式传输管理 (协议)
├── permissionBridge.ts   # 权限双向通信 (协议)
├── handlers/             # 各功能域的 RPC 方法 (协议)
│   ├── sessionHandler.ts
│   ├── checkpointHandler.ts
│   ├── agentHandler.ts
│   ├── skillHandler.ts
│   ├── cronHandler.ts
│   └── index.ts
└── storage/              # 持久化层 (基础设施)
    ├── sessionStorage.ts
    ├── checkpointStorage.ts
    └── index.ts
```

### Core/ 目录结构
```
core/
├── AgentCore.ts          # 统一业务接口 + 实现 (抽象)
├── types.ts              # 核心类型定义 (抽象)
├── StateManager.ts       # 状态管理 (抽象)
├── ToolRegistry.ts       # 工具注册 (抽象)
├── PermissionEngine.ts   # 权限评估 (抽象)
└── transport/            # 通信接口抽象 (抽象)
    ├── Transport.ts      # 统一接口
    ├── DirectTransport.ts
    └── JsonRpcTransport.ts
```

**观察**:
- `sidecar/` 包含**协议、运行时、基础设施**
- `core/` 包含**接口、抽象、业务逻辑**

---

## 🔧 实际代码示例

### 示例 1: Execute 方法的完整调用链

#### Sidecar 侧 (协议处理)
```typescript
// sidecar/jsonRpcServer.ts
private async handleExecute(params: unknown): Promise<void> {
  // 1. 解析和验证参数 (协议层职责)
  const parsed = ExecuteParamsSchema.safeParse(params)
  if (!parsed.success) {
    this.sendError(-32602, 'Invalid params')
    return
  }
  
  const { content, executeId, options } = parsed.data
  
  // 2. 调用 core/ 的方法 (不关心实现细节)
  const generator = this.agentCore.execute(content, options)
  
  // 3. 管理流式传输 (协议层职责)
  const streamHandler = new StreamHandler(this.writeLine.bind(this))
  const result = await streamHandler.consume(executeId, generator)
  
  // 4. 发送完成通知 (协议层职责)
  if (result.success) {
    this.sendNotification('$/complete', { executeId })
  } else {
    this.sendNotification('$/streamError', { 
      executeId, 
      message: result.errorMessage 
    })
  }
}
```

#### Core 侧 (业务逻辑)
```typescript
// core/AgentCore.ts
async *execute(
  content: string,
  options?: ExecuteOptions,
): AsyncGenerator<SidecarStreamEvent> {
  // 1. 构造 canUseTool 回调 (业务逻辑)
  const canUseTool = this.buildCanUseToolFn(permissionEngine)
  
  // 2. 构造 QueryEngine 配置 (业务逻辑)
  const engineConfig = {
    cwd: this.config.cwd,
    tools: toolRegistry.getEnabledTools(options?.allowedTools),
    canUseTool,
    getAppState,
    setAppState,
    // ...
  }
  
  // 3. 创建并调用 QueryEngine (业务逻辑)
  const engine = new QueryEngine(engineConfig)
  
  // 4. 转换消息格式 (业务逻辑)
  for await (const sdkMsg of engine.submitMessage(content, {...})) {
    const event = this.mapSDKMessageToStreamEvent(sdkMsg)
    if (event) yield event
  }
  
  // 5. 发送完成事件 (业务逻辑)
  yield { type: 'complete', reason: lastStopReason, usage }
}
```

### 示例 2: 权限请求的双向通信

#### Core 侧 (触发权限请求)
```typescript
// core/AgentCore.ts
private buildCanUseToolFn(permissionEngine: PermissionEngine) {
  return async (tool, input, toolUseContext, assistantMessage, toolUseID) => {
    // 1. 评估权限规则 (业务逻辑)
    const engineDecision = permissionEngine.evaluate(toolName, input)
    if (engineDecision !== null) {
      return engineDecision
    }
    
    // 2. 需要用户确认时，调用回调 (不关心回调如何实现)
    if (permMode === 'interactive' && this.onPermissionRequest) {
      const request: PermissionRequest = {
        requestId: `${toolName}-${Date.now()}`,
        tool: toolName,
        action: tool.userFacingName?.(input) ?? toolName,
        // ...
      }
      
      // 回调由外部注入 (sidecar 或 CLI 各自实现)
      const decision = await this.onPermissionRequest(request)
      return decision
    }
  }
}
```

#### Sidecar 侧 (实现权限桥接)
```typescript
// sidecar/permissionBridge.ts
createHandler(): (request: PermissionRequest) => Promise<PermissionDecision> {
  return async (request: PermissionRequest) => {
    // 1. 生成唯一的 JSON-RPC ID
    const rpcId = randomUUID()
    
    // 2. 发送权限请求到 host (协议层职责)
    const jsonRpcRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: rpcId,
      method: '$/permissionRequest',
      params: request,
    }
    this.writeLine(JSON.stringify(jsonRpcRequest))
    
    // 3. 等待 host 响应 (协议层职责)
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(rpcId, { resolve, reject, timeoutId })
      
      // 超时处理
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(rpcId)
        reject(new Error('权限请求超时'))
      }, this.timeoutMs)
    })
  }
}

// 当收到 host 的响应时
handleResponse(response: JsonRpcResponse): void {
  const pending = this.pendingRequests.get(response.id)
  if (pending) {
    clearTimeout(pending.timeoutId)
    this.pendingRequests.delete(response.id)
    
    // 解析并返回决策
    const decision = response.result as PermissionDecisionResult
    pending.resolve({
      granted: decision.granted,
      remember: decision.remember,
      denyReason: decision.denyReason,
    })
  }
}
```

#### 连接两者
```typescript
// sidecar/entry.ts
const permissionBridge = new PermissionBridge(writeLine, permissionTimeoutMs)

// 将权限桥接注入到 AgentCore
agentCore.onPermissionRequest = permissionBridge.createHandler()

// 当收到 host 的权限响应时
jsonRpcServer.onPermissionResponse((response) => {
  permissionBridge.handleResponse(response)
})
```

---

## 🎓 设计模式总结

### Sidecar/ 使用的模式

1. **适配器模式 (Adapter Pattern)**
   - 将 JSON-RPC 协议适配为 AgentCore 的方法调用
   - `JsonRpcServer` 是协议适配器

2. **桥接模式 (Bridge Pattern)**
   - `PermissionBridge` 桥接 AgentCore 和 Tauri Host
   - 解耦权限请求的发送和接收

3. **观察者模式 (Observer Pattern)**
   - `StreamHandler` 观察 AsyncGenerator 的事件流
   - `JsonRpcServer` 监听 stdin 的消息流

4. **策略模式 (Strategy Pattern)**
   - 不同的 handlers 实现不同的 RPC 方法策略
   - 可通过 `registerMethod()` 动态注册新策略

### Core/ 使用的模式

1. **抽象工厂模式 (Abstract Factory)**
   - `createAgentCore()` 创建一组相关对象 (AgentCore, StateManager, etc.)
   - 可替换不同的实现

2. **适配器模式 (Adapter Pattern)**
   - `AgentCore` 适配 `QueryEngine` 的接口
   - `Transport` 适配不同的通信方式

3. **依赖注入 (Dependency Injection)**
   - `AgentCoreDeps` 注入 StateManager, ToolRegistry, PermissionEngine
   - `onPermissionRequest` 回调注入 UI 行为

4. **观察者模式 (Observer Pattern)**
   - `StateManager` 的状态订阅机制
   - `onStateChange()` 注册监听器

---

## 📊 对比总结表

| 维度 | Sidecar/ (协议层) | Core/ (抽象层) |
|------|------------------|---------------|
| **抽象层级** | 低 (接近 I/O) | 高 (接近业务) |
| **职责** | 协议、传输、运行时 | 接口、业务逻辑 |
| **依赖方向** | → 依赖 core/ | → 依赖底层引擎 |
| **可替换性** | 可换协议 (HTTP/WebSocket) | 可换引擎 (不同 QueryEngine) |
| **测试方式** | 集成测试 (模拟 I/O) | 单元测试 (模拟依赖) |
| **与 CLI 关系** | Sidecar 独有 | CLI 和 Sidecar 共享 |
| **代码特征** | 大量 I/O、序列化、路由 | 纯逻辑、类型定义、接口 |
| **运行环境** | 仅 Sidecar 进程 | CLI 进程 + Sidecar 进程 |

---

## 🔮 未来扩展示例

### 场景 1: 添加 WebSocket 传输

只需添加新的 Transport 实现，**无需修改 core/**:

```typescript
// core/transport/WebSocketTransport.ts (新增)
export class WebSocketTransport implements Transport {
  private ws: WebSocket
  
  async execute(content: string, options?: ExecuteOptions) {
    // 通过 WebSocket 发送请求
    this.ws.send(JSON.stringify({ method: 'execute', params: {...} }))
    
    // 返回 AsyncGenerator (复用 core/ 的类型)
    return this.createGenerator()
  }
  
  // 实现 Transport 接口的其他方法...
}
```

Sidecar 可以继续存在，也可以被 WebSocket 服务替代。

### 场景 2: 替换 QueryEngine

只需修改 `core/AgentCore.ts` 的实现，**无需修改 sidecar/**:

```typescript
// core/AgentCore.ts
class AgentCoreImpl implements AgentCore {
  // 原来使用 QueryEngine
  // const engine = new QueryEngine(config)
  
  // 现在使用新的引擎
  const engine = new NewQueryEngine(config)
  
  // sidecar/ 完全不需要修改，因为它只依赖 AgentCore 接口
}
```

### 场景 3: 添加新的 RPC 方法

只需在 sidecar/ 添加 handler，**无需修改 core/**:

```typescript
// sidecar/handlers/newFeatureHandler.ts (新增)
export function registerNewFeatureHandlers(server: JsonRpcServer, agentCore: AgentCore) {
  server.registerMethod('newFeature', async (params) => {
    // 调用已有的 AgentCore 方法
    return await agentCore.someMethod(params)
  })
}

// sidecar/jsonRpcServer.ts
registerNewFeatureHandlers(this, this.agentCore)
```

---

## ✅ 验证和理解检查

### 如何验证你的理解?

回答以下问题，如果都能答对，说明理解了:

1. **Q**: Sidecar 模式下，`execute` 方法的完整调用链是什么?
   **A**: Rust → stdin → JsonRpcServer → AgentCore.execute → QueryEngine → AsyncGenerator → StreamHandler → stdout → Rust

2. **Q**: 如果要在 CLI 模式下使用，需要 sidecar/ 吗?
   **A**: 不需要。CLI 直接使用 `core/` 的 `DirectTransport` 调用 `AgentCore`。

3. **Q**: 如果更换 JSON-RPC 为 HTTP 协议，需要修改 core/ 吗?
   **A**: 不需要。只需在 sidecar/ 添加 HTTP 服务器，或创建新的 `HttpTransport` 实现 `Transport` 接口。

4. **Q**: `AgentCore.onPermissionRequest` 回调的作用是什么?
   **A**: 解耦权限请求的 UI 处理。CLI 注入 Ink 对话框，Sidecar 注入 `PermissionBridge` 发送 JSON-RPC 请求。

5. **Q**: 为什么说 core/ 是"抽象层"而 sidecar/ 是"协议层"?
   **A**: Core/ 定义统一的业务接口 (AgentCore)，屏蔽底层引擎差异; Sidecar/ 实现具体的通信协议 (JSON-RPC over stdin/stdout)。

---

## 📝 总结

### Sidecar/ 的定位

- ❌ **不是**抽象层
- ✅ **是**协议适配层和运行时基础设施
- ✅ **职责**: JSON-RPC 协议、流式传输、双向通信、进程管理
- ✅ **特征**: 处理 I/O、序列化、消息路由、背压控制

### Core/ 的定位

- ✅ **是**统一抽象层
- ✅ **职责**: 定义业务接口、包装底层引擎、解耦 UI 依赖
- ✅ **特征**: 纯逻辑、类型定义、依赖注入、状态管理
- ✅ **价值**: CLI 和 Sidecar 共享同一套业务逻辑

### 两者关系

```
Sidecar/ 消费 Core/ 的接口
    ↓
实现具体的通信协议
    ↓
为 Tauri Host 提供 JSON-RPC 服务
```

**类比**: 
- Core/ = 汽车引擎和传动系统 (提供动力)
- Sidecar/ = 变速箱和车轮 (将动力转化为运动)
- 两者配合才能让车跑起来，但职责完全不同。

---

**文档生成时间**: 2026-04-09  
**基于代码版本**: claude-code/src/core/* 和 claude-code/src/sidecar/*
