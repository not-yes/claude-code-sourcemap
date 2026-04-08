# Claude Code 桌面端实现方案

**创建日期**: 2026-04-07 10:30:00
**最后更新**: 2026-04-08 (v3.0)
**状态**: [DRAFT] 草稿

---

## 方案概述

采用 **Bun Sidecar + JSON-RPC IPC** 方案：将 Claude Code TS 源码改造为可编程库，打包为独立 Bun 进程，通过标准输入输出与 Tauri Rust 后端通信。

**核心特点**：保留 CLI 层开发模式，打包时通过 Bun 构建配置（`--define` + dead code elimination）移除 CLI 层，切换为 Sidecar 模式。

```
Tauri Desktop (Rust + React)
├── Rust 后端 (src-tauri/src/)
│   ├── AgentManager: 管理多 Bun 进程
│   ├── IPC Bridge: stdin/stdout JSON-RPC 处理
│   └── Event Emitter: 向前端推送流式数据
└── React 前端
    └── 监听 Tauri 事件总线，实时显示 ReAct 步骤

Bun Sidecar (Claude Code TS 源码)
├── 剥离 CLI 交互层 (ink/readline) - 构建时通过 dead code elimination 移除
├── 暴露 AgentCore 可编程接口
└── JSON-RPC 适配层 (stdio <-> 内部 API)
```

---

## 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri Desktop App                          │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                      React 前端                              │ │
│  │  ├── ChatWindow: 聊天消息展示                                 │ │
│  │  ├── ToolPanel: 工具调用显示                                 │ │
│  │  └── SettingsPanel: 设置面板                                  │ │
│  └──────────────────────────┬──────────────────────────────────┘ │
│                              │ Tauri EventEmitter                 │
│  ┌──────────────────────────┴──────────────────────────────────┐ │
│  │                      Rust 后端                              │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐  │ │
│  │  │  AgentManager   │  │  IPC Bridge     │  │EventEmitter │  │ │
│  │  │  (进程管理)      │  │  (JSON-RPC)     │  │  (事件推送)  │  │ │
│  │  └────────┬────────┘  └───────┬────────┘  └─────────────┘  │ │
│  │           │                   │                              │ │
│  │           │     ┌─────────────┘                              │ │
│  │           │     │                                            │ │
│  │           ▼     ▼                                            │ │
│  │  ┌─────────────────────────────────────────────────────┐    │ │
│  │  │              stdin / stdout (JSON-RPC)               │    │ │
│  │  └─────────────────────────────────────────────────────┘    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                              │                                      │
└──────────────────────────────│──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Bun Sidecar                                    │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Claude Code TS 源码                        │ │
│  │                                                              │ │
│  │   ┌───────────────┐         ┌───────────────────────────┐   │ │
│  │   │  CLI 入口层    │◄──────►│  AgentCore 可编程接口    │   │ │
│  │   │ (ink/readline) │         │  (构建时按模式保留/移除)  │   │ │
│  │   └───────────────┘         └───────────┬───────────────┘   │ │
│  │          ▲                                │                   │ │
│  │          │                                ▼                   │ │
│  │          │                   ┌───────────────────┐           │ │
│  │          │                   │  JSON-RPC 适配层   │           │ │
│  │          │                   │  (Sidecar 模式)   │           │ │
│  │          │                   └─────────┬─────────┘           │ │
│  │          │                              │                     │ │
│  │          │                       stdin/stdout                  │ │
│  └──────────┼──────────────────────────────┼─────────────────────┘ │
│             │                              │                       │
│  构建时 Bun --define 注入 SIDECAR_MODE ──────┘                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 双模式运行机制

| 模式 | 构建方式 | CLI 层 | 用途 |
|------|----------|--------|------|
| **CLI 模式** | 普通开发构建 | ✅ 完整启用 | 开发调试、终端使用 |
| **Sidecar 模式** | `bun build --define 'process.env.SIDECAR_MODE="true"'` | ❌ 构建时移除 | Tauri 桌面调用 |

### 运行时检测逻辑（构建时优化）

```typescript
// 构建时通过 Bun define 注入
// bun build --define 'process.env.SIDECAR_MODE="true"' --compile
// Bun 的 dead code elimination 会自动移除未使用的 CLI 分支代码
const isSidecar = process.env.SIDECAR_MODE === 'true';

if (isSidecar) {
  // Sidecar: JSON-RPC 服务（无 UI）
  import('./sidecar/server').then(m => m.startServer());
} else {
  // CLI: 正常 ink/readline 交互
  import('./cli/entry').then(m => m.startCli());
}
```

