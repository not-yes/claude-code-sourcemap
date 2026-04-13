use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, RwLock};

use crate::agent::ipc_bridge::IpcBridge;

/// 生命周期状态机
///
/// 状态转换：Starting → Ready → Running → Stopping → Stopped
///                                     ↓            ↑
///                                  Crashed → Restarting ─┘
#[derive(Debug, Clone, PartialEq)]
#[allow(dead_code)]
pub enum LifecycleState {
    /// 已停止（初始或正常关闭后）
    Stopped,
    /// 正在启动（等待 $/ready notification）
    Starting,
    /// 已就绪（收到 $/ready，过渡到 Running）
    Ready,
    /// 运行中
    Running,
    /// 正在优雅关闭
    Stopping,
    /// 已崩溃（意外退出）
    Crashed { error: String, restart_count: u32 },
    /// 重启中（指数退避等待后重启）
    Restarting { attempt: u32 },
}

/// 生命周期配置
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct LifecycleConfig {
    /// 启动超时（毫秒），等待 $/ready 的最长时间，默认 10000
    pub start_timeout_ms: u64,
    /// 最大重启次数，默认 3
    pub max_restarts: u32,
    /// 基础重启延迟（毫秒），默认 1000
    pub restart_base_delay_ms: u64,
    /// 最大重启延迟（毫秒），默认 30000
    pub restart_max_delay_ms: u64,
    /// 心跳间隔（毫秒），默认 30000
    pub heartbeat_interval_ms: u64,
    /// 心跳超时（毫秒），默认 5000
    pub heartbeat_timeout_ms: u64,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        Self {
            start_timeout_ms: 10_000,
            max_restarts: 3,
            restart_base_delay_ms: 1_000,
            restart_max_delay_ms: 30_000,
            heartbeat_interval_ms: 30_000,
            heartbeat_timeout_ms: 5_000,
        }
    }
}

/// 进程退出后的处理动作
#[derive(Debug)]
#[allow(dead_code)]
pub enum RestartAction {
    /// 需要重启，附带延迟时间（毫秒）
    Restart { delay_ms: u64 },
    /// 已达最大重启次数或无法恢复，放弃重启
    GiveUp { reason: String },
    /// 正常退出（由 stop() 触发），不需重启
    Normal,
}

/// 进程生命周期管理器
///
/// 负责：
/// - 等待 $/ready notification（启动超时检测）
/// - 处理进程意外退出（指数退避自动重启）
/// - 优雅关闭（shutdown → SIGTERM → SIGKILL 三阶段）
/// - 健康心跳检测（定期 ping）
pub struct LifecycleManager {
    /// 当前生命周期状态
    state: Arc<RwLock<LifecycleState>>,
    /// 配置参数
    pub config: LifecycleConfig,
    /// 用于通知 $/ready 已收到的 oneshot sender（启动后由 IpcBridge 调用）
    ready_tx: Arc<tokio::sync::Mutex<Option<oneshot::Sender<()>>>>,
}

impl LifecycleManager {
    /// 创建新的 LifecycleManager（初始状态为 Stopped）
    pub fn new(config: LifecycleConfig) -> Self {
        Self {
            state: Arc::new(RwLock::new(LifecycleState::Stopped)),
            config,
            ready_tx: Arc::new(tokio::sync::Mutex::new(None)),
        }
    }

    /// 使用默认配置创建
    #[allow(dead_code)]
    pub fn with_defaults() -> Self {
        Self::new(LifecycleConfig::default())
    }

    /// 获取当前状态快照
    #[allow(dead_code)]
    pub async fn state(&self) -> LifecycleState {
        self.state.read().await.clone()
    }

    /// 设置状态
    pub async fn set_state(&self, new_state: LifecycleState) {
        let mut guard = self.state.write().await;
        log::info!("LifecycleManager: 状态变更 {:?} → {:?}", *guard, new_state);
        *guard = new_state;
    }

    /// 准备启动：将状态置为 Starting，并创建 ready channel
    ///
    /// 返回 ready_rx，调用方在 wait_for_ready 中持有此 receiver
    pub async fn prepare_start(&self) -> oneshot::Receiver<()> {
        self.set_state(LifecycleState::Starting).await;
        let (tx, rx) = oneshot::channel::<()>();
        let mut guard = self.ready_tx.lock().await;
        *guard = Some(tx);
        rx
    }

