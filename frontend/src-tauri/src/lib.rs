mod agent;
mod plugins;

use agent::AgentManager;
use plugins::mac_rounded_corners;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

/// Tauri 状态包装器，使 AgentManager 可跨命令共享
pub struct AgentManagerState(pub Arc<AgentManager>);

/// 将 anyhow 错误转换为分类化字符串
/// - SIDECAR_NOT_RUNNING: 子进程未启动
/// - RPC_ERROR: Sidecar 返回了 JSON-RPC 错误响应
/// - IPC_ERROR: 发送/接收 JSON-RPC 消息失败
fn classify_error(e: anyhow::Error) -> String {
    let msg = e.to_string();
    // 错误字符串已包含分类前缀（来自 ipc_bridge 或 get_ipc）
    if msg.starts_with("SIDECAR_NOT_RUNNING") || msg.starts_with("IPC_ERROR") || msg.starts_with("RPC_ERROR") {
        msg
    } else {
        // 其他未分类的错误归类为 IPC_ERROR
        format!("IPC_ERROR: {}", msg)
    }
}

/// 判断 RPC 方法是否属于需要更新活跃时间的“活跃操作”
/// 区分“执行操作”（touch_agent）和“查询操作”（不 touch）
fn is_active_method(method: &str) -> bool {
    matches!(method, "execute" | "executeStream" | "abort" | "interrupt" | "createSession" | "sendMessage")
}

/// 从 options 中提取 agent_id，默认 "main"
fn extract_agent_id(options: &Option<serde_json::Value>) -> String {
    options
        .as_ref()
        .and_then(|o| o.get("agentId"))
        .and_then(|v| v.as_str())
        .unwrap_or("main")
        .to_string()
}