> **说明**：开发阶段两个分支均保留，便于联调。打包 App 时，通过 `bun build --compile --define 'process.env.SIDECAR_MODE="true"'` 构建，Bun 的 dead code elimination 会自动裁剪掉 `else` 分支（CLI 层），最终二进制中不含 ink/readline 代码。

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Tauri 2.x | 轻量 (~15MB)、安全 |
| 前端 | React + TypeScript | 现代化 UI |
| 后端 | Rust | 进程管理、IPC 桥接 |
| 核心逻辑 | Claude Code TS | Bun Sidecar 打包 |
| 打包工具 | Bun build --compile | TS → 单文件二进制（原生 Bun 编译） |

---

## 工作分解

### Phase 0: 预研重构 (2 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| 代码架构分析 | 梳理 main.tsx 初始化流程和依赖关系 | 3 天 |
| AgentCore 解耦 | 从 CLI 渲染层抽取核心逻辑 | 5 天 |
| Transport 抽象层 | 实现策略模式接口和双传输适配 | 2 天 |

### Phase 1: 基础框架 (3 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| Tauri 项目初始化 | 复用现有 frontend/ 骨架（含 src-tauri/tauri.conf.json、Cargo.toml 基础配置） | 1 天 |
| JSON-RPC 服务 + 流式处理 | 含 notification 协议、背压机制 | 5 天 |
| Rust IPC 全异步改造 | tokio::process + tokio::io | 5 天 |
| 进程生命周期管理 | 启动/重启/崩溃恢复/优雅关闭 | 3 天 |
| 基础 UI | 聊天窗口、消息展示（复用现有 React 组件，替换 API 层为 tauri-api.ts） | 3 天 |
| 流式输出集成 | Tauri EventEmitter + React 事件监听 | 3 天 |

### Phase 2: 功能完善 (3 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| 工具链 IPC 化 | 184 个工具的适配 + 权限双向协议 | 10 天 |
| 会话管理 | 多会话、状态同步、持久化 | 3 天 |
| 设置面板 | 主题、快捷键等配置 | 2 天 |

### Phase 3: 打包发布 (2 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| Bun 编译打包 | bun build --compile 跨平台编译 | 2 天 |
| 跨平台构建测试 | macOS / Linux / Windows | 3 天 |
| 双模式一致性测试 | CLI 和 Sidecar 行为验证 | 3 天 |
| CI/CD 配置 | GitHub Actions 自动构建 | 2 天 |

---

## 总工作量

| 阶段 | 时间 |
|------|------|
| MVP | **10-12 周** |
| 功能完整版 | + 2 周 |
| 生产发布 | + 1 周 |

---

## 审查发现的关键问题

> 本章节记录代码审查过程中发现的技术风险点及对应解决方案，供实施阶段参考。

### 问题 1：打包方案生态冲突

**问题描述**：原方案使用 `pkg`/`nexe` 打包，与项目实际使用的 Bun 生态存在根本性冲突。项目代码中大量使用了 `bun:bundle`、`bun:sqlite` 等 Bun 专有 API，`pkg`/`nexe` 无法正确处理这些依赖。

**解决方案**：改用 `bun build --compile`。

| 指标 | pkg/nexe | bun build --compile |
|------|----------|---------------------|
| 二进制体积 | ~80MB | ~55-65MB |
| 启动时间 | 200-500ms | 50-100ms |
| Bun API 支持 | ❌ 不兼容 | ✅ 原生支持 |
| 跨平台编译 | 需要额外配置 | 内置 `--target` 参数 |

### 问题 2：Rust 代码存在技术错误

**问题描述**：原方案 Rust 代码中存在以下错误：

1. **错误的 import 路径**：`std::process::buf_reader::BufReader` 路径不存在，正确路径为 `std::io::BufReader` 或 `tokio::io::BufReader`。
2. **同步阻塞调用**：`send_request` 方法使用同步 `read_line`，在 Tauri 的 async Tokio 运行时中会阻塞线程，导致性能问题甚至死锁。

**解决方案**：全面改用 tokio 异步 IO（详见第 3 节代码示例）。

### 问题 3：入口改造复杂度被低估

**问题描述**：

