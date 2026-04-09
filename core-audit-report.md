# Core/ 抽象层对接错误全面审查报告

## 审查概述

**审查目标**: 全面检查 `core/` 抽象层与底层 CLI 原始调用之间的偏差和对接错误

**审查范围**:
- `core/AgentCore.ts` - 核心接口实现
- `core/StateManager.ts` - 状态管理
- `core/ToolRegistry.ts` - 工具注册
- `core/PermissionEngine.ts` - 权限引擎
- `core/transport/*` - 传输层
- 对比原始 CLI 实现: `QueryEngine.ts`, `useCanUseTool.tsx`, `permissions.ts`

**审查时间**: 2026-04-09

---

## 🔴 严重问题 (Critical)

### 1. `canUseTool` 函数签名不匹配

**位置**: `core/AgentCore.ts:609-696`

**问题描述**:
```typescript
// core/AgentCore.ts 实现 (简化签名)
return async (tool: any, input: any, _context: any): Promise<any> => {
  // ...
  return { behavior: 'allow', updatedInput: input }
}
```

**原始 CLI 签名** (`src/hooks/useCanUseTool.tsx:44-53`):
```typescript
export type CanUseToolFn = (
  tool: ToolType,
  input: Input,
  toolUseContext: ToolUseContext,        // ← 缺失
  assistantMessage: AssistantMessage,     // ← 缺失
  toolUseID: string,                      // ← 缺失
  forceDecision?: PermissionDecision<Input>, // ← 缺失
) => Promise<PermissionDecision<Input>>
```

**影响分析**:
1. **缺少 `toolUseContext`**: 原始实现通过 `toolUseContext.getAppState()` 获取完整应用状态,core 实现绕过了这个机制
2. **缺少 `assistantMessage`**: 无法获取当前助手消息的元数据(如 uuid、时间戳等)
3. **缺少 `toolUseID`**: 原始实现用此 ID 追踪权限决策,core 实现使用 `${toolName}-${Date.now()}` 生成,可能导致:
   - 权限回调无法正确关联到具体工具调用
   - 前端无法精确追踪哪个工具调用被授权/拒绝
4. **缺少 `forceDecision`**: 无法强制应用特定权限决策(调试/测试场景)

**原始实现的关键用法**:
- `toolUseContext.getAppState()` - 获取完整 AppState
- `tool.description()` - 生成工具描述(需要 toolUseContext.options)
- 权限日志追踪 - 使用 toolUseID 关联决策
- 分类器批准追踪 - `setYoloClassifierApproval(toolUseID, ...)`
- AbortController 检查 - `ctx.resolveIfAborted(resolve)`

**修复建议**:
```typescript
// 应该实现完整签名
private buildCanUseToolFn(permissionEngine: PermissionEngine) {
  return async (
    tool: any,
    input: any,
    toolUseContext: any,
    assistantMessage: any,
    toolUseID: string,
    forceDecision?: any
  ): Promise<any> => {
    // 如果存在强制决策,直接使用
    if (forceDecision) {
      return forceDecision
    }

    // 使用 toolUseContext 获取完整状态
    const appState = toolUseContext.getAppState()
    // ... 其他逻辑
  }
}
```

**严重程度**: 🔴 Critical - 可能导致权限追踪失效、工具描述不准确、调试困难

---

### 2. `PermissionDecision` 返回类型不匹配

**位置**: `core/AgentCore.ts:609-696`

**问题描述**:
```typescript
// core/AgentCore.ts 返回
return { behavior: 'allow', updatedInput: input }
return { behavior: 'deny', message: '...' }
```

**原始类型定义** (`src/utils/permissions/PermissionResult.ts`):
```typescript
export interface PermissionDecision<Input = Record<string, unknown>> {
  behavior: 'allow' | 'deny' | 'ask'
  updatedInput?: Input
  message?: string
  decisionReason?: DecisionReason  // ← 缺失
  // ... 其他字段
}
```