/// 从 options 中提取 cwd，默认空字符串
fn extract_cwd(options: &Option<serde_json::Value>) -> String {
    options
        .as_ref()
        .and_then(|o| o.get("cwd"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// 启动指定 Agent 的 Sidecar 子进程
/// 支持 agent_id 参数（默认 "main"）
#[tauri::command]
async fn agent_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    cwd: String,
    agent_id: Option<String>,
) -> Result<(), String> {
    let aid = agent_id.as_deref().unwrap_or("main");
    log::info!("agent_start: 启动 Agent agent_id={} cwd={}", aid, cwd);
    state
        .0
        .start_agent(aid, &cwd, app)
        .await
        .map_err(|e| e.to_string())
}

/// 停止指定 Agent 的 Sidecar 子进程
#[tauri::command]
async fn agent_stop(
    state: tauri::State<'_, AgentManagerState>,
    agent_id: Option<String>,
) -> Result<(), String> {
    let aid = agent_id.as_deref().unwrap_or("main");
    log::info!("agent_stop: 停止 Agent agent_id={}", aid);
    state.0.stop_agent(aid).await.map_err(|e| e.to_string())
}

/// 检查 Sidecar 子进程是否正在运行（默认检查 "main"）
#[tauri::command]
async fn agent_is_running(
    state: tauri::State<'_, AgentManagerState>,
    agent_id: Option<String>,
) -> Result<bool, String> {
    let aid = agent_id.as_deref().unwrap_or("main");
    Ok(state.0.is_agent_running(aid).await)
}

/// 发送 JSON-RPC 请求并等待单次响应
/// agent_id 参数指定目标 Sidecar 实例（默认 "main"）
#[tauri::command]
async fn agent_send_request(
    state: tauri::State<'_, AgentManagerState>,
    agent_id: Option<String>,
    method: String,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let aid = agent_id.as_deref().unwrap_or("main");
    // 仅活跃操作（execute/sendMessage 等）才更新活跃时间
    // 查询操作（getHistory/getSession 等）不更新，避免纯查看行为阻止空闲回收
    if is_active_method(&method) {
        state.0.touch_agent(aid).await;
    }
    state
        .0
        .send_request_for_agent(aid, &method, params)
        .await
        .map_err(classify_error)
}

/// 发送流式执行请求，返回 stream_id
/// 流式事件通过 Tauri Event "agent:{agent_id}:stream:{stream_id}" 推送到前端
/// options 支持 "agentId" 字段指定目标 Agent（默认 "main"）
/// options 支持 "cwd" 字段，若 agent 未运行则自动启动
#[tauri::command]
async fn agent_execute(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    content: String,
    options: Option<serde_json::Value>,
) -> Result<String, String> {
    // 提取 agent_id 和 cwd
    let agent_id = extract_agent_id(&options);
    let cwd = extract_cwd(&options);

    // 优先使用前端传入的 stream_id（前端先注册监听再 invoke，消除竞态条件）
    // 向后兼容：如果前端没传，Rust 自己生成
    let stream_id = options
        .as_ref()
        .and_then(|o| o.get("streamId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let event_name = format!("agent:{}:stream:{}", agent_id, stream_id);
    let stream_id_ret = stream_id.clone();

    // 调试日志
    crate::agent::process::debug_log(&format!("[agent_execute] agent_id={} stream_id={} content_len={} options={}",
        agent_id, stream_id, content.len(), options.as_ref().map(|o| o.to_string()).unwrap_or_else(|| "null".to_string())));

    log::info!("agent_execute: agent_id={} stream_id={}, content前50字符={}",
        agent_id, stream_id, content.chars().take(50).collect::<String>());

    // 若 agent 未运行，自动启动
    if !state.0.is_agent_running(&agent_id).await {
        log::info!("agent_execute: agent={} 未运行，自动启动 cwd={}", agent_id, cwd);
        state.0.start_agent(&agent_id, &cwd, app.clone()).await
            .map_err(|e| {
                crate::agent::process::debug_log(&format!("[agent_execute] start_agent FAILED: {}", e));
                classify_error(e)
            })?;
    }

    // 更新活跃时间
    state.0.touch_agent(&agent_id).await;

    // 获取流式事件 Receiver
    let exec_start = std::time::Instant::now();
    let mut rx = state
        .0
        .execute_for_agent(&agent_id, &content, options)
        .await
        .map_err(|e| {
            crate::agent::process::debug_log(&format!("[agent_execute] execute_for_agent FAILED after {}ms: {}", exec_start.elapsed().as_millis(), e));
            classify_error(e)
        })?;
    crate::agent::process::debug_log(&format!("[agent_execute] execute_for_agent SUCCESS after {}ms", exec_start.elapsed().as_millis()));

    // 启动异步 task，将流式事件通过 Tauri Event 推送到前端
    let done_event = format!("agent:{}:stream:{}:done", agent_id, stream_id);
    let state_clone = state.0.clone();
    let agent_id_clone = agent_id.clone();
    let event_name_clone = event_name.clone();
    tokio::spawn(async move {
        let mut first_event_received = false;
        let mut total_events = 0u64;
        log::info!("agent_execute: tokio::spawn 开始监听流事件, stream_id={} event_name={}",
            stream_id, event_name_clone);
        while let Some(event) = rx.recv().await {
            if !first_event_received {
                first_event_received = true;
                log::info!("agent_execute: 收到第一个流事件, stream_id={}", stream_id);
            }
            total_events += 1;
            // 更新活跃时间（防止执行中被空闲回收）
            state_clone.touch_agent(&agent_id_clone).await;
            if let Err(e) = app.emit(&event_name, &event) {
                log::error!("agent_execute: 推送事件失败 event={} err={}", event_name, e);
                continue;
            }
        }
        // Receiver 关闭时，发送完成通知
        log::info!("agent_execute: 流事件接收完毕, stream_id={} 共推送{}个事件, 发送 done_event={}",
            stream_id, total_events, done_event);
        let _ = app.emit(&done_event, serde_json::json!({ "done": true }));
        log::info!("agent_execute: 流式执行完成 stream_id={}", stream_id);
    });

    log::info!("agent_execute: 返回 streamId={}", stream_id_ret);
    Ok(stream_id_ret)
}

/// 回传权限请求的用户决策到 sidecar
#[tauri::command]
async fn agent_permission_response(
    state: tauri::State<'_, AgentManagerState>,
    request_id: String,
    decision: serde_json::Value,
    agent_id: Option<String>,
) -> Result<(), String> {
    let agent_id = agent_id.unwrap_or_else(|| "main".to_string());
    state
        .0
        .resolve_permission_for_agent(&agent_id, &request_id, decision)
        .await
        .map_err(classify_error)
}

/// 读取持久化配置项，返回原始 JSON 值（字符串、数组、对象等）
#[tauri::command]
async fn get_config(app: tauri::AppHandle, key: String) -> Result<Option<serde_json::Value>, String> {
    let store = app
        .store("config.json")
        .map_err(|e| e.to_string())?;
    let value = store.get(&key).map(|v| v.clone());
    Ok(value)
}

/// 写入持久化配置项，接受任意 JSON 值（字符串、数组、对象等）
#[tauri::command]
async fn set_config(app: tauri::AppHandle, key: String, value: serde_json::Value) -> Result<(), String> {
    let store = app
        .store("config.json")
        .map_err(|e| e.to_string())?;
    store.set(key, value);
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// 打开目录选择对话框，返回用户选择的路径
#[tauri::command]
async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .blocking_pick_folder();
    Ok(path.map(|p| p.to_string()))
}

/// 读取 Claude 配置文件 (config.toml / exec-approvals.json)
#[tauri::command]
async fn get_claude_config(
    app: tauri::AppHandle,
    config_name: String,
) -> Result<String, String> {
    let relative_path = match config_name.as_str() {
        "config" => ".claude/config.toml",
        "approvals" => ".claude/exec-approvals.json",
        _ => return Err(format!("Unknown config: {}", config_name)),
    };

    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?;

    let full_path = home_dir.join(relative_path);

    tokio::fs::read_to_string(&full_path)
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                format!("Config file not found: {}", relative_path)
            } else {
                format!("Failed to read config: {}", e)
            }
        })
}

/// 写入 Claude 配置文件 (config.toml / exec-approvals.json)
#[tauri::command]
async fn save_claude_config(
    app: tauri::AppHandle,
    config_name: String,
    content: String,
) -> Result<(), String> {
    let relative_path = match config_name.as_str() {
        "config" => ".claude/config.toml",
        "approvals" => ".claude/exec-approvals.json",
        _ => return Err(format!("Unknown config: {}", config_name)),
    };

    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?;

    let full_path = home_dir.join(relative_path);

    // 确保父目录存在
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    tokio::fs::write(&full_path, content)
        .await
        .map_err(|e| format!("Failed to write config: {}", e))
}

/// 同步执行命令：内部消费流并拼接文本返回
/// 适用于不需要实时推送的一次性查询
/// options 支持 "agentId" 字段指定目标 Agent
#[tauri::command]
async fn agent_execute_once(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    content: String,
    options: Option<serde_json::Value>,
) -> Result<String, String> {
    let agent_id = extract_agent_id(&options);
    let cwd = extract_cwd(&options);

    // 若 agent 未运行，自动启动
    if !state.0.is_agent_running(&agent_id).await {
        state.0.start_agent(&agent_id, &cwd, app.clone()).await
            .map_err(classify_error)?;
    }

    let mut rx = state
        .0
        .execute_for_agent(&agent_id, &content, options)
        .await
        .map_err(classify_error)?;

    let mut buf = String::new();
    while let Some(event) = rx.recv().await {
        if let Some(typ) = event.get("type").and_then(|t| t.as_str()) {
            match typ {
                "text" => {
                    // 拼接文本片段
                    if let Some(c) = event.get("content").and_then(|c| c.as_str()) {
                        buf.push_str(c);
                    }
                }
                "error" => {
                    // 收到错误事件，立即返回错误
                    let msg = event
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("error");
                    return Err(msg.to_string());
                }
                "complete" => break, // 收到完成事件，退出循环
                _ => {}
            }
        }
    }

    Ok(buf)
}

/// 确保指定 Agent 已启动（幂等），如未运行则启动
#[tauri::command]
async fn agent_ensure(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentManagerState>,
    agent_id: String,
    cwd: String,
) -> Result<(), String> {
    log::info!("agent_ensure: agent_id={} cwd={}", agent_id, cwd);
    state.0.start_agent(&agent_id, &cwd, app).await.map_err(|e| e.to_string())
}

/// 确保默认工作目录 ~/Claude-Workspace 存在，若不存在则创建，返回完整路径
#[tauri::command]
async fn ensure_default_workspace(app: tauri::AppHandle) -> Result<String, String> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| format!("Failed to get home dir: {}", e))?;

    let workspace_path = home_dir.join("Claude-Workspace");

    if !workspace_path.exists() {
        tokio::fs::create_dir_all(&workspace_path)
            .await
            .map_err(|e| format!("Failed to create workspace directory: {}", e))?;
        log::info!("ensure_default_workspace: 创建默认工作目录 {:?}", workspace_path);
    } else {
        log::info!("ensure_default_workspace: 默认工作目录已存在 {:?}", workspace_path);
    }

    workspace_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Workspace path contains invalid UTF-8".to_string())
}