- `main.tsx` 约 4,683 行，初始化流程耦合度极高
- CLI 层（ink/readline）深度集成在 React 组件树中，无法简单剥离
- AgentCore 与 CLI 渲染层存在大量双向依赖

**解决方案**：必须在 Phase 0 提前进行模块化重构，将 AgentCore 从 CLI 渲染层解耦，再进行 Sidecar 适配，否则 Phase 1 的工期无法保证。

### 问题 4：双模式维护建议

**问题描述**：如果 CLI 模式和 Sidecar 模式直接共享代码，随着功能迭代，两者的行为差异会越来越难以维护，且容易引入隐性 Bug。

**解决方案**：引入 Transport 抽象层（策略模式 + 适配器），将核心逻辑与传输层彻底解耦：

```typescript
export interface Transport {
  sendRequest(method: string, params: unknown): Promise<unknown>;
  onStream(handler: (token: string) => void): void;
  close(): Promise<void>;
}
// DirectTransport (CLI 模式) 和 JsonRpcTransport (Sidecar 模式) 两个实现
```

两种传输实现：

- **DirectTransport**：CLI 模式下直接调用内部 API，零开销
- **JsonRpcTransport**：Sidecar 模式下通过 stdin/stdout 进行 JSON-RPC 通信

### 问题 5：工具链 IPC 化规模

**问题描述**：项目共有 **184 个工具**，每个工具的权限检查与 UI 交互逻辑混杂在一起，无法直接在 Sidecar 模式下运行。

**影响**：这是工作量最重的部分，需要设计完整的**双向权限通信协议**：

```
Sidecar 请求权限 → Rust 中转 → 前端弹窗 → 用户确认 → 结果回传 Sidecar
```

需要为每类工具（文件读写、Bash 执行、网络访问等）设计对应的权限通信消息格式，并在前端实现对应的确认 UI。

### 问题 6：流式输出协议需完善

**问题描述**：原有流式输出方案未区分两类消息：

- **请求-响应消息**：有 `id` 字段，Rust 需等待对应响应
- **流式通知消息**：无 `id` 字段，单向推送（参考 LSP notification 模式）

此外，缺少**背压处理机制**：当 Rust 消费速度慢于 Sidecar 产出速度时，会导致 stdout 缓冲区堆积，影响稳定性。

**解决方案**：

1. 协议层增加 `notification` 消息类型（无 `id`）用于流式 token 推送
2. 实现基于 channel bound 的背压控制（Rust 侧使用有界 channel）
3. 流式消息使用独立的事件通道，与请求-响应通道分离

---

## 前端架构改造

### 架构对比

```
原有架构（diggdog 模式）：
React 前端 → HTTP API (diggdog.ts) → diggdog 后端服务

新方案架构（Tauri 桌面端）：
React 前端 → Tauri 命令 (tauri-api.ts) → Rust 后端 → JSON-RPC → Bun Sidecar (Claude Code TS)
```

### API 层替换策略

采用**直接替换**方案，而非适配器模式：

- 删除 `src/api/diggdog.ts`（977 行 HTTP 客户端）
- 新建 `src/api/tauri-api.ts`，使用 Tauri invoke 调用
- 保持相同的函数签名（入参/返回类型一致），最小化上层改动
- 通过 `src/api/index.ts` barrel export，组件 import 路径无需修改

**不采用适配器模式的原因**：

- 纯 Tauri 桌面应用不需要运行时切换 HTTP/IPC
- 避免多余的抽象层和接口维护负担
- 减少代码噪音

`tauri-api.ts` 核心代码示例：

```typescript
// src/api/tauri-api.ts
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export async function execute(content: string, options?: ExecuteOptions) {
  return invoke<ExecuteResult>('execute', { content, options });
}

export async function createSession(params: SessionParams) {
  return invoke<Session>('create_session', { params });
}

export async function listSessions() {
  return invoke<Session[]>('list_sessions');
}

// 流式输出：从 HTTP SSE → Tauri Event
export function onStream(callback: (token: string) => void) {
  return listen<{ token: string }>('agent-stream', (event) => {
    callback(event.payload.token);
  });
}
```

### 可复用性评估表

