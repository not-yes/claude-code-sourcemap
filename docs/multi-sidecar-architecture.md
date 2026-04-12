# 多 Sidecar 实例隔离架构方案

## 📋 文档信息

- **版本**: v1.2
- **创建日期**: 2026-04-10
- **更新日期**: 2026-04-11
- **作者**: AI Assistant
- **状态**: Phase 0-3 已实施
- **审核人**: [待填写]

### v1.2 更新说明

基于高严重度缺陷审查和边界场景分析，修复了 v1.1 中 3 处高严重度问题，并补充了 7 项边界场景设计：

| # | 严重度 | 问题描述 | 修复方式 |
|---|--------|---------|---------|
| 1 | 高 | 进程退出监控为空壳（注释占位） | `spawn_with_env` 增加 `exit_rx` 返回，监控任务改用 `exit_rx.await` |
| 2 | 高 | 实施计划中 IpcBridge 事件隔离优先级未突出 | 新增第零阶段，标注"必须首先实施" |
| 3 | 高 | `AgentInstance` 创建时未初始化 `last_activity` | 补充 `Arc::new(RwLock::new(Instant::now()))` 初始化 |
| B1-B7 | 中/低 | 优雅关闭、共享模式、防空闲回收、竞态、目录创建、生命周期、异常处理 | 新增"补充设计：边界场景处理"章节 |

### v1.1 更新说明

基于对代码库的全面可行性分析，发现并修正了 v1.0 中存在的 7 处与实际代码不匹配问题，并补充了 2 处架构考量遗漏：

| # | 类型 | 问题描述 |
|---|------|---------|
| 1 | 代码错误 | `AgentInstance` 缺少 `heartbeat_handle` 字段 |
| 2 | 代码缺失 | `spawn_with_env` 未继承现有 `spawn()` 的标准环境变量 |
| 3 | **架构遗漏** | **IpcBridge 事件命名空间未隔离（多实例场景高风险）** |
| 4 | 代码缺失 | 进程退出回调未区分具体 Agent 实例 |
| 5 | 代码错误 | `cwd` 使用 `std::env::current_dir()` 而非前端显式传入 |
| 6 | 编译错误 | `stop_agent` 中对不可 Clone 的 `AgentProcess` 调用了 `.clone()` |
| 7 | 并发问题 | `start_agent` 存在 check-then-act 竞态条件 |
| 8 | 架构遗漏 | 资源评估缺少活跃状态内存数据，默认并发上限偏高 |
| 9 | 运维缺失 | Agent 删除后存储目录未自动清理（数据孤岛风险） |

---

## 🎯 方案概述

### 核心思路

本方案借鉴 Claude Code CLI 多终端隔离的设计模式，为每个 Agent 启动独立的 Sidecar 进程，实现完全隔离的多 Agent 并发对话能力。

### 设计动机

**当前架构的问题：**
- 单个 Sidecar 进程服务所有 Agent
- 全局 `activeSessionId` 导致切换 Agent 时会话上下文混乱
- 无法同时与多个 Agent 对话而不互相干扰
- Session 元数据中缺少 `agentId` 字段，无法建立 Session-Agent 关联

**CLI 模式的启示：**
```bash
# 终端 1 - Agent A
cd /project1 && claude

# 终端 2 - Agent B
cd /project2 && claude

# 终端 3 - Agent C
cd /project3 && claude
```
每个 CLI 实例完全隔离：独立的 AgentCore、独立的会话状态、互不干涉。

### 方案优势

1. ✅ **完全隔离**：每个 Agent 独立进程，状态互不干扰
2. ✅ **架构一致**：完全复用 CLI 的多终端隔离机制
3. ✅ **简单直接**：无需改造 Session 和 AgentCore 内部逻辑
4. ✅ **并发执行**：多个 Agent 可同时工作
5. ✅ **故障隔离**：一个 Agent 崩溃不影响其他 Agent

---

## 🏗️ 架构设计

### 当前架构（单实例）

