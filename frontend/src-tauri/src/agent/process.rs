use anyhow::Result;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, Command};

/// 展开路径中的 ~ 符号
pub fn expand_home(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs_next::home_dir() {
            return home.join(&path[2..]).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

/// 从 settings.json 读取 env 配置
/// 返回 (api_key, base_url, 模型配置)，都是 Option
pub fn read_settings_env() -> Option<(Option<String>, Option<String>, std::collections::HashMap<String, String>)> {
    let settings_path = expand_home("~/.claude-desktop/settings.json");
    let content = std::fs::read_to_string(&settings_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;

    let env = json.get("env")?.as_object()?;

    let api_key = env.get("ANTHROPIC_AUTH_TOKEN")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .or_else(|| {
            env.get("ANTHROPIC_API_KEY")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
        });

    let base_url = env.get("ANTHROPIC_BASE_URL")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let mut models = std::collections::HashMap::new();
    for (key, value) in env {
        if let Some(s) = value.as_str().filter(|v| !v.is_empty()) {
            match key.as_str() {
                "ANTHROPIC_MODEL" | "ANTHROPIC_AUTH_TOKEN" | "ANTHROPIC_API_KEY" | "ANTHROPIC_BASE_URL" => {}
                _ => { models.insert(key.clone(), s.to_string()); }
            }
        }
    }

    Some((api_key, base_url, models))
}

/// 解析 sidecar 二进制路径
///
/// 优先级：
/// 1. 环境变量 CLAUDE_SIDECAR_PATH（调试用）
/// 2. 与主程序相同目录（生产打包后 externalBin 在 MacOS/ 目录）
/// 3. Tauri 资源目录中的 binaries/（某些打包配置）
/// 4. 编译时 CARGO_MANIFEST_DIR/binaries/（开发模式，平台特定名称）
/// 5. 编译时 CARGO_MANIFEST_DIR/binaries/（开发模式，无后缀通用名称）
/// 6. 运行时从 current_exe 向上推导 src-tauri/binaries/（dev 模式动态 fallback）
pub fn resolve_sidecar_path(app: &AppHandle) -> Result<PathBuf, anyhow::Error> {
    let mut tried_paths: Vec<PathBuf> = Vec::new();

    // 1. 环境变量覆盖(调试用)
    if let Ok(path) = std::env::var("CLAUDE_SIDECAR_PATH") {
        let p = PathBuf::from(&path);
        if p.exists() {
            log::info!("resolve_sidecar_path: [1] 使用环境变量路径 {:?}", p);
            return Ok(p);
        }
        log::warn!("resolve_sidecar_path: [1] 环境变量 CLAUDE_SIDECAR_PATH={} 指向的文件不存在,继续查找", path);
        tried_paths.push(p);
    }

    // 2. 使用当前可执行文件路径来查找 externalBin(生产打包后 externalBin 在 MacOS/ 目录)
    if let Ok(exe_path) = std::env::current_exe() {
        let exe_dir: PathBuf = exe_path.parent()
            .map(|p: &std::path::Path| p.to_path_buf())
            .unwrap_or(exe_path.clone());

        log::info!("resolve_sidecar_path: [2] 当前 exe 目录: {:?}", exe_dir);

        // 列出 exe 目录内容(仅 Windows 调试)
        #[cfg(windows)]
        {
            if let Ok(entries) = std::fs::read_dir(&exe_dir) {
                let files: Vec<String> = entries
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().is_file())
                    .filter_map(|e| e.file_name().to_str().map(String::from))
                    .collect();
                log::info!("resolve_sidecar_path: [2-debug] exe 目录文件: {:?}", files);
            }
        }

        // 2a. exe 同目录,无后缀名称(生产打包常见)
        let sidecar_plain = exe_dir.join("claude-sidecar");
        log::info!("resolve_sidecar_path: [2a] 检查 {:?} => 存在: {}", sidecar_plain, sidecar_plain.exists());
        if sidecar_plain.exists() {
            return Ok(sidecar_plain);
        }
        tried_paths.push(sidecar_plain);

        // 2b. exe 同目录,平台特定名称 (Windows 需要 .exe)
        let sidecar_platform = exe_dir.join(format!(
            "claude-sidecar-{}{}",
            get_target_triple(),
            if cfg!(windows) { ".exe" } else { "" }
        ));
        log::info!("resolve_sidecar_path: [2b] 检查 {:?} => 存在: {}", sidecar_platform, sidecar_platform.exists());
        if sidecar_platform.exists() {
            return Ok(sidecar_platform);
        }
        tried_paths.push(sidecar_platform);

        // 2c. Dev 模式：从 target/debug/exe 向上3级找 src-tauri/binaries/
        // current_exe = .../src-tauri/target/debug/claude-code-desktop
        // parent()     = .../src-tauri/target/debug/
        // parent()     = .../src-tauri/target/
        // parent()     = .../src-tauri/
        if let Some(src_tauri_dir) = exe_path.parent()   // target/debug/
            .and_then(|p| p.parent())                     // target/
            .and_then(|p| p.parent())                     // src-tauri/
        {
            // 无后缀（优先，因为 binaries/ 下同时有两种）
            let dev_plain = src_tauri_dir.join("binaries").join("claude-sidecar");
            log::info!("resolve_sidecar_path: [2c-plain] 检查 dev fallback {:?} => 存在: {}", dev_plain, dev_plain.exists());
            if dev_plain.exists() {
                log::info!("resolve_sidecar_path: [2c-plain] 找到 dev 模式 sidecar: {:?}", dev_plain);
                return Ok(dev_plain);
            }
            tried_paths.push(dev_plain);

            // 平台特定名称
            let dev_platform = src_tauri_dir.join("binaries").join(format!(
                "claude-sidecar-{}{}",
                get_target_triple(),
                if cfg!(windows) { ".exe" } else { "" }
            ));
            log::info!("resolve_sidecar_path: [2c-platform] 检查 dev fallback {:?} => 存在: {}", dev_platform, dev_platform.exists());
            if dev_platform.exists() {
                log::info!("resolve_sidecar_path: [2c-platform] 找到平台特定 dev sidecar: {:?}", dev_platform);
                return Ok(dev_platform);
            }
            tried_paths.push(dev_platform);
        }
    }

    // 3. 检查 Resources/binaries/ 目录（某些打包配置）
    if let Ok(resource_dir) = app.path().resource_dir() {
        let sidecar_name = format!(
            "binaries/claude-sidecar-{}{}",
            get_target_triple(),
            if cfg!(windows) { ".exe" } else { "" }
        );
        let sidecar_path = resource_dir.join(&sidecar_name);
        log::info!("resolve_sidecar_path: [3] 检查资源目录 {:?} => 存在: {}", sidecar_path, sidecar_path.exists());
        if sidecar_path.exists() {
            return Ok(sidecar_path);
        }
        tried_paths.push(sidecar_path);
    }

    // 4. 开发模式编译时路径：CARGO_MANIFEST_DIR/binaries/（平台特定名称）
    let dev_manifest_platform = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!(
            "claude-sidecar-{}{}",
            get_target_triple(),
            if cfg!(windows) { ".exe" } else { "" }
        ));
    log::info!("resolve_sidecar_path: [4] 检查 CARGO_MANIFEST_DIR 平台路径 {:?} => 存在: {}", dev_manifest_platform, dev_manifest_platform.exists());
    if dev_manifest_platform.exists() {
        return Ok(dev_manifest_platform);
    }
    tried_paths.push(dev_manifest_platform);

    // 5. 开发模式编译时路径：CARGO_MANIFEST_DIR/binaries/（无后缀通用名称）
    let dev_manifest_plain = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join("claude-sidecar");
    log::info!("resolve_sidecar_path: [5] 检查 CARGO_MANIFEST_DIR 通用路径 {:?} => 存在: {}", dev_manifest_plain, dev_manifest_plain.exists());
    if dev_manifest_plain.exists() {
        return Ok(dev_manifest_plain);
    }
    tried_paths.push(dev_manifest_plain);

    log::error!(
        "resolve_sidecar_path: 所有路径均未找到 sidecar 二进制。尝试过的路径: {:?}",
        tried_paths
    );
    Err(anyhow::anyhow!(
        "Sidecar binary not found. Run 'bun run build:sidecar' first.\nSearched paths:\n{}",
        tried_paths.iter().map(|p| format!("  - {:?}", p)).collect::<Vec<_>>().join("\n")
    ))
}

/// 获取当前平台的 target triple
fn get_target_triple() -> &'static str {
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else {
            "x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "linux") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-unknown-linux-gnu"
        } else {
            "x86_64-unknown-linux-gnu"
        }
    } else if cfg!(target_os = "windows") {
        "x86_64-pc-windows-msvc"
    } else {
        "unknown-unknown-unknown"
    }
}