| 模块 | 状态 | 说明 |
|------|------|------|
| `src/components/` | ✅ 大部分复用 | ~15 个纯 UI 组件直接复用；~23 个组件仅需改 API import |
| `src/hooks/` | ⚠️ 需改造 | 4 个 Hook 中 3 个耦合 API 调用，需改为 tauri-api |
| `src/stores/` | ✅ 直接复用 | 5 个 Zustand Store，结构清晰 |
| `src/lib/` | ✅ 直接复用 | 纯前端工具函数 |
| `src/types/` | ✅ 直接复用 | 类型定义 |
| `src/api/diggdog.ts` | ❌ 删除替换 | 替换为 tauri-api.ts |
| `src-tauri/tauri.conf.json` | ✅ 可复用 | Tauri 配置 |
| `src-tauri/Cargo.toml` | ⚠️ 需扩展 | 添加 tokio、serde 等依赖 |
| `src-tauri/src/` | ⚠️ 需新开发 | AgentManager、IPC Bridge、EventEmitter |

---

## 关键实现细节

### 1. Claude Code TS 入口改造

```typescript
// src/sidecar/entry.ts
import { createAgentCore } from './agentCore';
import { setupJsonRpcServer } from './jsonRpc';

// 构建时通过 Bun define 注入
// bun build --define 'process.env.SIDECAR_MODE="true"' --compile
// Bun 的 dead code elimination 会自动移除未使用的 CLI 分支代码
const isSidecar = process.env.SIDECAR_MODE === 'true';

async function main() {
  if (isSidecar) {
    // Sidecar 模式：启动 JSON-RPC 服务
    console.log('[Sidecar] Starting JSON-RPC server...');
    const agentCore = await createAgentCore();
    setupJsonRpcServer({
      stdin: process.stdin,
      stdout: process.stdout,
      agentCore,
    });
  } else {
    // CLI 模式：正常启动
    console.log('[CLI] Starting interactive mode...');
    const { startCli } = await import('./cli/cliEntry');
    await startCli();
  }
}

main().catch(console.error);
```

### 2. JSON-RPC 服务实现

```typescript
// src/sidecar/jsonRpc.ts
import { AgentCore } from '../agentCore';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

// 流式通知（无 id，参考 LSP notification 模式）
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;  // 如 '$/stream'
  params: unknown;
}

export function setupJsonRpcServer(options: {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  agentCore: AgentCore;
}) {
  const { stdin, stdout, agentCore } = options;
  let buffer = '';

  stdin.on('data', async (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const request: JsonRpcRequest = JSON.parse(line);
        const response = await handleRequest(request);
        if (response) {
          stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (e) {
        const errorResponse: JsonRpcResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: { code: -32700, message: 'Parse error' },
        };
        stdout.write(JSON.stringify(errorResponse) + '\n');
      }
    }
  });

  async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    const { method, id, params } = request;

    try {
      let result: unknown;

      switch (method) {
        case 'execute':
          result = await agentCore.execute(params.content, params.options);
          break;

        case 'createSession':
          result = await agentCore.createSession(params);
          break;

        case 'getSession':
          result = await agentCore.getSession(params.id);
          break;

        case 'listSessions':
          result = await agentCore.listSessions();
          break;

        case 'saveCheckpoint':
          result = await agentCore.saveCheckpoint(params.sessionId, params.tag);
          break;

        case 'rollbackCheckpoint':
          result = await agentCore.rollbackCheckpoint(params.checkpointId);
          break;

        case 'listAgents':
          result = await agentCore.listAgents();
          break;

        case 'getAgent':
          result = await agentCore.getAgent(params.name);
          break;

        case 'listSkills':
          result = await agentCore.listSkills();
          break;

        case 'emitEvent':
          // 事件推送（不需要响应）
          process.emit('agent-event', params);
          return null;

        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (e) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: e instanceof Error ? e.message : 'Unknown error' },
      };
    }
  }
}
```

### 3. Rust IPC 桥接

> **注意**：以下代码已修正为全异步实现，使用 tokio 异步 IO，避免在 Tauri async 运行时中阻塞线程。