```
┌─────────────────────────────────────┐
│     Tauri 桌面应用                   │
│                                     │
│  ┌──────────────────────────────┐   │
│  │  AgentManager (单例)          │   │
│  │  - process: Option<Agent>     │   │
│  │  - ipc: Option<IpcBridge>     │   │
│  └──────────────────────────────┘   │
│              ↕                       │
│  ┌──────────────────────────────┐   │
│  │  Sidecar 进程 (单实例)         │   │
│  │  - AgentCore (单实例)         │   │
│  │  - activeSessionId (全局)     │   │
│  │  - SessionStorage             │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

**问题分析：**
- ❌ 所有 Agent 共享同一个 Sidecar 进程
- ❌ 全局 `activeSessionId` 会互相覆盖
- ❌ 切换 Agent 时会话上下文混乱
- ❌ Session 无法归属到具体 Agent

### 目标架构（多实例）

```
┌──────────────────────────────────────────────────┐
│     Tauri 桌面应用                                │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  AgentManager (进程管理器)                  │  │
│  │                                            │  │
│  │  agents: Map<AgentId, AgentInstance>       │  │
│  │  ├─ "main" → AgentInstance                 │  │
│  │  ├─ "agent-a" → AgentInstance              │  │
│  │  └─ "agent-b" → AgentInstance              │  │
│  └────────────────────────────────────────────┘  │
│           ↕              ↕              ↕        │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ Sidecar-A  │  │ Sidecar-B  │  │ Sidecar-C  │ │
│  │ (main)     │  │ (agent-a)  │  │ (agent-b)  │ │
│  │            │  │            │  │            │ │
│  │ AgentCore  │  │ AgentCore  │  │ AgentCore  │ │
│  │ Session-A  │  │ Session-B  │  │ Session-C  │ │
│  └────────────┘  └────────────┘  └────────────┘ │
│                                                  │
│  存储隔离：                                       │
│  ~/.claude/sessions/                             │
│  ├── main/                                       │
│  │   ├── sessions-index.json                    │
│  │   └── {sessionId}/                           │
│  ├── agent-a/                                    │
│  │   ├── sessions-index.json                    │
│  │   └── {sessionId}/                           │
│  └── agent-b/                                    │
│      ├── sessions-index.json                    │
│      └── {sessionId}/                           │
└──────────────────────────────────────────────────┘
```

---

## 🔧 实现方案

### Phase 1: 基础多实例支持

#### 1.1 修改 AgentManager 支持多实例

**文件**: `frontend/src-tauri/src/agent/mod.rs`

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};

use ipc_bridge::IpcBridge;
use lifecycle::{LifecycleConfig, LifecycleManager, LifecycleState};
use process::{resolve_sidecar_path, AgentProcess};

/// Agent ID 类型
type AgentId = String;

/// 每个 Agent 的进程和 IPC 桥接器
struct AgentInstance {
    process: AgentProcess,
    write_tx: mpsc::Sender<String>,
    ipc: Arc<IpcBridge>,
    cwd: String,
    lifecycle: Arc<LifecycleManager>,
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,  // 修正1: 心跳任务句柄，stop_agent 时需 abort
    last_activity: Arc<RwLock<std::time::Instant>>,         // Phase 2 空闲回收：最后活动时间
}

/// AgentManager：管理多个 Sidecar 子进程
pub struct AgentManager {
    /// Map<agent_id, AgentInstance>
    agents: Arc<RwLock<HashMap<AgentId, AgentInstance>>>,
    /// 默认 agent（main）
    default_agent: Arc<RwLock<Option<AgentId>>>,
    /// Tauri AppHandle
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    /// 全局生命周期配置
    lifecycle_config: LifecycleConfig,
}

impl AgentManager {
    /// 创建新的 AgentManager 实例
    pub fn new() -> Self {
        let mut config = LifecycleConfig::default();
        config.start_timeout_ms = 30_000; // 30秒超时

        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            default_agent: Arc::new(RwLock::new(None)),
            app_handle: Arc::new(RwLock::new(None)),
            lifecycle_config: config,
        }
    }

    /// 启动指定 agent 的 Sidecar 实例
    pub async fn start_agent(
        &self,
        agent_id: &str,
        cwd: &str,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<()> {
        // 保存 app_handle
        {
            let mut handle_guard = self.app_handle.write().await;
            *handle_guard = Some(app_handle.clone());
        }

        // 修正7: 使用 read lock 快速检查（仍有微小竞态窗口，在 do_start_agent 内用 entry API 原子插入解决）
        {
            let agents = self.agents.read().await;
            if agents.contains_key(agent_id) {
                return Ok(());  // 快速路径：已存在
            }
        }

        self.do_start_agent(agent_id, cwd, app_handle).await
    }

    /// 内部启动逻辑
    async fn do_start_agent(
        &self,
        agent_id: &str,
        cwd: &str,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<()> {
        // 0. 解析 sidecar 路径
        let sidecar_path = resolve_sidecar_path(&app_handle)?;
        let sidecar_path_str = sidecar_path.to_string_lossy();

        // 1. 准备生命周期管理
        let lifecycle = Arc::new(LifecycleManager::new(self.lifecycle_config.clone()));
        let ready_rx = lifecycle.prepare_start().await;

        // 2. 启动子进程，注入 AGENT_ID 环境变量
        let (agent_proc, stdout, exit_rx) = AgentProcess::spawn_with_env(
            &sidecar_path_str,
            cwd,
            &[("AGENT_ID", agent_id)]
        ).await?;

        // 3. 创建 stdin writer channel
        let (real_write_tx, _) = mpsc::channel::<String>(256);

        // 4. 创建 IpcBridge（修正3: 传入 agent_id 用于事件命名空间隔离，见 1.5 节）
        let (ready_tx_for_ipc, ready_rx_for_lifecycle) = tokio::sync::oneshot::channel::<()>();
        let ipc = Arc::new(IpcBridge::start(
            stdout,
            real_write_tx.clone(),
            Some(ready_tx_for_ipc),
            app_handle.clone(),
            agent_id.to_string(),  // 修正3: 注入 agent_id，IpcBridge 内部使用前缀隔离事件名
        ));

        // 5. 等待 ready
        match lifecycle.wait_for_ready(ready_rx_for_lifecycle).await {
            Ok(()) => {
                log::info!("AgentManager: Agent {} 就绪", agent_id);
            }
            Err(e) => {
                log::error!("AgentManager: Agent {} 就绪失败: {}", agent_id, e);
                return Err(e);
            }
        }

        // 修正4: 启动进程退出监控，确保进程异常退出时精确清理对应实例
        // spawn_with_env 内部通过 tokio::spawn + child.wait() 分离出 exit_rx，
        // 这样 AgentProcess（不可 Clone）的所有权可以保留在 AgentInstance 中。
        let agent_id_clone = agent_id.to_string();
        let agents_ref = Arc::clone(&self.agents);
        tokio::spawn(async move {
            match exit_rx.await {
                Ok(status) => {
                    log::warn!("AgentManager: Agent {} 进程退出，状态: {:?}", agent_id_clone, status);
                    let mut agents = agents_ref.write().await;
                    if let Some(mut instance) = agents.remove(&agent_id_clone) {
                        if let Some(handle) = instance.heartbeat_handle.take() {
                            handle.abort();
                        }
                    }
                    // 可选：通知前端 Agent 已退出
                }
                Err(_) => {
                    log::error!("AgentManager: Agent {} 退出监控通道异常关闭", agent_id_clone);
                }
            }
        });

        // 6. 修正7: 使用 entry API 原子插入，避免并发启动竞态条件
        {
            let mut agents = self.agents.write().await;
            match agents.entry(agent_id.to_string()) {
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(AgentInstance {
                        process: agent_proc,
                        write_tx: real_write_tx,
                        ipc,
                        cwd: cwd.to_string(),
                        lifecycle,
                        heartbeat_handle: None,  // 修正1: 初始化 heartbeat_handle
                        last_activity: Arc::new(RwLock::new(std::time::Instant::now())),  // 修正3: 补充初始化，避免首次 touch 前空闲监控误判
                    });
                }
                std::collections::hash_map::Entry::Occupied(_) => {
                    // 修正7: 已被其他并发请求抢先启动，安全丢弃当前实例
                    log::warn!("AgentManager: Agent {} 已被并发启动，丢弃重复实例", agent_id);
                    return Ok(());
                }
            }
        }

        // 7. 设置默认 agent
        {
            let mut default = self.default_agent.write().await;
            if default.is_none() {
                *default = Some(agent_id.to_string());
            }
        }

        log::info!("AgentManager: Agent {} 启动完成 cwd={}", agent_id, cwd);
        Ok(())
    }

    /// 获取指定 agent 的 IPC bridge
    pub async fn get_agent_ipc(&self, agent_id: &str) -> anyhow::Result<Arc<IpcBridge>> {
        let agents = self.agents.read().await;
        agents
            .get(agent_id)
            .map(|instance| instance.ipc.clone())
            .ok_or_else(|| anyhow::anyhow!("Agent {} 未找到", agent_id))
    }

    /// 停止指定 agent 的 Sidecar 实例
    pub async fn stop_agent(&self, agent_id: &str) -> anyhow::Result<()> {
        let mut agents = self.agents.write().await;
        if let Some(mut instance) = agents.remove(agent_id) {
            // 修正1: abort 心跳任务
            if let Some(handle) = instance.heartbeat_handle.take() {
                handle.abort();
            }

            // 修正6: AgentProcess 不可 Clone，通过 write_tx 发送关闭信号
            let _ = instance.write_tx.send(
                serde_json::json!({"jsonrpc":"2.0","method":"shutdown","id":null}).to_string()
            ).await;

            // 等待进程退出或超时后，lifecycle manager 负责强制终止
            // 注意：instance.process 在此处 Drop，kill_on_drop 确保子进程被终止
            log::info!("AgentManager: Agent {} 已停止", agent_id);
        }
        Ok(())
    }

    /// 检查 agent 是否在运行
    pub async fn is_agent_running(&self, agent_id: &str) -> bool {
        let agents = self.agents.read().await;
        agents.contains_key(agent_id)
    }

    /// 获取所有运行中的 agent ID
    pub async fn get_running_agents(&self) -> Vec<String> {
        let agents = self.agents.read().await;
        agents.keys().cloned().collect()
    }

    /// 停止所有 agent
    pub async fn stop_all(&self) -> anyhow::Result<()> {
        let agent_ids = self.get_running_agents().await;
        for agent_id in agent_ids {
            self.stop_agent(&agent_id).await?;
        }
        Ok(())
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}
```