    /// 等待 $/ready notification，在指定超时内未收到则返回错误
    ///
    /// - `ready_rx`: 由 `prepare_start()` 返回的 receiver
    pub async fn wait_for_ready(&self, ready_rx: oneshot::Receiver<()>) -> anyhow::Result<()> {
        let timeout_ms = self.config.start_timeout_ms;
        let result = tokio::time::timeout(Duration::from_millis(timeout_ms), ready_rx).await;

        match result {
            Ok(Ok(())) => {
                // 收到 ready，状态更新为 Running
                self.set_state(LifecycleState::Running).await;
                log::info!("LifecycleManager: 子进程已就绪，进入 Running 状态");
                Ok(())
            }
            Ok(Err(_)) => {
                // sender 已 drop（进程崩溃？）
                self.set_state(LifecycleState::Crashed {
                    error: "ready channel 意外关闭".to_string(),
                    restart_count: 0,
                })
                .await;
                Err(anyhow::anyhow!("等待 $/ready 时 channel 意外关闭"))
            }
            Err(_) => {
                // 超时
                self.set_state(LifecycleState::Crashed {
                    error: format!("启动超时（{}ms）", timeout_ms),
                    restart_count: 0,
                })
                .await;
                Err(anyhow::anyhow!("子进程启动超时（{}ms 内未收到 $/ready）", timeout_ms))
            }
        }
    }

    /// 通知已收到 $/ready notification
    ///
    /// 由 IpcBridge 的 dispatch_message 调用（备用接口，当前由 IpcBridge 内部直接触发）
    #[allow(dead_code)]
    pub async fn notify_ready(&self) {
        let mut guard = self.ready_tx.lock().await;
        if let Some(tx) = guard.take() {
            let _ = tx.send(());
            log::info!("LifecycleManager: 已发送 ready 通知");
        } else {
            log::warn!("LifecycleManager: notify_ready 调用时 ready_tx 为 None（重复调用？）");
        }
    }

    /// 处理进程退出：判断是否需要重启
    ///
    /// - `exit_status`: 子进程退出状态
    /// - 若当前为 Stopping，视为正常退出
    /// - 否则按崩溃处理，根据重启次数决定是否重启
    #[allow(dead_code)]
    pub async fn on_process_exit(
        &self,
        exit_status: std::process::ExitStatus,
    ) -> RestartAction {
        let current = self.state().await;

        match current {
            // 正在优雅关闭触发的退出，视为正常
            LifecycleState::Stopping => {
                self.set_state(LifecycleState::Stopped).await;
                log::info!("LifecycleManager: 进程正常退出（状态码: {:?}）", exit_status.code());
                RestartAction::Normal
            }

            // 已经停止（例如 stop() 后再次触发），忽略
            LifecycleState::Stopped => {
                log::debug!("LifecycleManager: 进程退出事件（已处于 Stopped 状态，忽略）");
                RestartAction::Normal
            }

            // 崩溃状态下进一步退出
            LifecycleState::Crashed { restart_count, .. } => {
                self.try_restart(restart_count, &exit_status).await
            }

            // Running/Starting/Ready 等状态下意外退出 → 崩溃
            _ => {
                log::error!(
                    "LifecycleManager: 进程意外退出（状态: {:?}, 退出码: {:?}）",
                    current,
                    exit_status.code()
                );
                self.try_restart(0, &exit_status).await
            }
        }
    }

    /// 内部：根据重启次数决定是否重启，并更新状态
    #[allow(dead_code)]
    async fn try_restart(
        &self,
        restart_count: u32,
        exit_status: &std::process::ExitStatus,
    ) -> RestartAction {
        if restart_count >= self.config.max_restarts {
            let reason = format!(
                "进程退出（码: {:?}），已达最大重启次数（{}次）",
                exit_status.code(),
                self.config.max_restarts
            );
            log::error!("LifecycleManager: {}", reason);
            self.set_state(LifecycleState::Crashed {
                error: reason.clone(),
                restart_count,
            })
            .await;
            RestartAction::GiveUp { reason }
        } else {
            let delay_ms = self.calculate_restart_delay(restart_count);
            let next_attempt = restart_count + 1;
            log::warn!(
                "LifecycleManager: 进程崩溃，第 {} 次重启（延迟 {}ms）",
                next_attempt,
                delay_ms
            );
            self.set_state(LifecycleState::Restarting { attempt: next_attempt }).await;
            RestartAction::Restart { delay_ms }
        }
    }

    /// 计算指数退避重启延迟（毫秒）
    ///
    /// delay = min(base * 2^attempt, max_delay)
    #[allow(dead_code)]
    fn calculate_restart_delay(&self, attempt: u32) -> u64 {
        // 防止溢出：attempt 超过 63 时直接使用最大延迟
        let delay = if attempt >= 63 {
            u64::MAX
        } else {
            self.config.restart_base_delay_ms.saturating_mul(2u64.pow(attempt))
        };
        delay.min(self.config.restart_max_delay_ms)
    }