```rust
// src-tauri/src/agent_manager.rs
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::process::{Child, Command};
use serde::{Deserialize, Serialize};

pub struct AgentProcess {
    child: Child,
    stdin: BufWriter<tokio::process::ChildStdin>,
    stdout: BufReader<tokio::process::ChildStdout>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl AgentProcess {
    pub fn new(sidecar_path: &str) -> Result<Self, anyhow::Error> {
        let mut child = Command::new(sidecar_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;

        let stdin = BufWriter::new(child.stdin.take().unwrap());
        let stdout = BufReader::new(child.stdout.take().unwrap());

        Ok(Self { child, stdin, stdout })
    }

    pub async fn send_request(
        &mut self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, anyhow::Error> {
        let request = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id: serde_json::json!(1),
            method: method.to_string(),
            params: Some(params),
        };

        let mut request_json = serde_json::to_string(&request)?;
        request_json.push('\n');
        self.stdin.write_all(request_json.as_bytes()).await?;
        self.stdin.flush().await?;

        let mut buffer = String::new();
        self.stdout.read_line(&mut buffer).await?;

        let response: JsonRpcResponse = serde_json::from_str(&buffer)?;
        match response.error {
            Some(e) => Err(anyhow::anyhow!("RPC Error: {}", e.message)),
            None => Ok(response.result.unwrap_or(serde_json::Value::Null)),
        }
    }

    pub async fn execute(
        &mut self,
        content: &str,
        options: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, anyhow::Error> {
        self.send_request("execute", serde_json::json!({
            "content": content,
            "options": options
        })).await
    }

    pub async fn create_session(
        &mut self,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, anyhow::Error> {
        self.send_request("createSession", params).await
    }
}
```

### 4. Rust EventEmitter 桥接到 Tauri

```rust
// src-tauri/src/ipc_bridge.rs
use tauri::{AppHandle, Emitter};
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct AgentEvent {
    pub event_type: String,
    pub data: serde_json::Value,
}

pub struct IpcBridge {
    app_handle: AppHandle,
}

impl IpcBridge {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn emit_stream(&self, content: &str) {
        let event = AgentEvent {
            event_type: "stream".to_string(),
            data: serde_json::json!({ "content": content }),
        };
        let _ = self.app_handle.emit("agent-event", event);
    }

    pub fn emit_tool_use(&self, tool_name: &str, input: serde_json::Value) {
        let event = AgentEvent {
            event_type: "tool-use".to_string(),
            data: serde_json::json!({
                "tool": tool_name,
                "input": input
            }),
        };
        let _ = self.app_handle.emit("agent-event", event);
    }

    pub fn emit_complete(&self, result: serde_json::Value) {
        let event = AgentEvent {
            event_type: "complete".to_string(),
            data: result,
        };
        let _ = self.app_handle.emit("agent-event", event);
    }
}
```

### 5. React 前端事件监听

```typescript
// src/components/ChatWindow.tsx
import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';

interface AgentEvent {
  event_type: 'stream' | 'tool-use' | 'complete' | 'error';
  data: {
    content?: string;
    tool?: string;
    input?: Record<string, unknown>;
  };
}

export function ChatWindow() {
  const [messages, setMessages] = useState<Array<{role: string; content: string}>>([]);
  const [toolUses, setToolUses] = useState<Array<{tool: string; input: Record<string, unknown>}>>([]);

  useEffect(() => {
    const unlisten = listen<AgentEvent>('agent-event', (event) => {
      const { event_type, data } = event.payload;

      switch (event_type) {
        case 'stream':
          // 流式文本追加
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), {
                ...last,
                content: last.content + (data.content ?? '')
              }];
            }
            return [...prev, { role: 'assistant', content: data.content ?? '' }];
          });
          break;

        case 'tool-use':
          setToolUses(prev => [...prev, { tool: data.tool ?? '', input: data.input ?? {} }]);
          break;

        case 'complete':
          // 完成，清空工具使用
          setToolUses([]);
          break;

        case 'error':
          console.error('Agent error:', data);
          break;
      }
    });

    return () => { unlisten(); };
  }, []);

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>
      <div className="tool-uses">
        {toolUses.map((tool, i) => (
          <div key={i} className="tool-use">
            <span className="tool-name">{tool.tool}</span>
            <pre>{JSON.stringify(tool.input, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 6. Tauri 命令注册

```rust
// src-tauri/src/main.rs
mod agent_manager;
mod ipc_bridge;

use tauri::Manager;

#[tauri::command]
async fn execute(
    app_handle: AppHandle,
    content: String,
    options: Option<serde_json::Value>
) -> Result<String, String> {
    let manager = app_handle.state::<agent_manager::AgentManager>();
    let result = manager.execute(&content, options).await
        .map_err(|e| e.to_string())?;
    Ok(result.as_str().unwrap_or("").to_string())
}