/// 获取所有正在运行的 Agent ID 列表
#[tauri::command]
async fn agent_get_running(
    state: tauri::State<'_, AgentManagerState>,
) -> Result<Vec<String>, String> {
    Ok(state.0.get_running_agents().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // 创建全局 AgentManager 实例
  let agent_manager = Arc::new(AgentManager::new());

  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .manage(AgentManagerState(agent_manager))
    .invoke_handler(tauri::generate_handler![
      mac_rounded_corners::apply_content_corner_radius,
      mac_rounded_corners::enable_rounded_corners,
      mac_rounded_corners::enable_modern_window_style,
      mac_rounded_corners::reposition_traffic_lights,
      agent_start,
      agent_stop,
      agent_is_running,
      agent_send_request,
      agent_execute,
      agent_execute_once,
      agent_permission_response,
      agent_ensure,
      agent_get_running,
      ensure_default_workspace,
      get_config,
      set_config,
      select_directory,
      get_claude_config,
      save_claude_config,
    ])
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close(); // 阻止立即关闭，等待 sidecar 清理完成
        let state = window.state::<AgentManagerState>();
        let manager = state.0.clone();
        let app_handle = window.app_handle().clone();
        std::thread::spawn(move || {
          tauri::async_runtime::block_on(async {
            let result = tokio::time::timeout(
              std::time::Duration::from_secs(10),
              manager.stop_all()
            ).await;
            if let Ok(Err(e)) = result {
              log::error!("应用关闭时停止 agents 失败: {}", e);
            } else if result.is_err() {
              log::warn!("关闭超时（10秒），强制退出");
            }
            app_handle.exit(0);
          });
        });
      }
    })
    .setup(|app| {
      // 系统级窗口投影（macOS/Windows 等）：真实渐变晕影；避免 WebView 内 padding + CSS 阴影导致缩放时坐标/视觉错位
      #[cfg(target_os = "macos")]
      if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_shadow(true);
      }
      // TEMPORARY DEBUG: Enable logging in release builds for debugging
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Debug)
          .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)  // 使用本地时区（北京时间）
          .build(),
      )?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