**缺失的关键字段**:
1. `decisionReason`: 原始实现记录决策原因(规则匹配、分类器、用户决策等)
   - `{ type: 'rule', ... }` - 规则匹配
   - `{ type: 'classifier', ... }` - AI 分类器
   - `{ type: 'user', ... }` - 用户手动决策
   - 用于审计和 UI 展示

2. 原始实现的完整返回:
```typescript
ctx.buildAllow(result.updatedInput ?? input, {
  decisionReason: result.decisionReason,
})
```

**影响**:
- 前端无法展示权限决策的原因
- 审计日志不完整
- 调试时无法追踪决策来源

**修复建议**:
```typescript
return {
  behavior: 'allow',
  updatedInput: input,
  decisionReason: {
    type: 'rule',
    source: engineDecision.source,
    // ... 详细原因
  }
}
```

**严重程度**: 🔴 Critical - 决策追踪和审计能力缺失

---

### 3. `mapSDKMessageToStreamEvent` 消息映射不完整

**位置**: `core/AgentCore.ts:707-788`

**问题描述**:

**问题 3.1**: Assistant 消息只返回第一个内容块
```typescript
// 当前实现
for (const block of content) {
  if (block.type === 'text') {
    return { type: 'text', content: block.text ?? '' }  // ← 只返回第一个
  }
  // ...
}
```

**原始 SDKMessage 结构**:
- assistant 消息可包含多个 content blocks: `[text, tool_use, thinking, tool_use, text]`
- 每个 block 都应作为独立事件 yield
- 当前实现丢失了同一消息中的后续 blocks

**问题 3.2**: `tool_result` 缺少 `toolName`
```typescript
// 当前实现
return {
  type: 'tool_result',
  id: block.tool_use_id,
  toolName: '',  // ← 硬编码空字符串!
  result: block.content,
  isError: block.is_error ?? false,
}
```

**问题 3.3**: 缺少重要消息类型
- `compact_boundary` - 上下文压缩边界事件
- `stream_request_start` - 流请求开始(虽然注释说不转发,但可能需要)
- `error_during_execution` 的详细诊断信息

**影响**:
- 前端无法正确显示工具调用结果的工具名称
- 多内容块的消息被截断
- 上下文压缩事件丢失,前端无法显示优化提示

**修复建议**:
```typescript
// 应该逐块 yield,而非只返回第一个
case 'assistant': {
  const content = sdkMsg.message?.content
  if (!Array.isArray(content)) return null

  const events: SidecarStreamEvent[] = []
  for (const block of content) {
    if (block.type === 'text') {
      events.push({ type: 'text', content: block.text ?? '' })
    } else if (block.type === 'tool_use') {
      events.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input ?? {},
      })
    }
    // ...
  }
  // 需要修改为返回 events 数组或多次 yield
  return events
}
```

对于 tool_result,需要从会话历史中查找对应的 tool_use 来获取 toolName:
```typescript
// 通过 tool_use_id 在 mutableMessages 中查找对应的 tool_use block
const toolUseBlock = this.findToolUseById(block.tool_use_id)
return {
  type: 'tool_result',
  id: block.tool_use_id,
  toolName: toolUseBlock?.name ?? '',
  result: block.content,
  isError: block.is_error ?? false,
}
```

**严重程度**: 🔴 Critical - 数据丢失,前端显示不正确

---

### 4. `execute` 完成事件 reason 硬编码

**位置**: `core/AgentCore.ts:378-389`

**问题描述**:
```typescript
// 当前实现 - 总是返回 'completed'
yield {
  type: 'complete',
  reason: 'completed',  // ← 硬编码!
  usage: { ... }
}
```