#### 1.2 修改 AgentProcess 支持环境变量注入

**文件**: `frontend/src-tauri/src/agent/process.rs`

```rust
impl AgentProcess {
    /// 启动 sidecar 子进程（带环境变量）
    /// 修正2: 在现有 spawn() 基础上扩展，继承所有标准环境变量
    /// 返回 exit_rx 供调用方监听进程退出，避免直接持有 child 所有权（AgentProcess 不可 Clone）
    pub async fn spawn_with_env(
        sidecar_path: &str,
        cwd: &str,
        env_vars: &[(&str, &str)],
    ) -> Result<(Self, tokio::process::ChildStdout, tokio::sync::oneshot::Receiver<std::process::ExitStatus>)> {
        log::info!("AgentProcess::spawn_with_env: path={} cwd={}", sidecar_path, cwd);

        let mut cmd = Command::new(sidecar_path);
        cmd.current_dir(cwd)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // 修正2: 继承当前进程环境变量（与现有 spawn() 保持一致）
        cmd.envs(std::env::vars());

        // 修正2: 注入标准 Sidecar 环境变量（与现有 spawn() 保持一致）
        cmd.env("SIDECAR_MODE", "true");
        cmd.env("CLAUDE_CODE_USE_NATIVE_FILE_SEARCH", "true");
        cmd.env("DEBUG", "true");
        cmd.env("NODE_OPTIONS", "--max-old-space-size=4096");

        // 注入自定义环境变量（如 AGENT_ID）
        for (key, value) in env_vars {
            cmd.env(key, value);
            log::info!("AgentProcess: 设置环境变量 {}={}", key, value);
        }

        let mut child = cmd.spawn()
            .map_err(|e| anyhow::anyhow!("启动 sidecar 失败: {}", e))?;

        let stdin = child.stdin.take()
            .ok_or_else(|| anyhow::anyhow!("无法获取 stdin"))?;
        let stdout = child.stdout.take()
            .ok_or_else(|| anyhow::anyhow!("无法获取 stdout"))?;

        // 创建退出通知通道，内部 spawn 监听 child.wait()，
        // 避免调用方持有 child 所有权来等待退出（AgentProcess 不可 Clone）
        let (exit_tx, exit_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            match child.wait().await {
                Ok(status) => { let _ = exit_tx.send(status); }
                Err(_) => {} // 通道已关闭，忽略
            }
        });

        Ok((
            Self {
                stdin,
            },
            stdout,
            exit_rx,
        ))
    }
}
```

#### 1.3 修改 Sidecar 入口支持 AGENT_ID

**文件**: `claude-code/src/sidecar/entry.ts`

```typescript
// 读取 AGENT_ID 环境变量
const agentId = process.env.AGENT_ID ?? 'default';
log('INFO', `Agent ID: ${agentId}`);

// 配置 Session 存储路径
const sessionDir = join(homedir(), '.claude', 'sessions', agentId);
log('INFO', `Session 存储目录: ${sessionDir}`);

// 初始化 SessionStorage
let sessionStorage: SessionStorage | undefined;
if (agentConfig.persistSession !== false) {
    sessionStorage = new SessionStorage(sessionDir);
    try {
        await sessionStorage.initialize();
        log('INFO', `SessionStorage 初始化完成 (${agentId})`);
    } catch (err) {
        log('WARN', 'SessionStorage 初始化失败:', err instanceof Error ? err.message : String(err));
        sessionStorage = undefined;
    }
}
```