/// 封装 Bun Sidecar 子进程及其 stdin 写入管道
pub struct AgentProcess {
    /// 子进程句柄（Arc<Mutex> 共享，供退出监控 task 使用 wait()；drop 时 kill_on_drop 自动 kill）
    child: std::sync::Arc<tokio::sync::Mutex<Child>>,
    /// stdin 写入端
    stdin: tokio::process::ChildStdin,
}

/// 直接写入调试文件
pub(crate) fn debug_log(msg: &str) {
    use std::io::Write;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/claude-debug.log")
    {
        let _ = writeln!(f, "[{}] {}", now.as_secs_f64(), msg);
    }
}

impl AgentProcess {
    /// 启动 sidecar 子进程，返回 (AgentProcess, stdout)
    /// stdout 由 IpcBridge 的 reader task 负责读取
    ///
    /// - `sidecar_path`: sidecar 可执行文件路径
    /// - `cwd`: 工作目录
    ///
    /// 注意：不需要传递 api_key。Sidecar 通过 applyConfigEnvironmentVariables() 自己读取
    /// ~/.claude/settings.json env 字段（ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL 等）。
    #[allow(dead_code)]
    pub async fn spawn(
        sidecar_path: &str,
        cwd: &str,
    ) -> Result<(Self, tokio::process::ChildStdout)> {
        debug_log(&format!("AgentProcess::spawn: 即将启动 sidecar path={} cwd={}", sidecar_path, cwd));
        log::info!("AgentProcess::spawn: 即将启动 sidecar path={} cwd={}", sidecar_path, cwd);
        eprintln!("DEBUG: AgentProcess::spawn called with path={} cwd={}", sidecar_path, cwd);

        // 如果 cwd 为空，使用 sidecar 所在的目录作为工作目录
        let working_dir: PathBuf = if cwd.is_empty() {
            let p = std::path::Path::new(sidecar_path);
            p.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| {
                std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
            })
        } else {
            PathBuf::from(cwd)
        };