**原始实现** (`QueryEngine.ts` 末尾):
```typescript
yield {
  type: 'result',
  subtype: 'success',
  stop_reason: lastStopReason,  // ← 来自 API 的实际停止原因
  // ...
}

// 或错误情况
yield {
  type: 'result',
  subtype: 'error_during_execution',
  stop_reason: lastStopReason,
  errors: [...],
  // ...
}
```

**可能的 `stop_reason` 值**:
- `end_turn` - 正常完成
- `max_tokens` - 达到 token 限制
- `stop_sequence` - 遇到停止序列
- `tool_use` - 工具使用未完成
- 等等

**影响**:
- 前端无法区分正常完成和异常情况
- 无法显示正确的结束原因
- 错误处理逻辑无法根据原因采取不同策略

**修复建议**:
需要跟踪 `lastStopReason` 并在 complete 事件中传递:
```typescript
let lastStopReason = 'completed'

for await (const sdkMsg of engine.submitMessage(content, {...})) {
  const event = this.mapSDKMessageToStreamEvent(sdkMsg)
  if (event?.type === 'complete') {
    lastStopReason = event.reason
  }
  if (event) yield event
}

yield {
  type: 'complete',
  reason: lastStopReason,
  usage: { ... }
}
```

**严重程度**: 🔴 Critical - 无法正确反馈执行结果状态

---

## 🟡 重要问题 (High)

### 5. `ToolRegistry.fromBuiltins()` 未使用 `fromSidecarSafeBuiltins()`

**位置**: `core/AgentCore.ts` 工厂函数

**问题描述**:
```typescript
// 当前实现 - 未创建 ToolRegistry!
const toolRegistry =
  depsOverride?.toolRegistry ?? new ToolRegistry()  // ← 空注册表
```

**预期行为**:
应该调用 `ToolRegistry.fromSidecarSafeBuiltins()` 加载安全的内置工具:
```typescript
const toolRegistry =
  depsOverride?.toolRegistry ?? await ToolRegistry.fromSidecarSafeBuiltins()
```

**影响**:
- Sidecar 模式下没有任何工具可用
- 除非手动通过 `depsOverride` 注入

**严重程度**: 🟡 High - 工具系统完全失效

---

### 6. `StateManager.buildMinimalAppState()` 缺少关键字段

**位置**: `core/StateManager.ts:416-458`

**问题描述**:

**缺失字段**:
```typescript
private buildMinimalAppState(): AppStateAny {
  return {
    toolPermissionContext: { ... },
    mcp: { ... },
    verbose: false,
    mainLoopModel: null,
    mainLoopModelForSession: null,
    settings: {},
    tasks: {},
    agentNameRegistry: new Map(),
    plugins: { ... },
    fileHistory: { enabled: false, snapshots: new Map() },
    attribution: { commits: [], isTracking: false },
    effortValue: undefined,
    advisorModel: undefined,
    fastMode: undefined,
    // 缺失:
    // - sessionId ← QueryEngine 需要
    // - modelUsage ← 使用量统计
    // - getTotalCost ← 费用计算
    // - getInMemoryErrors ← 错误日志
  }
}
```

**QueryEngine 实际访问的字段** (从 `QueryEngine.ts` 扫描):
- `getSessionId()` - 需要 sessionId
- `getTotalCost()` - 费用追踪
- `getInMemoryErrors()` - 错误日志
- `modelUsage` - 模型使用量

**影响**:
- QueryEngine 可能在运行时访问未定义字段导致错误
- 某些功能(如费用追踪、错误诊断)失效

**修复建议**:
```typescript
private buildMinimalAppState(): AppStateAny {
  return {
    // ... 现有字段
    sessionId: this.coreState.sessionId,
    modelUsage: {},
    getTotalCost: () => this.coreState.totalCostUsd,
    getInMemoryErrors: () => [],
    // ...
  }
}
```

**严重程度**: 🟡 High - 可能导致运行时错误

---

### 7. 会话持久化消息格式不一致

**位置**: `core/AgentCore.ts:305-312, 367-376`