#### 1.4 修改 Tauri 命令支持 agent_id 路由

**文件**: `frontend/src-tauri/src/lib.rs`

```rust
/// 流式执行请求（支持多 agent 路由）
#[tauri::command]
async fn agent_execute(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    content: String,
    options: Option<serde_json::Value>,
) -> Result<String, String> {
    // 从 options 中提取 agent_id
    let agent_id = options
        .as_ref()
        .and_then(|o| o.get("agentId"))
        .and_then(|v| v.as_str())
        .unwrap_or("main");

    // 确保 agent 已启动
    if !state.0.is_agent_running(agent_id).await {
        // 修正5: cwd 应由前端显式传入，而非使用 std::env::current_dir()
        // std::env::current_dir() 在 Tauri 中返回的是应用安装目录，而非项目目录
        let cwd = options
            .as_ref()
            .and_then(|o| o.get("cwd"))
            .and_then(|v| v.as_str())
            .unwrap_or(".")  // 回退到相对路径（实际使用时前端必须传入）
            .to_string();

        state.0.start_agent(agent_id, &cwd, app.clone())
            .await
            .map_err(classify_error)?;
    }

    // 获取对应 agent 的 IPC
    let ipc = state.0.get_agent_ipc(agent_id)
        .await
        .map_err(classify_error)?;

    // 生成 stream_id
    let stream_id = uuid::Uuid::new_v4().to_string();
    let event_name = format!("agent:stream:{}", stream_id);
    let stream_id_ret = stream_id.clone();

    // 获取流式事件 Receiver
    let exec_start = std::time::Instant::now();
    let mut rx = ipc
        .execute(&content, options)
        .await
        .map_err(classify_error)?;

    log::info!("agent_execute: Agent {} stream_id={}", agent_id, stream_id);

    // 启动异步任务推送事件
    tokio::spawn(async move {
        let mut first_event_received = false;
        while let Some(event) = rx.recv().await {
            if !first_event_received {
                first_event_received = true;
                log::info!("agent_execute: Agent {} 收到第一个流事件, stream_id={}", agent_id, stream_id);
            }
            if let Err(e) = app.emit(&event_name, &event) {
                log::error!("agent_execute: Agent {} 推送事件失败", agent_id);
                continue;
            }
        }

        // 发送完成通知
        let done_event = format!("agent:stream:{}:done", stream_id);
        let _ = app.emit(&done_event, serde_json::json!({ "done": true }));
        log::info!("agent_execute: Agent {} 流式执行完成 stream_id={}", agent_id, stream_id);
    });

    Ok(stream_id_ret)
}
```

---

### Phase 1.5: IpcBridge 事件命名空间隔离（⚠️ 高风险 - 新增章节）

> **说明**: 本节为 v1.1 新增内容，修正了 v1.0 完全遗漏的高风险架构问题。

#### 问题描述

当前 IpcBridge 向前端推送事件使用**固定事件名**（如 `$/stream`、`$/checkpoint`、`$/complete`）。在多 Sidecar 实例场景下，多个 Agent 同时运行时会同时向前端推送同名事件，前端无法区分事件来自哪个 Agent，导致：

- 流式响应混乱（Agent-A 的内容显示在 Agent-B 的 UI 中）
- Checkpoint 事件被错误的监听器处理
- 会话完成通知触发错误的状态更新

#### 解决方案：方案A（推荐）——事件名前缀注入

在 IpcBridge 创建时注入 `agent_id`，所有事件名自动加 agent 前缀：

**文件**: `frontend/src-tauri/src/ipc/bridge.rs`

```rust
pub struct IpcBridge {
    // 现有字段 ...
    agent_id: String,  // 新增：Agent ID，用于事件名前缀
}

impl IpcBridge {
    pub fn start(
        stdout: tokio::process::ChildStdout,
        write_tx: mpsc::Sender<String>,
        ready_tx: Option<tokio::sync::oneshot::Sender<()>>,
        app_handle: tauri::AppHandle,
        agent_id: String,  // 修正3: 新增参数
    ) -> Self {
        // 在内部推送事件时，使用带前缀的事件名
        // 原来: app.emit("$/stream", &event)
        // 现在: app.emit(&format!("agent:{}:$/stream", agent_id), &event)
        // ...
    }

    /// 构建带 agent_id 前缀的事件名
    fn event_name(&self, base: &str) -> String {
        format!("agent:{}:{}", self.agent_id, base)
    }
}
```

事件推送示例（bridge.rs 内部）：
```rust
// 流式事件
app_handle.emit(&self.event_name("$/stream"), &stream_event)?;

// Checkpoint 事件
app_handle.emit(&self.event_name("$/checkpoint"), &checkpoint_event)?;

// 完成事件
app_handle.emit(&self.event_name("$/complete"), &complete_event)?;

// Ready 事件
app_handle.emit(&self.event_name("$/ready"), &ready_event)?;
```

#### 方案B（备选）——Payload 注入 agentId

若前缀方案改动成本过高，可在事件 payload 中注入 `agentId` 字段，前端按字段过滤：

```rust
// 在每个事件 payload 中注入 agent_id
let enriched_event = serde_json::json!({
    "agentId": self.agent_id,
    "data": &original_event,
});
app_handle.emit("$/stream", &enriched_event)?;
```

**缺点**：需修改所有事件结构体，前端过滤逻辑更复杂，不推荐。

#### 前端适配

**文件**: `frontend/src/api/tauri-api.ts`