        debug_log(&format!("AgentProcess::spawn: 准备启动 Command, path={}, working_dir={:?}", sidecar_path, working_dir));

        // 传递必要的环境变量给 sidecar 进程
        // Sidecar 需要这些变量来连接正确的 API endpoint
        // 关键：从父进程继承所有环境变量（Claude Code 设置的 ANTHROPIC_* 等）
        let mut cmd = Command::new(sidecar_path);
        cmd.current_dir(&working_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())  // 保留 stderr 用于调试
            .kill_on_drop(true);

        // 统一配置目录到 ~/.claude-desktop/，避免与系统 Claude Code 配置混淆
        // 这个必须最后设置，以确保覆盖任何继承的环境变量
        let claude_config_dir = expand_home("~/.claude-desktop");
        log::info!("AgentProcess::spawn_with_env: 设置 CLAUDE_CONFIG_DIR={}", claude_config_dir);

        // 先继承父进程所有环境变量，然后覆盖 CLAUDE_CONFIG_DIR
        cmd.envs(std::env::vars());
        cmd.env("CLAUDE_CONFIG_DIR", &claude_config_dir);

        // 确保 SIDECAR_MODE 为 true
        cmd.env("SIDECAR_MODE", "true");
        // 编译后的 sidecar 二进制中 @vscode/ripgrep 不可用，
        // 强制使用原生文件搜索以确保 agent/command 等配置文件能被正确加载
        cmd.env("CLAUDE_CODE_USE_NATIVE_FILE_SEARCH", "true");

        // 启用 Sidecar 内部调试日志
        cmd.env("DEBUG", "true");

        // 设置 Bun 运行时内存限制（防止无限增长）
        // 最大堆内存 4GB，超过则触发OOM
        cmd.env("NODE_OPTIONS", "--max-old-space-size=4096");

        // macOS 特定的内存限制（通过 launchctl）
        if cfg!(target_os = "macos") {
            // 启用 Bun 的垃圾回收
            cmd.env("BUN_DEBUG_GC", "1");
        }

        debug_log("AgentProcess::spawn: 即将执行 spawn()");
        let mut child = match cmd.spawn() {
            Ok(c) => {
                debug_log("AgentProcess::spawn: spawn() 成功");
                c
            }
            Err(e) => {
                debug_log(&format!("AgentProcess::spawn: spawn() 失败: {}", e));
                return Err(e.into());
            }
        };