    /// 优雅关闭三阶段：
    ///
    /// 1. 发送 JSON-RPC `shutdown` notification → 等待进程退出（5秒超时）
    /// 2. 超时则调用 `kill()`（SIGKILL）→ 等待退出（3秒超时）
    /// 3. 再超时则记录日志，结束
    pub async fn graceful_shutdown(
        &self,
        process: &mut crate::agent::process::AgentProcess,
        write_tx: &tokio::sync::mpsc::Sender<String>,
    ) -> anyhow::Result<()> {
        // 标记正在停止，防止退出事件被误判为崩溃
        self.set_state(LifecycleState::Stopping).await;

        // 阶段 1：发送 JSON-RPC shutdown notification（无 id，不期待响应）
        let shutdown_msg =
            serde_json::json!({"jsonrpc": "2.0", "method": "shutdown"}).to_string();
        if let Err(e) = write_tx.send(shutdown_msg).await {
            log::warn!("LifecycleManager: 发送 shutdown 消息失败: {}（进程可能已退出）", e);
        } else {
            log::info!("LifecycleManager: 已发送 shutdown notification，等待进程退出（5秒）");
        }

        // 等待进程优雅退出（5秒超时）
        if tokio::time::timeout(Duration::from_secs(5), process.wait()).await.is_ok() {
            log::info!("LifecycleManager: 进程已优雅退出（阶段1）");
            self.set_state(LifecycleState::Stopped).await;
            return Ok(());
        }

        // 阶段 2：强制 kill（tokio kill 等同于 SIGKILL）
        log::warn!("LifecycleManager: shutdown 超时，强制 kill 进程");
        if let Err(e) = process.kill().await {
            log::error!("LifecycleManager: kill 失败: {}", e);
        }

        // 等待 kill 生效（3秒超时）
        if tokio::time::timeout(Duration::from_secs(3), process.wait()).await.is_ok() {
            log::info!("LifecycleManager: 进程已在 kill 后退出（阶段2）");
        } else {
            // 阶段 3：进程已经 kill，但 wait 超时，继续清理
            log::error!("LifecycleManager: kill 后等待超时，继续清理（进程可能已退出）");
        }

        self.set_state(LifecycleState::Stopped).await;
        Ok(())
    }

    /// 启动心跳检测 task
    ///
    /// 定期向子进程发送 `ping` 请求，超时无响应则调用 `on_failure` 回调。
    ///
    /// - `ipc`: IpcBridge 引用
    /// - `on_failure`: 心跳失败时的回调（应触发重启流程）
    ///
    /// 返回 JoinHandle，调用方可通过 `handle.abort()` 取消心跳任务
    pub fn start_heartbeat(
        &self,
        ipc: Arc<IpcBridge>,
        on_failure: impl Fn() + Send + 'static,
    ) -> tokio::task::JoinHandle<()> {
        let interval_ms = self.config.heartbeat_interval_ms;
        let timeout_ms = self.config.heartbeat_timeout_ms;

        tokio::spawn(async move {
            const MAX_HEARTBEAT_FAILURES: u32 = 3;
            let mut consecutive_failures: u32 = 0;

            let mut tick = tokio::time::interval(Duration::from_millis(interval_ms));
            // 跳过第一次立即触发的 tick，避免刚启动就发心跳
            tick.tick().await;

            loop {
                tick.tick().await;

                let result = tokio::time::timeout(
                    Duration::from_millis(timeout_ms),
                    ipc.request("ping", serde_json::json!({})),
                )
                .await;

                match result {
                    Ok(Ok(_)) => {
                        log::debug!("LifecycleManager: 心跳正常");
                        consecutive_failures = 0;
                    }
                    Ok(Err(e)) => {
                        consecutive_failures += 1;
                        log::warn!(
                            "LifecycleManager: 心跳请求失败 ({}/{}): {}",
                            consecutive_failures,
                            MAX_HEARTBEAT_FAILURES,
                            e
                        );
                        if consecutive_failures >= MAX_HEARTBEAT_FAILURES {
                            log::error!(
                                "LifecycleManager: 心跳连续失败 {} 次，触发故障处理",
                                consecutive_failures
                            );
                            on_failure();
                            break;
                        }
                    }
                    Err(_) => {
                        log::error!(
                            "LifecycleManager: 心跳超时（{}ms），触发故障处理",
                            timeout_ms
                        );
                        on_failure();
                        break;
                    }
                }
            }
            log::info!("LifecycleManager: 心跳任务已退出");
        })
    }
}