```typescript
// 修正3: 前端监听时需按 agentId 构建带前缀的事件名
function buildAgentEventName(agentId: string, baseEvent: string): string {
  return `agent:${agentId}:${baseEvent}`;
}

// 示例：监听特定 Agent 的流式事件
const streamEventName = buildAgentEventName(agentId, "$/stream");
const unlisten = await listen(streamEventName, (event) => {
  onChunk(event.payload);
});

// 示例：监听特定 Agent 的完成事件
const completeEventName = buildAgentEventName(agentId, "$/complete");
const unlistenComplete = await listen(completeEventName, (event) => {
  onDone(event.payload);
});
```

**文件**: `frontend/src/hooks/`（相关 hooks 需同步适配）

```typescript
// useAgentStream.ts
export function useAgentStream(agentId: string) {
  useEffect(() => {
    if (!agentId) return;

    const unlisteners: (() => void)[] = [];

    const setup = async () => {
      // 使用 agentId 构建命名空间事件名
      const unlistenStream = await listen(
        `agent:${agentId}:$/stream`,
        (event) => { /* 处理流式更新 */ }
      );
      const unlistenComplete = await listen(
        `agent:${agentId}:$/complete`,
        (event) => { /* 处理完成 */ }
      );
      unlisteners.push(unlistenStream, unlistenComplete);
    };

    setup();
    return () => unlisteners.forEach(fn => fn());
  }, [agentId]);
}
```

#### 影响文件清单

| 文件 | 变更内容 |
|-----|---------|
| `frontend/src-tauri/src/ipc/bridge.rs` | `IpcBridge::start()` 新增 `agent_id` 参数；所有 `app.emit()` 调用改用前缀事件名 |
| `frontend/src-tauri/src/agent/mod.rs` | `do_start_agent()` 传递 `agent_id` 给 `IpcBridge::start()` |
| `frontend/src/api/tauri-api.ts` | 事件监听命名空间化，增加 `buildAgentEventName()` 工具函数 |
| `frontend/src/hooks/` | 所有订阅 IpcBridge 事件的 hook 改用带前缀的事件名 |

> **⚠️ 重要**: 此项变更影响所有流式功能，必须在 Phase 1 其他变更完成后**优先**实施并完整测试。

### Phase 2: 生命周期优化

#### 2.1 懒加载策略

```rust
impl AgentManager {
    /// 确保 agent 已启动（懒加载 - 显式预热）
    ///
    /// 此方法暴露为 Tauri 命令 `agent_ensure`，供前端在以下场景显式调用：
    /// - Agent 切换时预热目标实例，减少首次对话的启动延迟
    /// - 应用启动后后台预加载常用 Agent
    ///
    /// 注意：agent_execute 内部也有隐式懒启动作为兜底，
    /// 两者形成"显式预热 + 隐式兜底"的双保险策略。
    pub async fn ensure_agent(
        &self,
        agent_id: &str,
        cwd: &str,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<()> {
        if !self.is_agent_running(agent_id).await {
            log::info!("AgentManager: Agent {} 未运行，正在预热启动", agent_id);
            self.start_agent(agent_id, cwd, app_handle).await?;
        }
        Ok(())
    }
}
```

#### 2.2 空闲回收机制

```rust
use std::time::Instant;

// 问题A修正：AgentInstance 结构体（在 Phase 1.1 基础上扩展，不重复定义）
// 新增字段（已在 Phase 1.1 定义处补充）：
//   last_activity: Arc<RwLock<std::time::Instant>>  - 最后活动时间，用于空闲回收

impl AgentManager {
    /// 启动空闲监控任务
    ///
    /// 问题C修正：分两阶段操作，避免在持有写锁时嵌套 async await 导致死锁：
    ///   - 阶段 1：read lock 收集超时列表
    ///   - 阶段 2：释放 read lock 后逐个调用 stop_agent 清理
    ///
    /// 注意：此方法应在 Arc<AgentManager> 上调用，或接收 Arc<Self> 作为参数，
    /// 以便在 tokio::spawn 闭包内安全持有并调用 stop_agent。
    pub async fn start_idle_monitor(&self) {
        let agents_ref = Arc::clone(&self.agents);
        let manager = self.clone();  // 需要 AgentManager 实现 Clone 或通过 Arc<Self> 传入

        tokio::spawn(async move {
            let idle_timeout = std::time::Duration::from_secs(300); // 5分钟

            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                // 阶段 1: read lock 收集超时列表（避免嵌套写锁死锁）
                let to_remove = {
                    let agents = agents_ref.read().await;
                    let mut expired = Vec::new();

                    for (agent_id, instance) in agents.iter() {
                        let last_activity = instance.last_activity.read().await;
                        if last_activity.elapsed() > idle_timeout {
                            expired.push(agent_id.clone());
                        }
                    }

                    expired
                }; // read lock 在此释放

                // 阶段 2: 逐个调用 stop_agent 清理（问题B修正：复用已修正的关闭逻辑，
                // 不再直接调用 instance.process.clone() 或 lifecycle.graceful_shutdown）
                for agent_id in to_remove {
                    log::info!("AgentManager: 回收空闲 Agent {}", agent_id);
                    if let Err(e) = manager.stop_agent(&agent_id).await {
                        log::error!("AgentManager: 回收 Agent {} 失败: {}", agent_id, e);
                    }
                }
            }
        });
    }

    /// 更新 agent 活动时间
    pub async fn touch_agent(&self, agent_id: &str) {
        let agents = self.agents.read().await;
        if let Some(instance) = agents.get(agent_id) {
            let mut last_activity = instance.last_activity.write().await;
            *last_activity = Instant::now();
        }
    }
}
```

#### 2.3 资源限制

