pub mod ipc_bridge;
pub mod lifecycle;
pub mod process;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tokio::sync::{mpsc, Mutex, RwLock};

use ipc_bridge::IpcBridge;
use lifecycle::{LifecycleConfig, LifecycleManager};
use process::{resolve_sidecar_path, AgentProcess};

/// 单个 Agent 实例的运行时状态
struct AgentInstance {
    /// 子进程句柄
    process: AgentProcess,
    /// stdin writer channel sender
    write_tx: mpsc::Sender<String>,
    /// IPC 通信桥接器
    ipc: Arc<IpcBridge>,
    /// 工作目录
    #[allow(dead_code)]
    cwd: String,
    /// 生命周期管理器
    lifecycle: Arc<LifecycleManager>,
    /// 心跳任务句柄
    heartbeat_handle: Option<tokio::task::JoinHandle<()>>,
    /// 最后活跃时间（用于空闲超时检测）
    last_activity: Arc<RwLock<Instant>>,
}

/// AgentManager：管理多个 Bun Sidecar 子进程实例的完整生命周期
/// 每个 agent_id 对应一个独立的 AgentInstance（进程 + IPC bridge）
pub struct AgentManager {
    /// 所有运行中的 Agent 实例，key 为 agent_id
    agents: Arc<RwLock<HashMap<String, AgentInstance>>>,
    /// 保存 Tauri AppHandle（用于路径解析和事件转发）
    app_handle: Arc<RwLock<Option<tauri::AppHandle>>>,
    /// 生命周期配置（所有实例共用）
    lifecycle_config: LifecycleConfig,
    /// 空闲监控任务是否已启动（lazy 启动，避免在 Tokio runtime 就绪前调用）
    idle_monitor_started: Arc<AtomicBool>,
    /// 启动串行化锁：确保并发检查+启动为原子操作，消除 TOCTOU 竞态条件
    start_lock: Mutex<()>,
}