**问题描述**:

**用户消息格式**:
```typescript
const userMsg = {
  role: 'user' as const,
  content,
  created_at: new Date().toISOString(),
}
```

**助手消息格式**:
```typescript
const assistantMsg = {
  role: 'assistant' as const,
  content: assistantTextBuffer,
  created_at: new Date().toISOString(),
}
```

**原始 SDK 消息格式** (从 `QueryEngine.ts` 和 sessionStorage):
```typescript
// 实际格式更复杂
{
  type: 'user' | 'assistant',
  message: {
    role: 'user' | 'assistant',
    content: ContentBlock[],  // ← 是数组,不是字符串!
    uuid: string,
    // ...
  },
  session_id: string,
  created_at: string,
}
```

**影响**:
- 持久化的消息可能无法被原始 sessionStorage 正确读取
- 会话恢复时格式不匹配
- 与 CLI 模式的会话不兼容

**修复建议**:
使用 SDK 标准格式:
```typescript
const { randomUUID } = await import('crypto')
const userMsg = {
  type: 'user' as const,
  message: {
    role: 'user' as const,
    content: [{ type: 'text', text: content }],
    uuid: randomUUID(),
  },
  session_id: this.activeSessionId,
  created_at: new Date().toISOString(),
}
```

**严重程度**: 🟡 High - 会话持久化可能损坏

---

### 8. PermissionEngine 的 glob 匹配实现简化

**位置**: `core/PermissionEngine.ts:331-345`

**问题描述**:
```typescript
// 当前简化实现
private globMatch(pattern: string, target: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§DOUBLESTAR§')
    .replace(/\*/g, '[^/]*')
    .replace(/§DOUBLESTAR§/g, '.*')

  return new RegExp(`^${regexStr}$`).test(target)
}
```

**原始实现** (`src/utils/permissions/pathValidation.ts`):
- 使用 `micromatch` 库进行 glob 匹配
- 支持更复杂的模式: `{a,b}`, `?`, `[abc]`, `!(pattern)` 等
- 处理路径边界情况(Windows/Unix 路径分隔符)

**影响**:
- 复杂的 glob 规则可能匹配失败
- 与 CLI 模式的权限规则行为不一致
- 用户配置的精细权限规则可能失效

**修复建议**:
```typescript
// 懒加载 micromatch
private matchesPattern(pattern: string, target: string): boolean {
  if (!this.matchPattern) {
    const micromatch = require('micromatch')
    this.matchPattern = (p, t) => micromatch.isMatch(t, p)
  }
  return this.matchPattern(pattern, target)
}
```

**严重程度**: 🟡 High - 权限规则匹配不准确

---

### 9. `execute` 每次都创建新的 QueryEngine 实例

**位置**: `core/AgentCore.ts:350`

**问题描述**:
```typescript
// 每次 execute 都创建新实例
const engine = new QueryEngine(engineConfig)
for await (const sdkMsg of engine.submitMessage(content, {...})) {
  // ...
}
```

**原始 CLI 行为**:
- 一个会话使用同一个 QueryEngine 实例
- `mutableMessages` 在多次 `submitMessage` 调用间保持
- 保持上下文连续性

**当前实现的问题**:
- 虽然传入了 `getAppState/setAppState`,但 QueryEngine 内部的 `mutableMessages` 是新的
- 上下文应该通过 `StateManager` 管理,但需要确保正确传递历史消息

**需要验证**:
1. `StateManager.buildAppStateAccessor()` 是否正确维护了消息历史?
2. QueryEngine 的 `mutableMessages` 初始值从何而来?

**查看 QueryEngine 构造函数**:
```typescript
constructor(config: QueryEngineConfig) {
  this.config = config
  this.mutableMessages = config.initialMessages ?? []  // ← 默认空数组!
}
```

**影响**:
- 如果 `initialMessages` 未提供,每次 execute 都是全新对话
- 多轮对话的上下文丢失