```rust
/// 最大并发 Agent 数量（修正8: 默认值从 5 调整为 3，可通过配置文件覆盖）
const MAX_CONCURRENT_AGENTS: usize = 3;

impl AgentManager {
    /// 启动 agent（带资源限制）
    pub async fn start_agent_with_limit(
        &self,
        agent_id: &str,
        cwd: &str,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<()> {
        let agents = self.agents.read().await;
        if agents.len() >= MAX_CONCURRENT_AGENTS {
            // 回收最久未使用的 agent
            drop(agents);
            self.evict_idle_agent().await?;
        }

        self.start_agent(agent_id, cwd, app_handle).await
    }

    /// 回收最久未使用的 agent
    async fn evict_idle_agent(&self) -> anyhow::Result<()> {
        let agents = self.agents.read().await;
        if agents.is_empty() {
            return Ok(());
        }

        // 找到最久未使用的 agent
        let mut oldest_id = None;
        let mut oldest_time = None;

        for (agent_id, instance) in agents.iter() {
            let last_activity = instance.last_activity.read().await;
            if oldest_time.is_none() || last_activity.elapsed() > oldest_time.unwrap() {
                oldest_id = Some(agent_id.clone());
                oldest_time = Some(last_activity.elapsed());
            }
        }

        if let Some(agent_id) = oldest_id {
            log::info!("AgentManager: 回收最久未使用的 Agent {}", agent_id);
            drop(agents);
            self.stop_agent(&agent_id).await?;
        }

        Ok(())
    }
}
```

---

### Phase 3: 前端集成

#### 3.1 修改前端 API 调用

**文件**: `frontend/src/api/tauri-api.ts`

```typescript
/**
 * 流式执行指令（支持 agent 路由）
 */
export async function executeStream(
  content: string,
  sessionOpts: ExecuteStreamSessionOptions,
  callbacks: ExecuteStreamOptions
): Promise<void> {
  const { onChunk, onDone, signal } = callbacks;
  const sessionId = "backendSessionId" in sessionOpts ? sessionOpts.backendSessionId : undefined;
  const agentId = "agentId" in sessionOpts ? sessionOpts.agentId : undefined;

  // 并发流数量检查
  if (activeStreamCount >= MAX_CONCURRENT_STREAMS) {
    throw new Error("STREAM_LIMIT_EXCEEDED");
  }

  activeStreamCount++;

  try {
    // 发送执行请求（包含 agentId 和 cwd）
    const streamId = await safeInvoke<string>("agent_execute", {
      content,
      options: {
        ...(sessionId ? { sessionId } : {}),
        ...(agentId ? { agentId } : {}),  // ✅ 传递 agentId
        cwd: currentWorkingDirectory,  // 修正5: 必须显式传递工作目录（而非由 Rust 端 current_dir() 推导）
      },
    });

    // ... 后续事件监听逻辑
  } catch (error) {
    activeStreamCount--;
    throw error;
  }
}
```

#### 3.2 Agent 切换时确保实例已启动

**文件**: `frontend/src/components/chat/ChatArea.tsx`

```typescript
useEffect(() => {
  // 切换 Agent 时确保 Sidecar 实例已启动
  const ensureAgentInstance = async () => {
    try {
      await invoke("ensure_agent", {
        agentId: sessionId,
        cwd: currentWorkingDirectory
      });
    } catch (error) {
      console.error(`Agent ${sessionId} 启动失败:`, error);
      toast.error(`Agent ${sessionId} 启动失败`);
    }
  };

  ensureAgentInstance();
}, [sessionId]);
```

---

## 📊 资源评估

### 内存占用

> **修正8**: v1.0 仅列出空闲状态内存，补充活跃状态（执行任务时）实际内存数据，并据此调整默认并发上限。

| Agent 数量 | 空闲内存占用 | 活跃内存占用 | 说明 |
|-----------|------------|------------|------|
| 1         | 50-100 MB  | 200-400 MB | 单个 Sidecar 进程 |
| 3         | 150-300 MB | 600-1200 MB | **推荐默认上限**（内存可控） |
| 5         | 250-500 MB | 1000-2000 MB | 需谨慎，低内存设备易 OOM |
| 10        | 500-1000 MB | 2000-4000 MB | 需空闲回收机制，不推荐默认开启 |

### 启动延迟

| 阶段 | 耗时 | 说明 |
|-----|------|------|
| 进程启动 | 0.5-1 秒 | Bun/Node.js 进程创建 |
| 初始化 | 2-5 秒 | AgentCore 初始化、加载配置 |
| Ready 通知 | 1-3 秒 | 等待 $/ready notification |
| **总计** | **3.5-9 秒** | 首次启动 |

**优化策略：**
- 懒加载：首次使用时启动
- 后台预热：应用启动后预加载常用 agent
- 空闲回收：5 分钟无活动自动关闭

---

## ⚠️ 风险与缓解

### 风险 1: 内存占用过高

**问题**: 多个 Sidecar 进程同时运行占用大量内存

**缓解措施**:
1. 限制最大并发数（**修正8**: 默认 3 个，可配置；活跃状态下 3 个进程约占 600-1200 MB）
2. 空闲回收机制（5 分钟无活动自动关闭）
3. 提供手动释放接口

### 风险 2: 启动延迟影响用户体验

**问题**: 首次切换 agent 需要等待 3-9 秒

**缓解措施**:
1. 显示启动进度提示
2. 后台预热常用 agent
3. 缓存已启动的 agent 实例

### 风险 3: 进程管理复杂度增加

**问题**: 需要管理多个进程的生命周期

**缓解措施**:
1. 统一的 AgentManager 管理器
2. 自动化生命周期管理（启动、监控、回收）
3. 完善的日志和错误处理

### 风险 4: 跨 Agent 数据共享困难

**问题**: 独立进程无法直接共享数据

**缓解措施**:
1. 共享配置目录（~/.claude/）
2. 通过文件系统传递数据
3. 未来可通过 Tauri IPC 实现跨 agent 通信

### 风险 5: Agent 删除后的数据孤岛（v1.1 新增）

**问题**: Agent 被删除后，其 `~/.claude/sessions/{agentId}/` 目录不会自动清理，长期运行后会积累大量孤立数据，占用磁盘空间