#[tauri::command]
async fn create_session(
    app_handle: AppHandle,
    params: serde_json::Value
) -> Result<String, String> {
    let manager = app_handle.state::<agent_manager::AgentManager>();
    let result = manager.create_session(params).await
        .map_err(|e| e.to_string())?;
    Ok(result.as_str().unwrap_or("").to_string())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let agent_manager = agent_manager::AgentManager::new()?;
            app.manage(agent_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            execute,
            create_session,
            // ... 其他命令
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## 开发流程

### 开发阶段（CLI 模式）

```bash
# 正常开发调试
cd claude-code
bun run src/main.tsx

# 输出示例：
# [CLI] Starting interactive mode...
# ✓ Connected to Anthropic API
# >
```

### 打包阶段（Sidecar 模式）

```bash
# 1. 打包为单文件（构建时自动注入 SIDECAR_MODE）
bun build ./src/sidecar/entry.ts --compile --define 'process.env.SIDECAR_MODE="true"' --minify --outfile claude-sidecar

# 2. 跨平台编译
bun build --compile --target=bun-darwin-arm64 ./src/sidecar/entry.ts --outfile claude-sidecar-arm64
bun build --compile --target=bun-linux-x64 ./src/sidecar/entry.ts --outfile claude-sidecar-linux
```

### Tauri 调用阶段

```rust
// Tauri 启动 Bun 进程
let agent = AgentProcess::new("./claude-sidecar")?;
let result = agent.execute("帮我写一个 Hello World", None).await?;
```

---

## 安全性考虑

### Tauri 能力模型配置

需在 `capabilities/` 中声明 sidecar 权限，避免未授权的进程启动：

```json
{
  "permissions": [
    "shell:allow-execute",
    "shell:allow-kill"
  ],
  "scope": {
    "name": "claude-sidecar",
    "sidecar": true
  }
}
```

### JSON-RPC 输入验证

使用 Zod schema 对所有入站 JSON-RPC 请求进行严格校验，拒绝格式异常的请求：

```typescript
import { z } from 'zod';
const ExecuteParamsSchema = z.object({
  content: z.string().max(100_000),
  options: z.record(z.unknown()).optional(),
});
```

### 文件系统沙箱化访问

- Tauri 侧通过 `fs` 能力声明限制文件访问范围
- Sidecar 的工作目录应限制在用户明确授权的项目目录内
- 避免 path traversal：对所有文件路径参数进行规范化和白名单校验

### 环境变量安全

- `ANTHROPIC_API_KEY` 等敏感 key 不得写入日志或通过 JSON-RPC 响应返回给前端
- Sidecar 进程环境变量应通过 Tauri 的安全存储（Keychain / Credential Manager）注入，而非明文写入配置文件

---

## 优势

| 优势 | 说明 |
|------|------|
| **开发友好** | 保留完整 CLI，调试直接 |
| **打包灵活** | 一套代码，两种输出 |
| **体积适中** | ~55-65MB (原生 Bun 编译，无 Node.js runtime 冗余) |
| **功能完整** | 所有工具链、Skills 直接可用 |
| **可独立更新** | Sidecar 单独热更新 |
| **维护简单** | TS 改动后单独重打包 Sidecar |

## 劣势

| 劣势 | 说明 |
|------|------|
| **启动开销** | Bun 进程启动约 50-100ms |
| **模块化重构** | 需先解耦 AgentCore（约 2 周前置工作） |
| **双模式维护** | 需确保两种模式行为一致（Transport 抽象层可缓解） |

---

## 替代方案对比

| 方案 | 工作量 | 体积 | TS 改造 | CLI 保留 |
|------|--------|------|---------|---------|
| CLI 子进程 | 4-5 周 | ~150MB | 零改造 | 完整保留 |
| **Bun Sidecar + JSON-RPC** | **2.5-3 月** | **~60MB** | **小改造** | **保留开发模式** |
| Tauri + napi-rs | 3-6 月 | ~40MB | 完全重写 | 丢弃 |

---

## 下一步行动

- [ ] Phase 0: 代码架构分析（梳理 main.tsx 初始化流程）
- [ ] Phase 0: AgentCore 解耦（从 CLI 渲染层抽取核心逻辑）
- [ ] Phase 0: Transport 抽象层实现
- [ ] Phase 1: Tauri 项目初始化（frontend/src-tauri/）
- [ ] Phase 1: JSON-RPC 服务实现（含 notification 协议、背压机制）
- [ ] Phase 1: Rust IPC 全异步改造（tokio::process + tokio::io）
- [ ] Phase 2: 工具链 IPC 化 + 权限双向协议设计
- [ ] Phase 3: Bun 编译打包与跨平台构建测试