/// 返回最大并发 Agent 数量（默认 5，可通过环境变量 MAX_CONCURRENT_AGENTS 覆盖）
fn max_concurrent_agents() -> usize {
    std::env::var("MAX_CONCURRENT_AGENTS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
}

impl AgentManager {
    /// 创建新的 AgentManager 实例（使用默认生命周期配置）
    pub fn new() -> Self {
        let mut config = LifecycleConfig::default();
        config.start_timeout_ms = 30_000; // 30秒超时
        Self {
            agents: Arc::new(RwLock::new(HashMap::new())),
            app_handle: Arc::new(RwLock::new(None)),
            lifecycle_config: config,
            idle_monitor_started: Arc::new(AtomicBool::new(false)),
            start_lock: Mutex::new(()),
        }
    }

    /// 启动空闲监控任务（每 60 秒检查一次，5 分钟无活动自动回收）
    fn start_idle_monitor(agents: Arc<RwLock<HashMap<String, AgentInstance>>>) {
        tokio::spawn(async move {
            let idle_timeout = std::time::Duration::from_secs(300); // 5分钟

            loop {
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;

                // 阶段1: read lock 收集超时 agent 列表
                let to_remove = {
                    let agents_guard = agents.read().await;
                    let mut expired = Vec::new();
                    for (agent_id, instance) in agents_guard.iter() {
                        // 不回收 "main" agent
                        if agent_id == "main" { continue; }
                        let last = {
                            let t = instance.last_activity.read().await;
                            *t
                        };
                        // 有活跃执行时跳过超时检查，防止长时间工具执行期间 Agent 被误判回收
                        if instance.ipc.has_active_streams().await {
                            log::debug!("AgentManager: agent={} 有活跃执行，跳过超时检查", agent_id);
                            continue;
                        }
                        if last.elapsed() > idle_timeout {
                            expired.push(agent_id.clone());
                        }
                    }
                    expired
                }; // read lock 释放

                // 阶段2: 逐个清理
                for agent_id in to_remove {
                    log::info!("AgentManager: 回收空闲 Agent {}", agent_id);
                    let mut agents_guard = agents.write().await;
                    if let Some(mut instance) = agents_guard.remove(&agent_id) {
                        // abort heartbeat
                        if let Some(h) = instance.heartbeat_handle.take() {
                            h.abort();
                        }
                        // 发送 shutdown 信号
                        let shutdown_msg = serde_json::json!({
                            "jsonrpc": "2.0",
                            "method": "shutdown",
                            "id": serde_json::Value::Null
                        }).to_string();
                        let _ = instance.write_tx.send(shutdown_msg).await;
                        log::info!("AgentManager: Agent {} 已回收", agent_id);
                        // instance drop 时 kill_on_drop 兜底
                    }
                }
            }
        });
    }

    /// 启动指定 agent_id 的 Sidecar 子进程
    ///
    /// - `agent_id`: Agent 唯一标识（如 "main"）
    /// - `cwd`: 工作目录
    /// - `app_handle`: Tauri AppHandle
    ///
    /// 若该 agent_id 已在运行，直接返回 Ok（幂等）
    pub async fn start_agent(
        &self,
        agent_id: &str,
        cwd: &str,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<()> {
        // Lazy 启动空闲监控：首次 start_agent 调用时（Tokio runtime 已就绪）启动
        if !self.idle_monitor_started.swap(true, Ordering::SeqCst) {
            Self::start_idle_monitor(Arc::clone(&self.agents));
        }

        // 保存 app_handle（供后续操作使用）
        {
            let mut handle_guard = self.app_handle.write().await;
            *handle_guard = Some(app_handle.clone());
        }

        // 获取启动串行化锁，防止 TOCTOU 竞态：确保并发检查+启动为原子操作
        // guard 在整个 start_agent 方法（包括 eviction 和 do_start_agent）期间保持持有
        let _start_guard = self.start_lock.lock().await;

        // 幂等检查 + 并发限制检查
        {
            let agents = self.agents.read().await;
            if agents.contains_key(agent_id) {
                log::info!("AgentManager: agent {} 已在运行，跳过启动", agent_id);
                return Ok(());
            }
            // 检查并发限制（"main" agent 不受限制）
            if agent_id != "main" && agents.len() >= max_concurrent_agents() {
                drop(agents);
                let max = max_concurrent_agents();
                log::warn!("AgentManager: 达到并发上限 {}，尝试回收最久未用 Agent", max);
                // 重试最多 2 次 evict，间隔 500ms
                let mut evict_ok = false;
                for attempt in 0..=1usize {
                    if attempt > 0 {
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    }
                    match self.evict_idle_agent().await {
                        Ok(()) => {
                            evict_ok = true;
                            break;
                        }
                        Err(e) => {
                            log::warn!("AgentManager: evict 第{}次失败: {}", attempt + 1, e);
                        }
                    }
                }
                if !evict_ok {
                    return Err(anyhow::anyhow!(
                        "CONCURRENT_LIMIT_EXCEEDED: 当前并发 Agent 数已达上限({})，请关闭不需要的 Agent 后重试",
                        max
                    ));
                }
            }
        }

        self.do_start_agent(agent_id, cwd, app_handle).await
    }

    /// 回收最久未使用的 agent（排除 main）
    async fn evict_idle_agent(&self) -> anyhow::Result<()> {
        let oldest_id = {
            let agents = self.agents.read().await;
            let mut oldest: Option<(String, Instant)> = None;
            for (id, inst) in agents.iter() {
                if id == "main" { continue; }
                let t = { *inst.last_activity.read().await };
                if oldest.is_none() || t < oldest.as_ref().unwrap().1 {
                    oldest = Some((id.clone(), t));
                }
            }
            oldest.map(|(id, _)| id)
        };

        if let Some(id) = oldest_id {
            log::info!("AgentManager: 达到并发上限，回收最久未用 Agent {}", id);
            self.stop_agent(&id).await?;
            Ok(())
        } else {
            Err(anyhow::anyhow!("evict_idle_agent: 没有可回收的非 main agent"))
        }
    }

    /// 内部启动逻辑（新建 AgentInstance 并插入 HashMap）
    async fn do_start_agent(
        &self,
        agent_id: &str,
        cwd: &str,
        app_handle: tauri::AppHandle,
    ) -> anyhow::Result<()> {
        process::debug_log(&format!("AgentManager::do_start_agent: agent_id={} cwd={}", agent_id, cwd));
        log::info!("AgentManager::do_start_agent: agent_id={} cwd={}", agent_id, cwd);

        // 1. 解析 sidecar 路径
        let sidecar_path = resolve_sidecar_path(&app_handle)?;
        let sidecar_path_str = sidecar_path.to_string_lossy().to_string();

        // 2. 创建此 agent 的 LifecycleManager
        let lifecycle = Arc::new(LifecycleManager::new(self.lifecycle_config.clone()));
        // prepare_start 将状态置为 Starting；我们使用 IpcBridge 侧的 ready channel，
        // 因此将 prepare_start 返回的 rx drop 掉（不用），改用下面独立的 oneshot channel
        let _unused_ready_rx = lifecycle.prepare_start().await;

        // 3. 启动子进程，注入 AGENT_ID 和 SIDECAR_CWD 环境变量
        let (agent_proc, stdout, exit_rx) = AgentProcess::spawn_with_env(
            &sidecar_path_str,
            cwd,
            &[("AGENT_ID", agent_id), ("SIDECAR_CWD", cwd)],
        ).await?;

        // 4. 创建 stdin writer channel（缓冲 256 条消息）
        let (write_tx, mut write_rx) = mpsc::channel::<String>(256);

        // 5. 创建 IpcBridge（带 agent_id 命名空间）
        let (ready_tx_for_ipc, ready_rx_for_lifecycle) = tokio::sync::oneshot::channel::<()>();
        let ipc = Arc::new(IpcBridge::start(
            stdout,
            write_tx.clone(),
            Some(ready_tx_for_ipc),
            app_handle.clone(),
            agent_id.to_string(),
        ));

        // 6. 启动 stdin writer task（将 channel 消息写入子进程 stdin）
        {
            // 此处不能直接持有 agent_proc（需要插入 HashMap），
            // 改用 write_tx channel 由 HashMap 中的 process 所在 task 写入
            // 实际写入由下方 task 完成，但需要持有 AgentProcess 的所有权。
            // 方案：在 AgentInstance 插入前先启动 writer task，通过 Arc<Mutex<AgentProcess>> 共享
            // 为简化，直接在 do_start_agent 中启动 writer task，捕获 process Arc
            // 先把 write_rx 交给 writer task（下方 spawn）
        }
        let write_tx_clone = write_tx.clone();
        let agent_id_str = agent_id.to_string();

        // 7. 等待 $/ready 通知
        log::info!("AgentManager: agent={} 开始等待 $/ready（超时: {}ms）",
            agent_id, self.lifecycle_config.start_timeout_ms);

        match lifecycle.wait_for_ready(ready_rx_for_lifecycle).await {
            Ok(()) => {
                log::info!("AgentManager: agent={} 就绪", agent_id);
            }
            Err(e) => {
                log::error!("AgentManager: agent={} 等待就绪失败: {}", agent_id, e);
                return Err(e);
            }
        }

        // 8. 启动心跳任务
        let heartbeat_handle = {
            let hb_ipc = Arc::clone(&ipc);
            let hb_lifecycle = Arc::clone(&lifecycle);
            let hb_agent_id = agent_id.to_string();
            Some(hb_lifecycle.start_heartbeat(hb_ipc, move || {
                log::error!("AgentManager: agent={} 心跳失败", hb_agent_id);
            }))
        };

        // 9. 进程退出监控 task
        let agents_ref = Arc::clone(&self.agents);
        let exit_agent_id = agent_id.to_string();
        tokio::spawn(async move {
            match exit_rx.await {
                Ok(status) => {
                    let code = status.code();
                    #[cfg(unix)]
                    let signal = {
                        use std::os::unix::process::ExitStatusExt;
                        status.signal()
                    };
                    #[cfg(not(unix))]
                    let signal: Option<i32> = None;

                    log::error!(
                        "AgentManager: agent {} 进程意外退出 — exit_code={:?} signal={:?}",
                        exit_agent_id, code, signal
                    );
                    process::debug_log(&format!(
                        "[AGENT-EXIT] agent={} code={:?} signal={:?}",
                        exit_agent_id, code, signal
                    ));

                    let mut agents = agents_ref.write().await;
                    if let Some(mut inst) = agents.remove(&exit_agent_id) {
                        if let Some(h) = inst.heartbeat_handle.take() {
                            h.abort();
                        }
                        log::warn!("AgentManager: agent {} 已从 HashMap 移除（进程已退出）", exit_agent_id);
                    }
                }
                Err(_) => {
                    // sender dropped（正常 stop 流程）
                    log::info!("AgentManager: agent {} 退出监控 task 结束（正常关闭）", exit_agent_id);
                }
            }
        });

        // 10. 构建 AgentInstance 并原子插入 HashMap
        let last_activity = Arc::new(RwLock::new(Instant::now()));
        let instance = AgentInstance {
            process: agent_proc,
            write_tx: write_tx_clone,
            ipc: Arc::clone(&ipc),
            cwd: cwd.to_string(),
            lifecycle: Arc::clone(&lifecycle),
            heartbeat_handle,
            last_activity: Arc::clone(&last_activity),
        };

        {
            let mut agents = self.agents.write().await;
            match agents.entry(agent_id.to_string()) {
                std::collections::hash_map::Entry::Vacant(e) => {
                    e.insert(instance);
                }
                std::collections::hash_map::Entry::Occupied(_) => {
                    log::warn!("AgentManager: agent {} 已被并发启动，丢弃本次实例", agent_id);
                    // instance 被 drop，子进程通过 kill_on_drop 自动结束
                    return Ok(());
                }
            }
        }

        // 11. 启动 stdin writer task（在 instance 插入后启动）
        let agents_for_writer = Arc::clone(&self.agents);
        let writer_agent_id = agent_id_str.clone();
        tokio::spawn(async move {
            let mut msg_count = 0u64;
            while let Some(line) = write_rx.recv().await {
                msg_count += 1;
                if msg_count <= 100 || msg_count % 50 == 0 {
                    let preview = if line.len() > 100 { &line[..100] } else { &line };
                    process::debug_log(&format!("[stdin-writer][{}] #{} writing: {}", writer_agent_id, msg_count, preview));
                }
                let mut agents = agents_for_writer.write().await;
                if let Some(inst) = agents.get_mut(&writer_agent_id) {
                    let write_start = std::time::Instant::now();
                    if let Err(e) = inst.process.write_line(&line).await {
                        process::debug_log(&format!("[stdin-writer][{}] #{} FAILED: {}", writer_agent_id, msg_count, e));
                        log::error!("AgentManager: agent={} 写入 stdin 失败: {}", writer_agent_id, e);
                        break;
                    }
                    let elapsed = write_start.elapsed();
                    if elapsed.as_millis() > 100 {
                        process::debug_log(&format!("[stdin-writer][{}] #{} SLOW write: {}ms", writer_agent_id, msg_count, elapsed.as_millis()));
                    }
                } else {
                    process::debug_log(&format!("[stdin-writer][{}] #{} agent stopped, discarding", writer_agent_id, msg_count));
                    log::warn!("AgentManager: agent={} 已停止，丢弃消息", writer_agent_id);
                    break;
                }
            }
            log::info!("AgentManager: agent={} stdin writer task 退出", writer_agent_id);
        });

        log::info!("AgentManager: agent={} 启动完成 path={} cwd={}", agent_id, sidecar_path_str, cwd);
        Ok(())
    }

    /// 停止指定 agent_id 的 Sidecar 子进程（优雅关闭）
    pub async fn stop_agent(&self, agent_id: &str) -> anyhow::Result<()> {
        // 阶段1：持有 write lock，从 HashMap 中移除 instance，然后立即释放锁
        let removed = {
            let mut agents = self.agents.write().await;
            agents.remove(agent_id)
        }; // write lock 在此立即释放，不再阻塞其他 agent 操作

        if let Some(mut inst) = removed {
            // 先 abort 心跳，防止心跳继续干扰
            if let Some(h) = inst.heartbeat_handle.take() {
                h.abort();
            }

            // 阶段2：在 lock 释放后执行 graceful_shutdown（加 3 秒整体超时兜底）
            // 即使 shutdown 卡住，也不会阻塞其他 agent 操作
            let write_tx = inst.write_tx.clone();
            let shutdown_result = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                inst.lifecycle.graceful_shutdown(&mut inst.process, &write_tx),
            ).await;
            match shutdown_result {
                Ok(Ok(())) => {
                    log::info!("AgentManager: agent={} 已优雅关闭", agent_id);
                }
                Ok(Err(e)) => {
                    log::warn!("AgentManager: agent={} 优雅关闭失败（kill_on_drop 兜底）: {}", agent_id, e);
                }
                Err(_) => {
                    log::warn!("AgentManager: agent={} graceful_shutdown 超时（3s），依赖 kill_on_drop 清理", agent_id);
                }
            }
            // inst drop 时 AgentProcess.child.kill_on_drop 自动 kill
            log::info!("AgentManager: agent={} 已停止", agent_id);
        } else {
            log::warn!("AgentManager: agent={} 不存在，忽略 stop", agent_id);
        }
        Ok(())
    }

    /// 获取指定 agent_id 的 IpcBridge
    pub async fn get_agent_ipc(&self, agent_id: &str) -> anyhow::Result<Arc<IpcBridge>> {
        let agents = self.agents.read().await;
        agents
            .get(agent_id)
            .map(|inst| Arc::clone(&inst.ipc))
            .ok_or_else(|| anyhow::anyhow!("SIDECAR_NOT_RUNNING: agent={} 未运行", agent_id))
    }

    /// 检查指定 agent_id 是否正在运行
    pub async fn is_agent_running(&self, agent_id: &str) -> bool {
        let agents = self.agents.read().await;
        agents.contains_key(agent_id)
    }

    /// 获取所有正在运行的 agent_id 列表
    pub async fn get_running_agents(&self) -> Vec<String> {
        let agents = self.agents.read().await;
        agents.keys().cloned().collect()
    }

    /// 停止所有运行中的 Agent 实例
    pub async fn stop_all(&self) -> anyhow::Result<()> {
        let agent_ids: Vec<String> = {
            let agents = self.agents.read().await;
            agents.keys().cloned().collect()
        };
        for agent_id in agent_ids {
            if let Err(e) = self.stop_agent(&agent_id).await {
                log::error!("AgentManager: stop_all: agent={} 停止失败: {}", agent_id, e);
            }
        }
        Ok(())
    }

    /// 更新指定 agent_id 的最后活跃时间
    pub async fn touch_agent(&self, agent_id: &str) {
        let agents = self.agents.read().await;
        if let Some(inst) = agents.get(agent_id) {
            let mut t = inst.last_activity.write().await;
            *t = Instant::now();
        }
    }

    // =========== 向后兼容的公共接口（默认 agent_id="main"）===========

    /// 启动 Sidecar（默认 agent_id="main"，向后兼容）
    pub async fn start(&self, cwd: &str, app_handle: tauri::AppHandle) -> anyhow::Result<()> {
        self.start_agent("main", cwd, app_handle).await
    }

    /// 停止 Sidecar（默认 agent_id="main"，向后兼容）
    pub async fn stop(&self) -> anyhow::Result<()> {
        self.stop_agent("main").await
    }

    /// 检查默认 agent（"main"）是否正在运行（向后兼容）
    pub async fn is_running(&self) -> bool {
        self.is_agent_running("main").await
    }

    /// 发送 JSON-RPC 请求并等待单次响应（默认 agent_id="main"，向后兼容）
    pub async fn send_request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let ipc = self.get_agent_ipc("main").await?;
        ipc.request(method, params).await
    }

    /// 发送 JSON-RPC 请求并等待单次响应（指定 agent_id）
    pub async fn send_request_for_agent(
        &self,
        agent_id: &str,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let ipc = self.get_agent_ipc(agent_id).await?;
        ipc.request(method, params).await
    }

    /// 发送流式执行请求（默认 agent_id="main"，向后兼容）
    pub async fn execute(
        &self,
        content: &str,
        options: Option<serde_json::Value>,
    ) -> anyhow::Result<tokio::sync::mpsc::Receiver<serde_json::Value>> {
        let ipc = self.get_agent_ipc("main").await?;
        ipc.execute(content, options).await
    }

    /// 发送流式执行请求（指定 agent_id）
    pub async fn execute_for_agent(
        &self,
        agent_id: &str,
        content: &str,
        options: Option<serde_json::Value>,
    ) -> anyhow::Result<tokio::sync::mpsc::Receiver<serde_json::Value>> {
        let ipc = self.get_agent_ipc(agent_id).await?;
        match ipc.execute(content, options).await {
            Ok(rx) => Ok(rx),
            Err(e) => {
                let err_msg = e.to_string();
                // 如果 channel 已关闭，说明 agent 进程已退出但未被清理
                // 停止 agent 让下次调用重新启动
                if err_msg.contains("channel 已关闭") || err_msg.contains("channel closed") {
                    log::warn!("AgentManager: agent={} channel 已关闭，执行停止清理", agent_id);
                    let _ = self.stop_agent(agent_id).await;
                    Err(anyhow::anyhow!("SIDECAR_NOT_RUNNING: agent={} 已停止（channel 关闭）", agent_id))
                } else {
                    Err(e)
                }
            }
        }
    }

    /// 回传权限请求的用户决策到指定 agent 的 sidecar
    pub async fn resolve_permission_for_agent(
        &self,
        agent_id: &str,
        request_id: &str,
        decision: serde_json::Value,
    ) -> anyhow::Result<()> {
        let ipc = self.get_agent_ipc(agent_id).await?;
        ipc.resolve_permission(request_id, decision).await
    }

    /// 回传权限请求的用户决策到 sidecar（向后兼容，默认 agent_id="main"）
    pub async fn resolve_permission(
        &self,
        request_id: &str,
        decision: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.resolve_permission_for_agent("main", request_id, decision).await
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}