**修复建议**:
需要在 `engineConfig` 中提供 `initialMessages`:
```typescript
const engineConfig = {
  // ...
  initialMessages: stateManager.getMessageHistory(),  // ← 需要从 StateManager 获取
  // ...
}
```

**严重程度**: 🟡 High - 多轮对话上下文可能丢失

---

### 10. 缺少 MCP 工具支持

**位置**: `core/AgentCore.ts:334`

**问题描述**:
```typescript
const engineConfig = {
  // ...
  mcpClients: [],  // ← 硬编码空数组
  // ...
}
```

**原始 CLI 实现**:
- MCP 客户端在初始化时连接
- MCP 工具动态注册到工具列表
- `AppState.mcp` 管理 MCP 状态

**当前实现**:
- `ToolRegistry` 虽然支持 MCP 工具注册(`register` 方法)
- 但 `execute` 时未提供任何 MCP 客户端
- MCP 工具即使注册了也无法使用

**影响**:
- 桌面应用无法使用 MCP 服务器扩展
- 与 CLI 功能不对等

**修复建议**:
1. 在 `AgentCore.initialize()` 中初始化 MCP 客户端
2. 将 MCP 客户端传入 `engineConfig`
3. 动态注册 MCP 工具到 `ToolRegistry`

**严重程度**: 🟡 High - 功能缺失

---

## 🟢 次要问题 (Medium)

### 11. `abort()` 使用硬编码消息

**位置**: `core/AgentCore.ts:402`

```typescript
this.abortController.abort('user_abort')
```

**原始实现**: 可能使用 `AbortError` 对象而非字符串

**影响**: 较小,但可能导致错误处理路径不同

---

### 12. `listTools()` 的 description 始终为空

**位置**: `core/AgentCore.ts:524`

```typescript
listTools(): ToolInfo[] {
  return this.deps.toolRegistry.list().map((tool: any) => ({
    name: tool.name,
    description: '',  // ← 注释说 Tool.prompt() 是 async 的
    // ...
  }))
}
```

**问题**:
- 前端无法显示工具描述
- 虽然是 async,但可以预加载或懒加载

**修复建议**:
```typescript
// 在 ToolRegistry 中缓存 description
private toolDescriptions: Map<string, string> = new Map()

async preloadToolDescriptions(): Promise<void> {
  for (const tool of this.tools.values()) {
    try {
      const desc = await tool.description?.({}, {...})
      this.toolDescriptions.set(tool.name, desc ?? '')
    } catch {
      this.toolDescriptions.set(tool.name, '')
    }
  }
}
```

**严重程度**: 🟢 Medium - 影响用户体验

---

### 13. 权限模式映射不完整

**位置**: `core/AgentCore.ts:182-210`

```typescript
const mapping: Record<CorePermissionMode, string> = {
  'interactive': 'default',
  'auto-approve': 'acceptEdits',
  'plan-only': 'plan',
  'deny-all': 'dontAsk',  // ← 可能不正确
}
```

**原始内部模式** (注释中提到):
```
'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk' | 'auto' | 'bubble'
```

**问题**:
- `deny-all` → `dontAsk` 可能不对
- 可能需要 `bypassPermissions` 的特殊处理
- 反向映射中 `bubble` 模式缺失

**严重程度**: 🟢 Medium - 权限模式可能有边缘情况

---

### 14. 缺少错误日志和指标收集

**位置**: 全局

**原始 CLI 实现**:
- `logEvent()` - 分析事件
- `logError()` - 错误日志
- `logForDebugging()` - 调试日志
- 权限决策日志

**当前 core/ 实现**:
- 仅有基本的 `console.error`
- 缺少结构化日志
- 无分析事件

**影响**:
- 生产环境问题难以诊断
- 无法收集使用指标

**严重程度**: 🟢 Medium - 可观测性不足