        log::info!("AgentProcess::spawn: 子进程已 spawn，pid={:?}", child.id());

        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("无法获取子进程 stdin"))?;
        let stdout =
            child.stdout.take().ok_or_else(|| anyhow::anyhow!("无法获取子进程 stdout"))?;
        let stderr = child.stderr.take();

        log::info!("AgentProcess::spawn: stdin/stdout/stderr 获取成功");

        // 启动 stderr 读取任务，将 Sidecar 的 stderr 输出到日志
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut reader = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    // 将 stderr 写入调试日志
                    debug_log(&format!("[SIDECAR STDERR] {}", line));
                    log::warn!("[Sidecar stderr] {}", line);
                }
                log::info!("AgentProcess: stderr reader task 退出");
            });
        }

        // 启动内存监控任务（仅 macOS/Linux）
        #[cfg(not(target_os = "windows"))]
        {
            let child_id = child.id();
            tokio::spawn(async move {
                use std::time::Duration;

                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;

                    // 检查进程是否还在运行（通过 kill -0 信号探测）
                    let pid = match child_id {
                        Some(p) => p,
                        None => break,
                    };

                    // 读取 /proc/{pid}/status (Linux) 或使用 ps (macOS)
                    #[cfg(target_os = "macos")]
                    {
                        if let Ok(output) = tokio::process::Command::new("ps")
                            .args(["-o", "rss=", "-p", &pid.to_string()])
                            .output()
                            .await
                        {
                            // 如果 ps 返回空输出，说明进程已退出
                            if output.stdout.is_empty() {
                                log::info!("AgentProcess: 进程已退出 (PID={})，停止内存监控", pid);
                                break;
                            }
                            if let Ok(rss_str) = String::from_utf8(output.stdout) {
                                if let Ok(rss_kb) = rss_str.trim().parse::<u64>() {
                                    let rss_mb = rss_kb / 1024;
                                    log::info!("AgentProcess: 内存使用 {}MB (PID={})", rss_mb, pid);

                                    // 如果超过3GB，发出警告
                                    if rss_mb > 3072 {
                                        log::warn!("⚠️  Sidecar 内存使用过高: {}MB，建议重启", rss_mb);
                                    }

                                    // 如果超过4GB，发出错误日志（进程生命周期由 AgentManager 管理）
                                    if rss_mb > 4096 {
                                        log::error!("🚨 Sidecar 内存使用超限: {}MB", rss_mb);
                                    }
                                }
                            }
                        } else {
                            // ps 命令失败，说明进程已退出
                            log::info!("AgentProcess: 进程已退出 (PID={})，停止内存监控", pid);
                            break;
                        }
                    }

                    #[cfg(target_os = "linux")]
                    {
                        let proc_path = format!("/proc/{}/status", pid);
                        match tokio::fs::read_to_string(&proc_path).await {
                            Ok(content) => {
                                for line in content.lines() {
                                    if line.starts_with("VmRSS:") {
                                        let parts: Vec<&str> = line.split_whitespace().collect();
                                        if parts.len() >= 2 {
                                            if let Ok(kb) = parts[1].parse::<u64>() {
                                                let mb = kb / 1024;
                                                log::info!("AgentProcess: 内存使用 {}MB (PID={})", mb, pid);

                                                if mb > 3072 {
                                                    log::warn!("⚠️  Sidecar 内存使用过高: {}MB，建议重启", mb);
                                                }

                                                if mb > 4096 {
                                                    log::error!("🚨 Sidecar 内存使用超限: {}MB", mb);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(_) => {
                                // /proc/{pid}/status 不存在，说明进程已退出
                                log::info!("AgentProcess: 进程已退出 (PID={})，停止内存监控", pid);
                                break;
                            }
                        }
                    }
                }
            });
        }

        Ok((Self { child: std::sync::Arc::new(tokio::sync::Mutex::new(child)), stdin }, stdout))
    }

    /// 启动 sidecar 子进程，支持注入自定义环境变量，并返回退出监控 Receiver
    ///
    /// - `sidecar_path`: sidecar 可执行文件路径
    /// - `cwd`: 工作目录
    /// - `env_vars`: 额外注入的环境变量（owned 类型，避免生命周期问题）
    ///
    /// 返回 `(AgentProcess, stdout, exit_rx)`，其中 `exit_rx` 在进程退出时触发
    pub async fn spawn_with_env(
        sidecar_path: &str,
        cwd: &str,
        env_vars: Vec<(String, String)>,
    ) -> Result<(Self, tokio::process::ChildStdout, tokio::sync::oneshot::Receiver<std::process::ExitStatus>)> {
        debug_log(&format!("AgentProcess::spawn_with_env: 即将启动 sidecar path={} cwd={}", sidecar_path, cwd));
        log::info!("AgentProcess::spawn_with_env: 即将启动 sidecar path={} cwd={}", sidecar_path, cwd);

        // 如果 cwd 为空，使用 sidecar 所在的目录作为工作目录
        let working_dir: PathBuf = if cwd.is_empty() {
            let p = std::path::Path::new(sidecar_path);
            p.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| {
                std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/"))
            })
        } else {
            PathBuf::from(cwd)
        };

        let mut cmd = Command::new(sidecar_path);
        cmd.current_dir(&working_dir)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // 继承父进程所有环境变量
        cmd.envs(std::env::vars());

        // 统一配置目录到 ~/.claude-desktop/，确保覆盖任何继承的值
        let claude_config_dir = expand_home("~/.claude-desktop");
        log::info!("AgentProcess::spawn_with_env: 设置 CLAUDE_CONFIG_DIR={}", claude_config_dir);
        cmd.env("CLAUDE_CONFIG_DIR", &claude_config_dir);

        // 标准环境变量
        cmd.env("SIDECAR_MODE", "true");
        cmd.env("CLAUDE_CODE_USE_NATIVE_FILE_SEARCH", "true");
        cmd.env("DEBUG", "true");
        cmd.env("NODE_OPTIONS", "--max-old-space-size=4096");

        if cfg!(target_os = "macos") {
            cmd.env("BUN_DEBUG_GC", "1");
        }

        // 注入自定义环境变量（覆盖已有变量）
        for (key, val) in env_vars {
            cmd.env(key, val);
        }

        debug_log("AgentProcess::spawn_with_env: 即将执行 spawn()");
        let mut child = match cmd.spawn() {
            Ok(c) => {
                debug_log("AgentProcess::spawn_with_env: spawn() 成功");
                c
            }
            Err(e) => {
                debug_log(&format!("AgentProcess::spawn_with_env: spawn() 失败: {}", e));
                return Err(e.into());
            }
        };

        log::info!("AgentProcess::spawn_with_env: 子进程已 spawn，pid={:?}", child.id());

        let stdin = child.stdin.take().ok_or_else(|| anyhow::anyhow!("无法获取子进程 stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("无法获取子进程 stdout"))?;
        let stderr = child.stderr.take();

        // 启动 stderr 读取任务
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                use tokio::io::AsyncBufReadExt;
                let mut reader = tokio::io::BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    debug_log(&format!("[SIDECAR STDERR] {}", line));
                    log::warn!("[Sidecar stderr] {}", line);
                }
                log::info!("AgentProcess::spawn_with_env: stderr reader task 退出");
            });
        }

        // 启动内存监控任务（仅 macOS/Linux）
        #[cfg(not(target_os = "windows"))]
        {
            let child_id = child.id();
            tokio::spawn(async move {
                use std::time::Duration;
                loop {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                    let pid = match child_id {
                        Some(p) => p,
                        None => break,
                    };

                    #[cfg(target_os = "macos")]
                    {
                        if let Ok(output) = tokio::process::Command::new("ps")
                            .args(["-o", "rss=", "-p", &pid.to_string()])
                            .output()
                            .await
                        {
                            if output.stdout.is_empty() {
                                log::info!("AgentProcess::spawn_with_env: 进程已退出 (PID={})，停止内存监控", pid);
                                break;
                            }
                            if let Ok(rss_str) = String::from_utf8(output.stdout) {
                                if let Ok(rss_kb) = rss_str.trim().parse::<u64>() {
                                    let rss_mb = rss_kb / 1024;
                                    log::info!("AgentProcess::spawn_with_env: 内存使用 {}MB (PID={})", rss_mb, pid);
                                    if rss_mb > 3072 {
                                        log::warn!("⚠️  Sidecar 内存使用过高: {}MB，建议重启", rss_mb);
                                    }
                                    if rss_mb > 4096 {
                                        log::error!("🚨 Sidecar 内存使用超限: {}MB", rss_mb);
                                    }
                                }
                            }
                        } else {
                            log::info!("AgentProcess::spawn_with_env: 进程已退出 (PID={})，停止内存监控", pid);
                            break;
                        }
                    }

                    #[cfg(target_os = "linux")]
                    {
                        let proc_path = format!("/proc/{}/status", pid);
                        match tokio::fs::read_to_string(&proc_path).await {
                            Ok(content) => {
                                for line in content.lines() {
                                    if line.starts_with("VmRSS:") {
                                        let parts: Vec<&str> = line.split_whitespace().collect();
                                        if parts.len() >= 2 {
                                            if let Ok(kb) = parts[1].parse::<u64>() {
                                                let mb = kb / 1024;
                                                log::info!("AgentProcess::spawn_with_env: 内存使用 {}MB (PID={})", mb, pid);
                                                if mb > 3072 {
                                                    log::warn!("⚠️  Sidecar 内存使用过高: {}MB，建议重启", mb);
                                                }
                                                if mb > 4096 {
                                                    log::error!("🚨 Sidecar 内存使用超限: {}MB", mb);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            Err(_) => {
                                log::info!("AgentProcess::spawn_with_env: 进程已退出 (PID={})，停止内存监控", pid);
                                break;
                            }
                        }
                    }
                }
            });
        }

        // 创建退出监控 channel
        // 将 child 包装为 Arc<Mutex<Child>>，供退出监控 task 使用 wait()
        let (exit_tx, exit_rx) = tokio::sync::oneshot::channel::<std::process::ExitStatus>();
        let child_pid = child.id();
        let child_arc = std::sync::Arc::new(tokio::sync::Mutex::new(child));
        let child_arc_for_wait = std::sync::Arc::clone(&child_arc);

        tokio::spawn(async move {
            // 使用 child.wait() 阻塞等待进程真实退出，避免 kill -0 误判
            let mut child_guard = child_arc_for_wait.lock().await;
            match child_guard.wait().await {
                Ok(status) => {
                    let code = status.code();
                    #[cfg(unix)]
                    let signal = {
                        use std::os::unix::process::ExitStatusExt;
                        status.signal()
                    };
                    #[cfg(not(unix))]
                    let signal: Option<i32> = None;

                    // 详细记录退出状态，区分正常退出和信号杀死
                    if let Some(exit_code) = code {
                        if exit_code == 0 {
                            log::info!(
                                "AgentProcess::spawn_with_env: 进程 {:?} 正常退出, exit_code={}",
                                child_pid, exit_code
                            );
                        } else {
                            log::error!(
                                "AgentProcess::spawn_with_env: 进程 {:?} 异常退出, exit_code={}",
                                child_pid, exit_code
                            );
                        }
                        debug_log(&format!(
                            "[EXIT] pid={:?} exit_code={}",
                            child_pid, exit_code
                        ));
                    } else if let Some(sig) = signal {
                        let sig_name = match sig {
                            9  => "SIGKILL/OOM",
                            11 => "SIGSEGV",
                            6  => "SIGABRT",
                            15 => "SIGTERM",
                            _  => "unknown",
                        };
                        log::error!(
                            "AgentProcess::spawn_with_env: 进程 {:?} 被信号杀死: signal={} ({})",
                            child_pid, sig, sig_name
                        );
                        debug_log(&format!(
                            "[EXIT-SIGNAL] pid={:?} signal={} ({})",
                            child_pid, sig, sig_name
                        ));
                    } else {
                        log::warn!(
                            "AgentProcess::spawn_with_env: 进程 {:?} 退出状态未知 — code={:?} signal={:?}",
                            child_pid, code, signal
                        );
                        debug_log(&format!(
                            "[EXIT-UNKNOWN] pid={:?} code={:?} signal={:?}",
                            child_pid, code, signal
                        ));
                    }
                    let _ = exit_tx.send(status);
                }
                Err(e) => {
                    log::error!("AgentProcess::spawn_with_env: wait() 失败: {} (pid={:?})", e, child_pid);
                    debug_log(&format!(
                        "[EXIT-ERR] pid={:?} wait_err={}", child_pid, e
                    ));
                    let _ = exit_tx.send(std::process::ExitStatus::default());
                }
            }
        });

        Ok((Self { child: child_arc, stdin }, stdout, exit_rx))
    }

    /// 向子进程 stdin 写入一行（自动追加 \n 并 flush）
    pub async fn write_line(&mut self, line: &str) -> Result<()> {
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        self.stdin.flush().await?;
        Ok(())
    }

    /// 强制终止子进程
    pub async fn kill(&mut self) -> Result<()> {
        let mut child = self.child.lock().await;
        child.kill().await?;
        Ok(())
    }

    /// 等待子进程退出，返回退出状态
    pub async fn wait(&mut self) -> Result<std::process::ExitStatus> {
        let mut child = self.child.lock().await;
        Ok(child.wait().await?)
    }
}