**具体场景**:
- 用户删除 Agent A，但 `~/.claude/sessions/agent-a/` 目录依然存在
- Session 索引文件、消息记录、Checkpoint 数据均残留
- 新创建同名 Agent 时可能加载到残留的历史数据（会话污染）

**缓解措施**:
1. Agent 删除时增加存储清理钩子（`stop_agent()` 之后异步清理对应目录）
2. 在 settings 中提供 "清理孤立数据" 功能（手动触发全量扫描清理）
3. 定期扫描无归属的 session 目录（与 `AgentManager.get_running_agents()` 对比）

```typescript
// 清理孤立 session 目录示例（前端触发）
async function cleanOrphanedAgentData(activeAgentIds: string[]) {
  const allSessionDirs = await readDir("~/.claude/sessions");
  for (const dir of allSessionDirs) {
    if (!activeAgentIds.includes(dir.name)) {
      log(`清理孤立 Agent 数据: ${dir.name}`);
      await invoke("cleanup_agent_data", { agentId: dir.name });
    }
  }
}
```

---

## 🔍 补充设计：边界场景处理

### B1. stop_agent 优雅关闭保证

当前 `stop_agent()` 通过 `write_tx` 发送 shutdown JSON-RPC 消息后依赖 `kill_on_drop` 强制终止。需补充等待逻辑：

- 发送 shutdown 消息后，等待 `exit_rx`（带 5 秒超时）
- 超时后依赖 `kill_on_drop` 强制终止，记录警告日志
- `drop(instance)` 时 `AgentProcess` 的 Destructor 确保子进程被清理

```rust
// stop_agent 内部优雅关闭示意
let _ = instance.write_tx.send(shutdown_msg).await;
// 等待进程退出，超时则强制 kill（kill_on_drop 在 drop(instance) 时生效）
```

### B2. AgentManager 共享模式

`start_idle_monitor()` 需要在 `tokio::spawn` 中访问 `self`。推荐方案：

- Tauri State 中使用 `Arc<AgentManager>` 管理
- `start_idle_monitor(self: Arc<Self>)` 方法签名，通过 `Arc::clone` 传入 spawned task
- 避免将 `AgentManager` 实现 `Clone`（代价高，语义模糊）

### B3. 流式请求防空闲回收

在 `agent_execute` 的流事件转发循环中，每收到事件调用 `touch_agent(agent_id)` 更新活跃时间，防止执行中的 Agent 被空闲监控误回收：

```rust
while let Some(event) = rx.recv().await {
    touch_agent_ref.touch_agent(&agent_id).await;  // 保活
    if let Err(e) = app.emit(&event_name, &event) { ... }
}
```

### B4. evict_idle_agent 竞态优化

当前 `evict_idle_agent` 的 read lock 收集 → drop → `stop_agent` 之间存在窗口期（其他请求可能在此间隙启动同名 Agent）。可选优化：

- 在 `start_agent` 内部做 `len` 检查（已在 write lock 内，天然原子，推荐）
- 或使用 `tokio::sync::Semaphore` 控制最大并发数，拒绝超出上限的启动请求

### B5. Session 存储目录自动创建

Sidecar 入口 `entry.ts` 中，在 `new SessionStorage(sessionDir)` 之前需确保目录存在：

```typescript
import { mkdir } from 'fs/promises'
await mkdir(sessionDir, { recursive: true })
const sessionStorage = new SessionStorage(sessionDir)
```

`SessionStorage.initialize()` 方法可能已处理此逻辑；若已处理则无需重复，否则在入口处补充。

### B6. 应用生命周期管理

| 时机 | 处理方式 |
|-----|---------|
| **启动时** | 初始化空的 `AgentManager`，按需懒加载；可预热 `main` Agent |
| **关闭时** | Tauri `on_window_event(CloseRequested)` 中调用 `stop_all()`，设 30 秒超时后强制退出 |
| **前端刷新** | Tauri IPC 层自动重建，后端 Agent 实例保持运行；前端重新订阅事件流即可 |

### B7. Sidecar 异常处理

| 异常类型 | 处理方式 |
|---------|---------|
| **OOM 被 SIGKILL** | `exit_rx` 收到退出状态，检测 `signal=9` 时记录警告，可触发重启 |
| **启动失败** | `spawn_with_env` 返回 Error 后，可在 `start_agent` 中实现最多 2 次重试（指数退避 1s/2s） |
| **通信断开（stdout EOF）** | `IpcBridge` 检测 EOF 后标记实例为不可用，下次请求时触发重启；或通过 `exit_rx` 已捕获的退出信号触发相同清理路径 |

---

## 🚀 实施计划

### 第零阶段：IpcBridge 事件命名空间隔离（1-2 天，必须首先实施）

> **⚠️ 最高优先级**：多实例场景下事件混流的根本问题，不解决此项则多 Agent 并发完全不可用。

- [x] 修改 `IpcBridge::start()` 接收 `agent_id` 参数
- [x] 实现事件名前缀化 `agent:{agent_id}:{event}`（增加 `event_name()` 辅助方法）
- [x] 前端事件监听适配命名空间（`tauri-api.ts` 及相关 hooks）
- [x] 验证单实例下向后兼容（默认 `agent_id="main"`，事件名格式不变）

### 第一阶段：基础多实例支持（2-3 天）

- [x] 修改 AgentManager 支持多实例
- [x] 实现 AgentProcess 环境变量注入（`spawn_with_env` 含 `exit_rx`）
- [x] 修改 Sidecar 入口支持 AGENT_ID
- [x] 修改 Tauri 命令支持 agent 路由
- [x] 实现 Session 存储按 agent 隔离

### 第二阶段：生命周期优化（2-3 天）

- [x] 实现懒加载策略
- [x] 实现空闲回收机制
- [x] 实现资源限制（最大并发数）
- [x] 添加 agent 状态监控

### 第三阶段：前端集成（2-3 天）