---

## ✅ 正确实现的部分

1. ✅ **懒加载策略** - 正确使用 `require()` 避免循环依赖
2. ✅ **状态管理架构** - `StateManager` 的观察者模式设计合理
3. ✅ **传输层抽象** - `Transport` 接口统一 CLI 和 Sidecar
4. ✅ **权限引擎基础** - 规则评估逻辑正确
5. ✅ **工具注册表** - `ToolRegistry` 的别名和支持方法完善
6. ✅ **类型定义** - `core/types.ts` 清晰且独立于 UI

---

## 📋 修复优先级

### P0 - 必须立即修复 (阻塞功能)
1. ✅ 修复 `canUseTool` 签名不匹配 (问题 #1)
2. ✅ 修复工具注册表未加载内置工具 (问题 #5)
3. ✅ 修复多轮对话上下文丢失 (问题 #9)

### P1 - 高优先级 (影响核心功能)
4. 修复消息映射不完整 (问题 #3)
5. 修复完成事件 reason 硬编码 (问题 #4)
6. 修复 PermissionDecision 类型不匹配 (问题 #2)
7. 补充 StateManager 缺失字段 (问题 #6)

### P2 - 中优先级 (影响体验)
8. 修复会话持久化格式 (问题 #7)
9. 改进 glob 匹配实现 (问题 #8)
10. 添加 MCP 工具支持 (问题 #10)

### P3 - 低优先级 (优化改进)
11. 预加载工具描述 (问题 #12)
12. 完善权限模式映射 (问题 #13)
13. 添加错误日志和指标 (问题 #14)

---

## 🔧 建议的重构方案

### 方案 1: 渐进式修复 (推荐)

**优点**:
- 风险低,可逐步验证
- 每个修复独立测试
- 不阻塞现有开发

**步骤**:
1. 先修复 P0 问题 (canUseTool 签名、工具加载、消息历史)
2. 补充完整的消息映射和完成事件
3. 添加缺失的 StateManager 字段
4. 逐步优化其他问题

### 方案 2: 对齐 CLI 实现

**优点**:
- 完全对齐 CLI 行为
- 长期维护成本低

**缺点**:
- 工作量大
- 需要深入理解 CLI 所有边缘情况

**步骤**:
1. 提取 CLI 的核心逻辑为纯函数
2. core/ 直接复用这些纯函数
3. 仅处理 UI 相关的适配

---

## 📊 测试建议

### 单元测试
1. **权限引擎测试**:
   - 各种权限模式的决策
   - glob 模式匹配准确性
   - 会话缓存行为

2. **消息映射测试**:
   - 所有 SDKMessage 类型的转换
   - 多 content block 的处理
   - tool_result 的 toolName 查找

3. **状态管理测试**:
   - CoreState 和 AppState 的双向同步
   - 观察者模式正确性

### 集成测试
1. **端到端执行测试**:
   - 完整 execute 流程
   - 多轮对话上下文保持
   - 工具调用和权限请求

2. **CLI vs Sidecar 对比测试**:
   - 相同输入,验证输出一致
   - 权限决策一致
   - 工具列表一致

---

## 📝 结论

`core/` 抽象层的架构设计合理,但存在 **14 个问题**,其中:
- 🔴 4 个严重问题 (可能引起功能失效)
- 🟡 6 个重要问题 (影响核心功能)
- 🟢 4 个次要问题 (体验优化)

**最关键的问题**:
1. `canUseTool` 签名缺失 4 个参数
2. 工具注册表未加载内置工具
3. 消息映射丢失数据
4. 多轮对话上下文可能丢失

**建议立即修复 P0 问题**,然后按优先级逐步完善。这些问题修复后,core/ 抽象层才能真正做到与 CLI 行为对齐。

---

**审查人**: AI Agent
**审查日期**: 2026-04-09
**下次审查**: 修复完成后进行复审
