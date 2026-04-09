# Sidecar 层双端对接全面审查报告

## 审查概述

**审查目标**: 全面检查 Sidecar 中间层的两端对接完整性和正确性
- **下端**: Sidecar → 底层核心能力（AI 推理、工具执行、权限控制、会话管理等）
- **上端**: 前端 → Sidecar（通过 Tauri/Rust IPC 桥接）

**审查范围**:
- Sidecar: `claude-code/src/sidecar/` (jsonRpcServer.ts + handlers/* + storage/*)
- 底层: `claude-code/src/core/AgentCore.ts`, `QueryEngine.ts`, tools, services
- 前端: `frontend/src/api/tauri-api.ts`, hooks, stores, components
- Rust IPC: `frontend/src-tauri/src/` (lib.rs, ipc/bridge.rs, ipc/types.rs)

**审查时间**: 2026-04-09

---

## 问题总览

| 级别 | 数量 | 描述 |
|------|------|------|
| 🔴 Critical | 5 | 功能失效或数据丢失风险 |
| 🟡 High | 16 | 影响核心功能或可靠性 |
| 🟢 Medium | 3 | 体验或可维护性改进 |

---

## 一、Sidecar → 底层核心能力对接

### 🔴 Critical

#### S1. deleteSession 调用错误的会话

**位置**: `sidecar/handlers/sessionHandler.ts:206-225`

**问题描述**:
```typescript
async (params: unknown): Promise<DeleteSessionResult> => {
  const { sessionId } = DeleteSessionParamsSchema.parse(params)
  const session = await agentCore.getSession(sessionId)
  if (!session) return { deleted: false }

  await agentCore.clearSession()  // ← 清空的是"当前活跃会话"，不是 sessionId 指定的会话
  return { deleted: true }
}
```

**根本原因**: `agentCore.clearSession()` 无参数，总是清空当前活跃会话。如果用户删除会话 A，但当前活跃会话是 B，则 B 被错误清空。

**影响**: 严重数据丢失风险

**修复建议**:
- 方案 A: AgentCore 新增 `deleteSession(sessionId)` 方法
- 方案 B: 先 `switchSession(sessionId)` 再 `clearSession()`

---

#### S2. Agent/Skill CRUD 完全绕过 AgentCore

**位置**: `sidecar/handlers/agentHandler.ts:242-287`, `skillHandler.ts:164-220`

**问题描述**:
Agent 和 Skill 的读写操作直接调用 CLI 文件系统函数（如 `getAgentDefinitionsWithOverrides(cwd)`, `getSkillDirCommands()`），完全不经过 AgentCore。

**核心疑问**:
1. `execute(content, { agentId })` 中的 agentId 如何加载对应 agent 配置？
2. AgentCore 内部的 agent 加载逻辑（`loadAgentSkills`）与 Sidecar handler 的 agent 读取是独立的两套代码
3. 用户通过 Sidecar 创建/修改 Agent 后，execute() 是否能感知到变化？

**影响**: Agent 配置修改后可能不生效、执行时使用过期的 agent 定义

---

#### S3. MCP 管理 API 完全缺失

**位置**: `sidecar/` 目录

**问题描述**:
AgentCore 已有 `setMcpClients()` 方法，但 Sidecar 未暴露任何 MCP 相关的 RPC 方法：
- 无法列出已连接的 MCP 服务器
- 无法动态连接/断开 MCP 服务器
- 无法查询 MCP 工具列表
- 无法配置 MCP 连接参数

**影响**: 桌面应用无法管理 MCP 扩展

---

#### S4. Checkpoint 回滚只清空不恢复

**位置**: `sidecar/handlers/checkpointHandler.ts:332-356`

**问题描述**:
```typescript
// 注释明确指出"简化实现"
await agentCore.clearSession()  // ← 仅清空，不恢复 checkpoint 中的消息
```

回滚操作应该将 checkpoint 中保存的消息注入到会话中恢复状态，但当前实现只清空会话。

**影响**: 用户执行回滚后丢失所有会话数据

---

#### S5. AgentCore 多个能力未在 Sidecar 暴露

**位置**: `sidecar/jsonRpcServer.ts`

| AgentCore 方法 | Sidecar RPC | 状态 |
|---------------|-------------|------|
| `resetConversation()` | 无 | 🔴 未暴露 |
| `isToolEnabled(name)` | 无 | 🔴 未暴露 |
| `getState()` | 无 | 🔴 未暴露 |
| `onStateChange(cb)` | 无 | 🔴 未暴露 |
| `setMcpClients(clients)` | 无 | 🔴 未暴露 |

**影响**: 前端无法重置对话、查询工具状态、订阅状态变化

---

### 🟡 High

#### S6. 流式执行 ack 后无失败通知

**位置**: `sidecar/jsonRpcServer.ts:458-483`

Client 收到 `{ executeId, status: 'accepted' }` 后开始监听流事件，但如果 `runExecuteStream()` 启动失败，仅在 catch 中打印日志，client 永远收不到失败通知。

---

#### S7. 中止流的竞态条件

**位置**: `sidecar/streamHandler.ts:333-345`

流可能在 `abort()` 执行期间自然完成，导致 `$/streamError` 和 `$/complete` 同时发送、双重清理。

---

#### S8. executeOptions.agentId 形同虚设

**位置**: `sidecar/jsonRpcServer.ts:105-106`

Schema 定义了 `agentId` 参数，handleExecute 也传递给 AgentCore.execute()，但需要确认 AgentCore 是否真正使用了这个参数来动态切换 agent 行为。

---

#### S9. PermissionDecision 缺少 decisionReason

**位置**: `sidecar/permissionBridge.ts:142-146`

权限决策只传递 `granted/remember/denyReason`，缺少 `decisionReason` 字段（规则匹配、分类器、用户决策等），导致审计日志不完整。

---

#### S10. 权限超时无重试机制

**位置**: `sidecar/permissionBridge.ts:197-205`

超时后直接 reject，无重试或指数退避策略。网络延迟可能导致权限请求永久失败。

---

#### S11. Agent 记忆与 AgentCore 记忆系统不同步

**位置**: `sidecar/handlers/agentHandler.ts:300-318`

Sidecar 使用独立的文件系统读写 agent 记忆（`readAgentMemories()`），与 AgentCore 内部可能维护的记忆系统是两套代码，存在数据不一致风险。

---

#### S12. Cron 任务只处理 text 和 error 事件

**位置**: `sidecar/handlers/cronHandler.ts:351-359`

Cron 任务执行时只采集 `text` 和 `error` 两种事件，忽略了 `tool_use`、`tool_result`、`thinking` 等，导致执行历史不完整。

---

#### S13. SessionStorage 初始化但未被 handler 使用

**位置**: `sidecar/entry.ts:130-141`

SessionStorage 被创建并传给 AgentCore，但 sessionHandler 直接调用 `agentCore.getSession()` 而非 SessionStorage。不清楚进程重启后如何恢复已保存的会话列表。

---

#### S14. Checkpoint 消息快照可能包含不可序列化对象

**位置**: `sidecar/handlers/checkpointHandler.ts:299-318`

`session.messages` 直接作为 `unknown[]` 存入 checkpoint，`JSON.stringify()` 时可能失败。

---

#### S15. 配置验证不完整

**位置**: `sidecar/entry.ts:67-105`

API key 等关键配置没有提前验证，可能在 AgentCore 初始化时才失败，错误消息不友好。

---

#### S16. Skill 文件路径假设不可靠

**位置**: `sidecar/handlers/skillHandler.ts:330-342`

假设 skill 文件路径以 `.md` 结尾或包含 `SKILL.md` 子文件，但 MCP/bundled/plugin 来源的 skill 可能有不同的结构。

---

### 🟢 Medium

#### S17. 工具列表不支持过滤

**位置**: `sidecar/jsonRpcServer.ts:556-559`

`listTools()` 返回所有工具，无法按类别/权限过滤。

---

#### S18. Agent/Skill 缓存 TTL 过短

**位置**: `agentHandler.ts:107`, `skillHandler.ts:99`

5 秒缓存可能导致频繁文件 I/O，但也没有主动缓存失效机制。

---

## 二、前端 → Sidecar 对接

### 🔴 Critical

#### F1. 检查点事件后端完全缺失

**位置**: `frontend/src/api/tauri-api.ts:439-488`

前端定义了 `subscribeCheckpointEvents()` 函数监听 `checkpoint:events` 事件，但 Rust 后端（`ipc_bridge.rs` 和 `lib.rs`）中**没有任何代码 emit 这些事件**。

调用此函数的代码会永远挂起等待。

---

#### F2. MCP 管理界面完全缺失

前端没有任何 MCP 相关的 API 调用或管理界面。Sidecar 也未暴露 MCP RPC 方法（见 S3）。整条 MCP 管理链路断裂。

---

### 🟡 High

#### F3. Complete 事件类型定义与实现不一致

**位置**: `frontend/src/api/tauri-api.ts:143`, `frontend/src-tauri/src/agent/ipc_bridge.rs:310-327`

前端 `StreamEventPayload` 定义了 `type: "complete"` 类型，但 Rust IPC Bridge 处理 `$/complete` 消息时**只关闭 mpsc channel，不推送事件**。前端永远收不到 `complete` 类型事件，实际依赖 `done` 事件。

类型定义误导开发者。

---

#### F4. 权限超时不同步

**位置**: `frontend/src/components/chat/PermissionDialog.tsx:121-130`

前端权限对话框 60 秒超时自动拒绝，但 Sidecar 端超时是 300 秒。前端超时关闭对话框后，Sidecar 仍在等待响应，最终 Sidecar 侧也超时拒绝。存在 240 秒的"僵尸等待"期。

---

#### F5. 流式执行错误类型不区分

**位置**: `frontend/src/api/tauri-api.ts:243-249`

错误事件中有 `code` 字段但未使用，前端无法区分权限拒绝、执行失败、超时等不同错误类型，只能显示通用错误消息。

---

#### F6. 超时错误无专门处理

**位置**: `frontend/src/api/tauri-api.ts:85-116`

Rust IPC Bridge 设置 30 秒超时，超时错误作为 `IPC_ERROR` 返回，前端无法区分"IPC 通信失败"和"请求超时"。

---

#### F7. 多工作目录支持不完整

**位置**: `frontend/src/App.tsx:49-51`

```typescript
cwdToUse = workingDirs[0];  // 仅使用第一个目录
```

虽然 `appStore` 支持多目录，但启动 Sidecar 时只传第一个。

---

#### F8. getStats/getStatus 方法定义但未使用

**位置**: `frontend/src/api/tauri-api.ts:264-279`

定义了 `getStats()` 和 `getStatus()` 方法但前端代码中找不到调用，可能是遗留代码或功能遗漏。

---

### 🟢 Medium

#### F9. 权限决策 remember 逻辑不完善

当 `granted=false` 且 `remember=true` 时，应该记住"拒绝"决策，但当前实现的 `addRememberedDecision(tool, decision.granted)` 语义上正确但缺乏类型验证。

---

## 三、整体对接矩阵

| 功能域 | Sidecar→底层 | 前端→Sidecar | 整体状态 |
|--------|-------------|-------------|---------|
| 会话管理 | ⚠️ deleteSession 错误 | ✅ 完整 | 🟡 |
| 消息发送/流式 | ⚠️ 竞态/超时 | ⚠️ 类型不一致 | 🟡 |
| 工具系统 | ✅ 基本完整 | ✅ 完整 | 🟢 |
| 权限控制 | ⚠️ 缺 decisionReason | ⚠️ 超时不同步 | 🟡 |
| 配置管理 | ⚠️ 验证不足 | ✅ 完整 | 🟡 |
| MCP 集成 | 🔴 未暴露 API | 🔴 无界面 | 🔴 |
| Agent/Skills | ⚠️ 绕过 AgentCore | ✅ API 完整 | 🟡 |
| Checkpoints | 🔴 回滚不恢复 | 🔴 事件缺后端 | 🔴 |
| Cron 任务 | ⚠️ 事件处理不全 | ✅ 完整 | 🟡 |
| 健康检查 | ✅ 完整 | ✅ 完整 | 🟢 |

---

## 四、修复优先级

### P0 - 必须立即修复（数据安全/功能失效）
1. **S1**: deleteSession 调用错误的会话 — 数据丢失风险
2. **S4**: Checkpoint 回滚只清空不恢复 — 数据丢失风险
3. **S5**: AgentCore 多个能力未暴露 — 关键功能缺失

### P1 - 高优先级（核心功能受损）
4. **S6**: 流式执行 ack 后无失败通知
5. **S7**: 中止流的竞态条件
6. **S9**: PermissionDecision 缺 decisionReason
7. **S12**: Cron 任务事件处理不完整
8. **F1**: 检查点事件后端缺失
9. **F3**: Complete 事件类型不一致
10. **F4**: 权限超时不同步
11. **F5/F6**: 错误类型识别不足

### P2 - 中优先级（体验/可靠性）
12. **S2/S11**: Agent/Skill 与 AgentCore 集成关系（需架构决策）
13. **S3/F2**: MCP 管理（需产品决策）
14. **S10**: 权限重试机制
15. **S13**: SessionStorage 集成
16. **S14**: Checkpoint 序列化验证

### P3 - 低优先级（优化改进）
17. **S15/S16**: 配置验证、Skill 路径处理
18. **F7/F8/F9**: 多目录、未使用方法、类型验证
19. **S17/S18**: 工具过滤、缓存策略

---

## 五、架构建议

### 需要明确的架构决策

1. **Agent/Skill 数据流**: Sidecar handler 直接管理文件系统 vs 通过 AgentCore 协调？
   - 建议: CRUD 操作可以直接文件系统，但应在 execute() 前通知 AgentCore 刷新缓存

2. **记忆系统唯一性**: Agent 记忆应由 AgentCore 统一管理 vs 分散管理？
   - 建议: 统一由一个模块管理，避免数据不一致

3. **SessionStorage 职责**: 作为 AgentCore 内部实现细节 vs Sidecar handler 可直接访问？
   - 建议: AgentCore 封装 SessionStorage，提供完整的会话 CRUD API

---

**审查人**: AI Agent
**审查日期**: 2026-04-09
**下次审查**: P0 问题修复完成后进行复审