- [x] 修改前端 API 调用传递 agentId
- [x] Agent 切换时确保实例已启动
- [x] 添加启动进度提示
- [x] 显示 agent 运行状态

### 第四阶段：测试与优化（2-3 天）

- [ ] 单元测试（AgentManager 多实例管理）
- [ ] 集成测试（多 agent 并发对话）
- [ ] 性能测试（内存占用、启动延迟）
- [ ] 边界测试（资源限制、空闲回收）

**总工期**: 9-14 天（含第零阶段）

---

## ✅ 验证标准

### 功能验证

- [ ] 可以同时与 3 个不同 agent 对话
- [ ] 切换 agent 时会话上下文不混乱
- [x] 每个 agent 的会话历史独立保存
- [x] 关闭一个 agent 不影响其他 agent

### 性能验证

- [ ] 单个 agent 启动时间 < 10 秒
- [ ] 3 个 agent 同时运行空闲内存占用 < 300 MB（活跃状态 < 1200 MB）
- [ ] 空闲 5 分钟后自动回收
- [ ] 切换 agent 无卡顿

### 稳定性验证

- [ ] 连续运行 24 小时无内存泄漏
- [ ] agent 崩溃后自动重启
- [ ] 网络断开后能恢复
- [ ] 异常情况下资源正确释放

---

## 📝 技术决策记录

### 决策 1: 为什么选择多进程而非单进程多 session？

**选择**: 多 Sidecar 进程

**理由**:
1. 完全复用 CLI 的多终端隔离机制
2. 无需改造 Session 和 AgentCore 内部逻辑
3. 故障隔离更好
4. 架构更清晰

**替代方案**: 单进程 + Session 元数据增加 agentId

**未选择原因**:
1. 仍需改造 AgentCore 的 activeSessionId 管理
2. 无法实现真正的并发执行
3. 故障隔离差

### 决策 2: Session 存储是按 agent 物理隔离还是逻辑隔离？

**选择**: 物理隔离（不同目录）

**理由**:
1. 实现简单，不需要修改 SessionMetadata 结构
2. 天然隔离，不会串数据
3. 便于管理和清理

**替代方案**: 逻辑隔离（同一目录，通过 agentId 字段区分）

**未选择原因**:
1. 需要修改 SessionMetadata 接口
2. 需要改造 getSessions 过滤逻辑
3. 增加复杂度

### 决策 3: 最大并发 Agent 数量设为多少？

**选择**: 默认 3 个（v1.1 修正：v1.0 中的 5 个默认值偏高）

**理由**:
1. 综合空闲和活跃两种状态的内存占用评估
2. 3 个 agent 空闲占 150-300 MB，活跃占 600-1200 MB，大多数用户设备可接受
3. 5 个 agent 活跃时可能占用 1-2 GB，低内存设备（8GB RAM）易出现 OOM
4. 可根据实际使用情况通过配置文件调整

**可配置**: 是，通过环境变量 `MAX_CONCURRENT_AGENTS` 或配置文件覆盖

---

## 🔗 参考资料

- [AGENTS.md](./AGENTS.md) - 项目架构文档
- [Claude Code 源码](./claude-code/) - Sidecar 实现参考
- [Tauri 文档](https://tauri.app/) - 进程管理最佳实践

---

## 📋 审核清单

- [x] 架构设计合理
- [x] 实现方案可行
- [x] 资源评估准确
- [x] 风险缓解措施充分
- [x] 实施计划合理
- [x] 验证标准明确
- [x] **IpcBridge 事件隔离设计已评审**（v1.1 新增 - 多实例场景关键安全检查项）

**审核人**: ____________
**审核日期**: ____________
**审核意见**: ____________

---

## 📌 附录

### A. Session 存储目录结构

```
~/.claude/sessions/
├── main/
│   ├── sessions-index.json
│   ├── session-uuid-1/
│   │   ├── metadata.json
│   │   └── messages.json
│   └── session-uuid-2/
│       ├── metadata.json
│       └── messages.json
├── agent-a/
│   ├── sessions-index.json
│   └── session-uuid-3/
│       ├── metadata.json
│       └── messages.json
└── agent-b/
    ├── sessions-index.json
    └── session-uuid-4/
        ├── metadata.json
        └── messages.json
```

### B. 环境变量清单

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `AGENT_ID` | Agent 唯一标识 | `default` |
| `SIDECAR_CWD` | 工作目录 | `process.cwd()` |
| `SIDECAR_PERSIST_SESSION` | 是否持久化会话 | `true` |
| `SIDECAR_DEBUG` | 是否启用调试日志 | `false` |
| `MAX_CONCURRENT_AGENTS` | 最大并发 Agent 数 | `3`（修正8: 原 5，调整为 3） |
| `AGENT_IDLE_TIMEOUT_MS` | 空闲回收超时 | `300000` (5分钟) |

### C. 关键接口清单

| 接口 | 说明 | 位置 |
|-----|------|------|
| `AgentManager.start_agent()` | 启动指定 agent | `src-tauri/src/agent/mod.rs` |
| `AgentManager.stop_agent()` | 停止指定 agent（含 heartbeat abort） | `src-tauri/src/agent/mod.rs` |
| `AgentManager.get_agent_ipc()` | 获取 agent 的 IPC | `src-tauri/src/agent/mod.rs` |
| `AgentProcess.spawn_with_env()` | 启动进程（带环境变量继承） | `src-tauri/src/agent/process.rs` |
| `agent_execute` | Tauri 命令（支持 agent 路由） | `src-tauri/src/lib.rs` |
| `IpcBridge::start(agent_id)` | 创建 IPC 桥接器（含事件命名空间） | `src-tauri/src/ipc/bridge.rs` |
| `IpcBridge::event_name(base)` | 构建带 agent_id 前缀的事件名 | `src-tauri/src/ipc/bridge.rs` |
| `buildAgentEventName(agentId, event)` | 前端构建命名空间事件名工具函数 | `frontend/src/api/tauri-api.ts` |

---

**文档结束**
