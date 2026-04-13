use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{mpsc, oneshot, Mutex};

/// 日志采样器：对高频消息进行采样，降低日志频率
struct LogSampler {
    /// 每种消息类型的计数器
    counters: HashMap<String, u64>,
    /// 采样间隔：每 N 次记录一次
    sample_interval: u64,
}

impl LogSampler {
    fn new(sample_interval: u64) -> Self {
        Self {
            counters: HashMap::new(),
            sample_interval,
        }
    }

    /// 检查是否应该记录日志（达到采样间隔）
    fn should_log(&mut self, method: &str) -> bool {
        let counter = self.counters.entry(method.to_string()).or_insert(0);
        *counter += 1;
        if *counter >= self.sample_interval {
            *counter = 0;
            true
        } else {
            false
        }
    }
}

/// 安全截断 UTF-8 字符串，确保不会切在字符中间
fn safe_truncate(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    // 从 max_bytes 位置向前找到最近的字符边界
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// 活跃流式响应条目：保存 mpsc sender 和流创建时间戳，用于 stale 清理
struct StreamEntry {
    /// 向消费者推送流式事件的 channel sender
    tx: mpsc::Sender<serde_json::Value>,
    /// 流创建时间，用于检测残留 stream
    created_at: Instant,
}

/// JSON-RPC 协议处理与消息路由桥接器
/// 管理 pending 请求和活跃流式响应
pub struct IpcBridge {
    /// 自增请求 ID 生成器
    next_id: AtomicU64,
    /// pending 普通请求：id -> oneshot sender，用于返回单次响应
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    /// 活跃流式响应：executeId (string) -> StreamEntry（含 sender 和创建时间戳）
    /// 使用 String key，与 sidecar 协议中 executeId 为 string 保持一致
    active_streams: Arc<Mutex<HashMap<String, StreamEntry>>>,
    /// pending 权限请求：requestId -> (rpc_id, response sender)
    pending_permissions: Arc<Mutex<HashMap<String, (serde_json::Value, oneshot::Sender<serde_json::Value>)>>>,
    /// 向子进程 stdin 发送消息的 channel sender
    write_tx: mpsc::Sender<String>,
    /// 用于通知 LifecycleManager 收到 $/ready 的 oneshot sender
    /// 仅在等待启动就绪时有效，触发后清空
    #[allow(dead_code)]
    ready_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    /// Tauri AppHandle，用于向前端 emit 权限请求事件
    /// dispatch_message 中通过参数引用传入，此处保存备用（如重启后替换）
    #[allow(dead_code)]
    app_handle: tauri::AppHandle,
    /// Agent 实例标识符，用于事件命名空间隔离
    /// 默认值为 "main"，Phase 1 多实例时会传入实际 agent_id
    #[allow(dead_code)]
    agent_id: String,
}

impl IpcBridge {
    /// 创建 IpcBridge，启动 stdout reader task 和 stdin writer task
    ///
    /// - `stdout`: 子进程的 stdout，由 reader task 持续读取 NDJSON 行
    /// - `stdin_write_tx`: 向子进程 stdin 写入的 channel sender（由 AgentManager 持有）
    /// - `ready_tx`: 可选的 oneshot sender，收到 $/ready 时触发，通知 LifecycleManager
    /// - `app_handle`: Tauri AppHandle，用于 emit 权限请求事件到前端
    pub fn start(
        stdout: tokio::process::ChildStdout,
        stdin_write_tx: mpsc::Sender<String>,
        ready_tx: Option<oneshot::Sender<()>>,
        app_handle: tauri::AppHandle,
        agent_id: String,
    ) -> Self {
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        // active_streams 改为 String key -> StreamEntry（含时间戳），与协议中 executeId 为 string 对齐
        let active_streams: Arc<Mutex<HashMap<String, StreamEntry>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending_permissions: Arc<Mutex<HashMap<String, (serde_json::Value, oneshot::Sender<serde_json::Value>)>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let pending_clone = Arc::clone(&pending);
        let streams_clone = Arc::clone(&active_streams);
        let permissions_clone = Arc::clone(&pending_permissions);
        // 将 ready_tx 包装为共享引用，供 reader task 和结构体字段共用
        let ready_tx_arc: Arc<Mutex<Option<oneshot::Sender<()>>>> =
            Arc::new(Mutex::new(ready_tx));
        let ready_tx_clone = Arc::clone(&ready_tx_arc);
        // 克隆 app_handle 供 reader task 使用
        let app_handle_clone = app_handle.clone();
        // 克隆 agent_id 供 reader task 使用（避免所有权问题）
        let agent_id_clone = agent_id.clone();

        // 创建日志采样器：每 10 次记录一次（ping/getStats 等高频消息）
        let log_sampler: Arc<Mutex<LogSampler>> = Arc::new(Mutex::new(LogSampler::new(10)));
        let log_sampler_clone = Arc::clone(&log_sampler);

        // 启动异步 stdout reader task
        tokio::spawn(async move {
            log::info!("IpcBridge reader task: 已启动，开始监听 sidecar stdout");
            let mut reader = BufReader::new(stdout).lines();
            let mut line_count: u64 = 0;
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) if !line.trim().is_empty() => {
                        line_count += 1;
                        // 每行都记录摘要（前200字符），用于定位消息是否到达
                        log::debug!(
                            "IpcBridge: stdout 第{}行(前200字符): {}",
                            line_count,
                            line.chars().take(200).collect::<String>()
                        );
                        match serde_json::from_str::<serde_json::Value>(&line) {
                            Ok(msg) => {
                                Self::dispatch_message(
                                    msg,
                                    &pending_clone,
                                    &streams_clone,
                                    &permissions_clone,
                                    &ready_tx_clone,
                                    &app_handle_clone,
                                    &log_sampler_clone,
                                    &agent_id_clone,
                                )
                                .await;
                            }
                            Err(e) => {
                                log::warn!("IpcBridge: JSON 解析失败: {} | 原始行: {}", e, line);
                            }
                        }
                    }
                    Ok(None) => {
                        // EOF，子进程已退出
                        log::info!("IpcBridge: stdout EOF，子进程已退出");
                        break;
                    }
                    Ok(Some(_)) => {
                        // 空行，跳过
                    }
                    Err(e) => {
                        log::error!("IpcBridge: 读取 stdout 失败: {}", e);
                        break;
                    }
                }
            }
        });

        Self {
            next_id: AtomicU64::new(1),
            pending,
            active_streams,
            pending_permissions,
            write_tx: stdin_write_tx,
            ready_tx: ready_tx_arc,
            app_handle,
            agent_id,
        }
    }

    /// 构建带 agent_id 前缀的事件名
    /// 格式：`agent:{agent_id}:{base}`，例如 `agent:main:checkpoint:events`
    #[allow(dead_code)]
    fn event_name(&self, base: &str) -> String {
        format!("agent:{}:{}", self.agent_id, base)
    }

    /// 检查是否有活跃的流式执行（active_streams 非空）
    /// 用于空闲超时检查：执行期间跳过超时，防止长时间工具调用被误判回收
    pub async fn has_active_streams(&self) -> bool {
        !self.active_streams.lock().await.is_empty()
    }

    /// 更新 ready_tx：在重启后重新注入新的 oneshot sender
    ///
    /// 由 AgentManager 在每次重启时调用，确保新一轮启动能正确通知就绪
    #[allow(dead_code)]
    pub async fn set_ready_tx(&self, tx: oneshot::Sender<()>) {
        let mut guard = self.ready_tx.lock().await;
        *guard = Some(tx);
    }

    /// 发送 JSON-RPC 请求，等待单次响应（非流式）
    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        // 构造 JSON-RPC 2.0 请求
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let (tx, rx) = oneshot::channel::<serde_json::Value>();

        // 注册 pending 请求
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }

        // 发送请求到 stdin writer
        let line = req.to_string();
        self.write_tx
            .send(line)
            .await
            .map_err(|_| anyhow::anyhow!("IPC_ERROR: stdin writer channel 已关闭"))?;

        // 等待响应（超时 30 秒）
        let result = tokio::time::timeout(std::time::Duration::from_secs(30), rx).await;
        let response = match result {
            Ok(inner) => inner.map_err(|_| anyhow::anyhow!("IPC_ERROR: 请求通道关闭: method={}", method))?,
            Err(_) => {
                // 超时后清理 pending map，防止 oneshot sender 泄漏
                self.pending.lock().await.remove(&id);
                return Err(anyhow::anyhow!("IPC_ERROR: 请求超时: method={}", method));
            }
        };

        // 检查是否为错误响应
        if let Some(err) = response.get("error") {
            return Err(anyhow::anyhow!("RPC_ERROR: {}", err));
        }

        // 只返回 result 字段，而非整个 JSON-RPC envelope
        Ok(response.get("result").cloned().unwrap_or(serde_json::Value::Null))
    }

    /// 发送流式执行请求，返回 mpsc Receiver 用于接收事件流
    ///
    /// 修复：options 嵌套到 "options" 字段下（而非展平到顶层），executeId 转为 string
    pub async fn execute(
        &self,
        content: &str,
        options: Option<serde_json::Value>,
    ) -> anyhow::Result<mpsc::Receiver<serde_json::Value>> {
        let execute_id = self.next_id.fetch_add(1, Ordering::SeqCst);
        // executeId 使用 string 类型，与 sidecar 的 Zod schema 对齐
        let execute_id_str = execute_id.to_string();

        // 创建流式事件 channel（缓冲 128 个事件）
        let (stream_tx, stream_rx) = mpsc::channel::<serde_json::Value>(128);

        // 注册活跃流（key 为 string），记录创建时间戳用于 stale 清理
        {
            let mut streams = self.active_streams.lock().await;
            streams.insert(execute_id_str.clone(), StreamEntry {
                tx: stream_tx,
                created_at: Instant::now(),
            });
        }

        // 修复：options 嵌套到 "options" 字段，executeId 为 string
        let params = serde_json::json!({
            "content": content,
            "executeId": execute_id_str,
            "options": options.unwrap_or_else(|| serde_json::json!({})),
        });

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "execute",
            "params": params,
        });

        let line = req.to_string();
        log::info!(
            "IpcBridge: 发送 execute 请求到 sidecar, executeId={}, content前50字符: {}",
            execute_id_str,
            content.chars().take(50).collect::<String>()
        );
        self.write_tx
            .send(line)
            .await
            .map_err(|_| anyhow::anyhow!("IPC_ERROR: stdin writer channel 已关闭"))?;
        log::info!("IpcBridge: execute 请求已写入 stdin channel, executeId={}", execute_id_str);

        Ok(stream_rx)
    }

    /// 回传权限请求的用户决策到 sidecar
    ///
    /// - `request_id`: 权限请求的唯一标识（来自 params.requestId）
    /// - `decision`: 用户决策，通过 JSON-RPC response 回传给 sidecar
    pub async fn resolve_permission(
        &self,
        request_id: &str,
        decision: serde_json::Value,
    ) -> anyhow::Result<()> {
        // 从 pending_permissions 取出对应的 (rpc_id, sender)
        let entry = {
            let mut perm_map = self.pending_permissions.lock().await;
            perm_map.remove(request_id)
        };

        if let Some((rpc_id, _sender)) = entry {
            // 构造 JSON-RPC 2.0 response 写入 stdin，回传决策给 sidecar
            let response = serde_json::json!({
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": decision,
            });
            let line = response.to_string();
            self.write_tx
                .send(line)
                .await
                .map_err(|_| anyhow::anyhow!("IPC_ERROR: stdin writer channel 已关闭"))?;
            log::info!("IpcBridge: 权限响应已发送 requestId={}", request_id);
        } else {
            log::warn!("IpcBridge: 未找到权限请求 requestId={}", request_id);
        }

        Ok(())
    }

    /// 清理超过 30 分钟的残留 stream entry（保底清理，防止 active_streams 泄漏）
    pub async fn cleanup_stale_streams(&self) {
        let mut streams = self.active_streams.lock().await;
        let stale_threshold = std::time::Duration::from_secs(30 * 60);
        let before = streams.len();
        streams.retain(|id, entry| {
            let elapsed = entry.created_at.elapsed();
            let is_stale = elapsed > stale_threshold;
            if is_stale {
                log::warn!(
                    "[IpcBridge] 清理残留 stream: executeId={}, age={:?}",
                    id, elapsed
                );
            }
            !is_stale
        });
        let removed = before - streams.len();
        if removed > 0 {
            log::info!("[IpcBridge] 清理了 {} 个残留 stream", removed);
        }
    }

    /// 内部：根据消息类型分发到对应 pending 或 stream handler
    async fn dispatch_message(
        msg: serde_json::Value,
        pending: &Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
        active_streams: &Arc<Mutex<HashMap<String, StreamEntry>>>,
        pending_permissions: &Arc<Mutex<HashMap<String, (serde_json::Value, oneshot::Sender<serde_json::Value>)>>>,
        ready_tx: &Arc<Mutex<Option<oneshot::Sender<()>>>>,
        app_handle: &tauri::AppHandle,
        log_sampler: &Arc<Mutex<LogSampler>>,
        agent_id: &str,
    ) {
        let method = msg.get("method").and_then(|m| m.as_str()).map(|s| s.to_string());
        let id = msg.get("id").and_then(|v| v.as_u64());

        // 对高频消息进行日志采样
        let method_name = method.as_deref().unwrap_or("<response>");
        let should_log = {
            let mut sampler = log_sampler.lock().await;
            sampler.should_log(method_name)
        };

        if should_log {
            log::debug!(
                "IpcBridge: dispatch_message method={:?} id={:?} (sampled)",
                method_name,
                id
            );
        }

        match (id, method.as_deref()) {
            // 普通 JSON-RPC 响应（有 id 且有 result/error 字段）
            (Some(req_id), _) if msg.get("result").is_some() || msg.get("error").is_some() => {
                let mut pending_map = pending.lock().await;
                if let Some(sender) = pending_map.remove(&req_id) {
                    let _ = sender.send(msg);
                } else {
                    log::warn!("IpcBridge: 收到未知 id={} 的响应", req_id);
                }
            }

            // 流式数据事件
            // 修复：只推送 params.event 本体，而非整个 params
            (_, Some("$/stream")) => {
                // executeId 优先尝试 string，兼容 number 类型
                let execute_id = msg
                    .get("params")
                    .and_then(|p| p.get("executeId"))
                    .and_then(|v| {
                        if let Some(s) = v.as_str() {
                            Some(s.to_string())
                        } else {
                            v.as_u64().map(|n| n.to_string())
                        }
                    });

                if let Some(eid) = execute_id {
                    let mut streams = active_streams.lock().await;
                    let registered_keys: Vec<String> = streams.keys().cloned().collect();
                    log::info!("IpcBridge[{}]: $/stream 事件 executeId={}, 已注册的keys={:?}", agent_id, eid, registered_keys);
                    if let Some(entry) = streams.get(&eid) {
                        // 修复：只推送 params.event（SidecarStreamEvent 本体），而非整个 params
                        let event = msg
                            .get("params")
                            .and_then(|p| p.get("event"))
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        // 调试日志：记录收到的流式事件类型和内容摘要
                        let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("unknown");
                        let content_preview = if event_type == "error" {
                            // 对于错误类型，显示完整的 event JSON
                            serde_json::to_string(&event).unwrap_or_default()
                        } else {
                            event.get("content").and_then(|c| c.as_str()).map(|s| if s.len() > 50 { format!("{}...", safe_truncate(s, 50)) } else { s.to_string() }).unwrap_or_default()
                        };
                        log::info!("IpcBridge: 收到流式事件 executeId={} type={} content={}", eid, event_type, content_preview);
                        // 使用 try_send 非阻塞发送，避免缓冲区满时阻塞 reader task
                        match entry.tx.try_send(event) {
                            Ok(_) => { /* 正常发送 */ }
                            Err(tokio::sync::mpsc::error::TrySendError::Full(_)) => {
                                log::warn!("[IpcBridge] 流式事件缓冲区已满，丢弃事件 executeId={}", eid);
                                // 不阻塞 reader，丢弃此事件
                            }
                            Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
                                log::warn!("[IpcBridge] 流式 channel 已关闭，清理 executeId={}", eid);
                                streams.remove(&eid);
                            }
                        }
                    } else {
                        let registered_keys: Vec<String> = streams.keys().cloned().collect();
                        log::warn!(
                            "IpcBridge: 流式事件找不到 channel executeId={}, 当前注册的stream keys: {:?}",
                            eid,
                            registered_keys
                        );
                    }
                } else {
                    log::warn!("IpcBridge: $/stream 通知缺少 executeId 字段, msg={:?}", msg);
                }
            }

            // 流式完成通知：complete 事件已由 Sidecar 通过 $/stream 发送（包含 usage），此处只做收尾
            (_, Some("$/complete")) => {
                let execute_id = msg
                    .get("params")
                    .and_then(|p| p.get("executeId"))
                    .and_then(|v| {
                        if let Some(s) = v.as_str() {
                            Some(s.to_string())
                        } else {
                            v.as_u64().map(|n| n.to_string())
                        }
                    });

                if let Some(eid) = execute_id {
                    use tauri::Emitter;

                    // complete 事件已由 Sidecar 通过 $/stream 发送（包含正确 usage），此处不再重复 emit
                    // 关闭流 channel
                    let mut streams = active_streams.lock().await;
                    streams.remove(&eid);

                    // 发送 done 信号
                    let done_event = format!("agent:{}:stream:{}:done", agent_id, eid);
                    let _ = app_handle.emit(&done_event, serde_json::json!({"done": true}));

                    log::info!("IpcBridge: 流式执行完成 executeId={}", eid);
                }
            }

            // Checkpoint 通知：转发到前端
            (_, Some("$/checkpoint")) => {
                use tauri::Emitter;

                let session_id = msg
                    .get("params")
                    .and_then(|p| p.get("sessionId"))
                    .and_then(|s| s.as_str())
                    .unwrap_or("");

                let payload = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);

                // emit 通用 checkpoint 事件
                let _ = app_handle.emit(&format!("agent:{}:checkpoint:events", agent_id), &payload);

                // 如果有 sessionId，同时 emit 会话特定事件
                if !session_id.is_empty() {
                    let event_name = format!("agent:{}:checkpoint:events:{}", agent_id, session_id);
                    let _ = app_handle.emit(&event_name, &payload);
                    log::info!("IpcBridge: 收到 checkpoint 通知 sessionId={}", session_id);
                } else {
                    log::info!("IpcBridge: 收到 checkpoint 通知（无 sessionId）");
                }
            }

            // 流式错误通知：发送错误事件后关闭 mpsc sender
            // 修复：展平 message 字段，前端期望 { type: "error", message: "..." }
            (_, Some("$/streamError")) => {
                let execute_id = msg
                    .get("params")
                    .and_then(|p| p.get("executeId"))
                    .and_then(|v| {
                        if let Some(s) = v.as_str() {
                            Some(s.to_string())
                        } else {
                            v.as_u64().map(|n| n.to_string())
                        }
                    });

                if let Some(eid) = execute_id {
                    let mut streams = active_streams.lock().await;
                    if let Some(entry) = streams.remove(&eid) {
                        let msg_params = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
                        let message = msg_params
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("Stream error");
                        let code = msg_params
                            .get("code")
                            .and_then(|c| c.as_str())
                            .map(|s| s.to_string());

                        log::error!("IpcBridge: 流式执行错误 executeId={} message={} code={:?}", eid, message, code);

                        // 修复：展平为 { type: "error", message: "..." }，可选带 code
                        let mut error_event = serde_json::json!({
                            "type": "error",
                            "message": message,
                        });
                        if let Some(c) = code {
                            error_event["code"] = serde_json::Value::String(c);
                        }
                        let _ = entry.tx.send(error_event).await;
                    }
                }
            }

            // 子进程就绪通知：触发 LifecycleManager 的 ready 信号
            (_, Some("$/ready")) => {
                log::info!("IpcBridge: 收到 $/ready notification，通知 LifecycleManager");
                let mut guard = ready_tx.lock().await;
                if let Some(tx) = guard.take() {
                    let _ = tx.send(());
                } else {
                    log::warn!("IpcBridge: 收到 $/ready 但 ready_tx 为 None（已触发或未注册）");
                }
            }

            // 流结束通知（$/streamEnd）：清理 active_streams 中的对应条目
            (_, Some("$/streamEnd")) => {
                let execute_id = msg
                    .get("params")
                    .and_then(|p| p.get("executeId"))
                    .and_then(|v| {
                        if let Some(s) = v.as_str() {
                            Some(s.to_string())
                        } else {
                            v.as_u64().map(|n| n.to_string())
                        }
                    });

                if let Some(eid) = execute_id {
                    let mut streams = active_streams.lock().await;
                    if streams.remove(&eid).is_some() {
                        log::debug!(
                            "IpcBridge[{}]: $/streamEnd 清理 active_streams executeId={}",
                            agent_id, eid
                        );
                    } else {
                        log::debug!(
                            "IpcBridge[{}]: $/streamEnd 收到但 executeId={} 已不在 active_streams（可能已由 $/complete 清理）",
                            agent_id, eid
                        );
                    }
                } else {
                    log::warn!("IpcBridge: $/streamEnd 缺少 executeId 字段, msg={:?}", msg);
                }
            }

            // 执行结果通知（$/executeResult）：清理 active_streams 中的对应条目
            (_, Some("$/executeResult")) => {
                let execute_id = msg
                    .get("params")
                    .and_then(|p| p.get("executeId"))
                    .and_then(|v| {
                        if let Some(s) = v.as_str() {
                            Some(s.to_string())
                        } else {
                            v.as_u64().map(|n| n.to_string())
                        }
                    });

                if let Some(eid) = execute_id {
                    let mut streams = active_streams.lock().await;
                    if streams.remove(&eid).is_some() {
                        log::debug!(
                            "IpcBridge[{}]: $/executeResult 清理 active_streams executeId={}",
                            agent_id, eid
                        );
                    } else {
                        log::debug!(
                            "IpcBridge[{}]: $/executeResult 收到但 executeId={} 已不在 active_streams（可能已由 $/complete 清理）",
                            agent_id, eid
                        );
                    }
                } else {
                    log::warn!("IpcBridge: $/executeResult 缺少 executeId 字段, msg={:?}", msg);
                }
            }

            // Cron 任务完成通知：转发到前端
            (_, Some("$/cron")) => {
                use tauri::Emitter;
                let payload = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
                let _ = app_handle.emit(&format!("agent:{}:cron-complete", agent_id), &payload);
                log::info!("IpcBridge: Cron 任务完成通知已转发");
            }

            // 权限请求：通过 Tauri Event 转发到前端，等待用户响应后回传
            (_, Some("$/permissionRequest")) => {
                let params = msg.get("params").cloned().unwrap_or(serde_json::Value::Null);
                let request_id = params
                    .get("requestId")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                // rpc_id 原样保存为 serde_json::Value，支持 string/number 类型 id
                let rpc_id = msg.get("id").cloned().unwrap_or(serde_json::Value::Null);

                if let Some(rid) = request_id {
                    // 创建 oneshot channel 用于等待用户决策（当前架构中通过 resolve_permission 写入 stdin）
                    let (decision_tx, _decision_rx) = oneshot::channel::<serde_json::Value>();

                    // 保存到 pending_permissions，供 resolve_permission 方法取用
                    {
                        let mut perm_map = pending_permissions.lock().await;
                        perm_map.insert(rid.clone(), (rpc_id, decision_tx));
                    }

                    // 通过 Tauri Event 将权限请求转发到前端
                    use tauri::Emitter;
                    if let Err(e) = app_handle.emit(&format!("agent:{}:permission-request", agent_id), &params) {
                        log::error!("IpcBridge: 权限请求转发失败 requestId={} err={}", rid, e);
                    } else {
                        log::info!("IpcBridge: 权限请求已转发到前端 requestId={}", rid);
                    }
                } else {
                    log::warn!("IpcBridge: $/permissionRequest 缺少 requestId: {:?}", msg);
                }
            }

            // 新增：兜底匹配 — 有 id、无 method 的消息视为响应（应对 result 序列化缺失场景）
            (Some(req_id), None) => {
                log::warn!("IpcBridge: 收到无 result/error 的响应 id={}，按空响应处理", req_id);
                let mut pending_map = pending.lock().await;
                if let Some(sender) = pending_map.remove(&req_id) {
                    let _ = sender.send(msg);
                }
            }

            _ => {
                log::warn!("IpcBridge: 未识别的消息: {:?}", msg);
            }
        }
    }
}
