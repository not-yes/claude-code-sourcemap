use std::path::PathBuf;
use std::fs;
use tauri::{command, Emitter};

/// 同步配置项定义
struct SyncItem {
    name: &'static str,
    dest: PathBuf,
    url_suffix: &'static str,
    is_directory: bool,
}

/// 展开路径中的 ~ 符号
fn expand_home(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs_next::home_dir() {
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

/// 发送同步进度事件
fn emit_progress(app: &tauri::AppHandle, step: usize, total: usize, message: &str, percent: usize) {
    let _ = app.emit("sync:progress", serde_json::json!({
        "step": step,
        "total": total,
        "message": message,
        "percent": percent
    }));
}

/// 从 GitHub 拉取配置 (使用 GitHub API)
/// 同步策略：先删除本地目录/文件，再从 GitHub 完整下载，确保完全一致
#[command]
pub async fn sync_config_pull(
    app: tauri::AppHandle,
    repo_url: String,
    username: String,
    token: String,
) -> Result<(), String> {
    log::info!("开始拉取配置: repo={}, user={}", repo_url, username);

    let claude_dir = expand_home("~/.claude-desktop");

    // 解析仓库 URL
    let (owner, repo) = parse_github_url(&repo_url)?;

    // 创建 HTTP 客户端
    let client = reqwest::Client::new();
    let base_url = format!("https://api.github.com/repos/{}/{}", owner, repo);

    // 用户配置在 organizations/{username}/ 目录下
    let user_prefix = format!("organizations/{}", username);

    // 定义所有需要同步的项目
    // 注意：settings.json 是文件，agents/skills/plugins 是目录
    let items = vec![
        SyncItem {
            name: "settings.json",
            dest: claude_dir.join("settings.json"),
            url_suffix: "/settings.json",
            is_directory: false,
        },
        SyncItem {
            name: "agents",
            dest: claude_dir.join("agents"),
            url_suffix: "/agents",
            is_directory: true,
        },
        SyncItem {
            name: "skills",
            dest: claude_dir.join("skills"),
            url_suffix: "/skills",
            is_directory: true,
        },
        SyncItem {
            name: "plugins",
            dest: claude_dir.join("plugins"),
            url_suffix: "/plugins",
            is_directory: true,
        },
        SyncItem {
            name: "CLAUDE.md",
            dest: claude_dir.join("CLAUDE.md"),
            url_suffix: "/CLAUDE.md",
            is_directory: false,
        },
    ];

    let total_steps = items.len();
    let mut success_count = 0;
    let mut fail_count = 0;

    for (index, item) in items.iter().enumerate() {
        let step = index + 1;
        let percent = (step * 100) / total_steps;

        emit_progress(&app, step, total_steps, &format!("同步 {}...", item.name), percent);

        let url = format!("{}{}", base_url, item.url_suffix);

        let result = if item.is_directory {
            download_directory(&client, &url, &token, &item.dest).await
        } else {
            let content = download_file(&client, &url, &token).await?;
            // 下载文件前先删除本地文件（如果存在）
            if item.dest.exists() {
                fs::remove_file(&item.dest).map_err(|e| format!("删除本地文件失败: {}", e))?;
            }
            // 确保父目录存在
            if let Some(parent) = item.dest.parent() {
                fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
            }
            fs::write(&item.dest, content).map_err(|e| format!("写入文件失败: {}", e))?;
            Ok(())
        };

        match result {
            Ok(_) => {
                log::info!("同步 {} 成功", item.name);
                success_count += 1;
            }
            Err(e) => {
                // 404 错误表示 GitHub 上不存在此文件/目录，本地应该也删除
                if e.contains("HTTP 404") {
                    if item.dest.exists() {
                        if item.is_directory {
                            fs::remove_dir_all(&item.dest)
                                .map_err(|e| format!("删除本地目录失败: {}", e))?;
                        } else {
                            fs::remove_file(&item.dest)
                                .map_err(|e| format!("删除本地文件失败: {}", e))?;
                        }
                        log::info!("GitHub 上不存在 {}，已删除本地", item.name);
                    } else {
                        log::info!("GitHub 上不存在 {}，本地也不存在，跳过", item.name);
                    }
                } else {
                    log::warn!("同步 {} 失败: {}", item.name, e);
                    fail_count += 1;
                }
            }
        }
    }

    emit_progress(&app, total_steps, total_steps, "同步完成", 100);

    if fail_count > 0 {
        log::warn!("配置拉取完成，但有 {} 项失败", fail_count);
    } else {
        log::info!("配置拉取完成，全部 {} 项成功", success_count);
    }

    Ok(())
}

/// 解析 GitHub 仓库 URL
fn parse_github_url(url: &str) -> Result<(String, String), String> {
    // 支持格式: https://github.com/owner/repo
    let url = url.trim_end_matches('/');
    let parts: Vec<&str> = url.split('/').collect();

    if parts.len() >= 5 && parts[2] == "github.com" {
        Ok((parts[3].to_string(), parts[4].to_string()))
    } else {
        Err(format!("无效的 GitHub URL: {}", url))
    }
}

/// 下载单个文件
async fn download_file(
    client: &reqwest::Client,
    url: &str,
    token: &str,
) -> Result<Vec<u8>, String> {
    let response = client.get(url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "claude-desktop")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();

    if status.as_u16() == 404 {
        return Err(format!("HTTP 404 - 文件不存在: {}", url));
    }

    if !status.is_success() {
        return Err(format!("HTTP {}", status));
    }

    // GitHub API 返回 base64 编码的内容
    let json: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    let content_b64 = json["content"]
        .as_str()
        .ok_or("响应中缺少 content 字段")?;

    // 移除换行符并解码 base64
    let content_b64 = content_b64.replace('\n', "");
    let content = base64_decode(&content_b64)?;

    Ok(content)
}

/// 下载目录 (递归) - 先删除本地目录再重新下载，确保与 GitHub 完全一致
async fn download_directory(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    dest_dir: &PathBuf,
) -> Result<(), String> {
    let response = client.get(url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "claude-desktop")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();

    if status.as_u16() == 404 {
        return Err(format!("HTTP 404 - 目录不存在: {}", url));
    }

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {} - {}", status, error_text));
    }

    let items: Vec<serde_json::Value> = response.json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

    // 先删除本地目录（确保与 GitHub 完全一致，删除的文件也被删除）
    if dest_dir.exists() {
        fs::remove_dir_all(dest_dir).map_err(|e| format!("删除本地目录失败: {}", e))?;
    }
    fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;

    for item in items {
        let name = item["name"].as_str().ok_or("缺少 name 字段")?.to_string();
        let item_type = item["type"].as_str().ok_or("缺少 type 字段")?;

        match item_type {
            "file" => {
                let download_url = item["download_url"]
                    .as_str()
                    .ok_or("缺少 download_url")?;

                let file_response = client.get(download_url)
                    .header("User-Agent", "claude-desktop")
                    .send()
                    .await
                    .map_err(|e| format!("下载文件失败: {}", e))?;

                let content = file_response
                    .bytes()
                    .await
                    .map_err(|e| format!("读取文件内容失败: {}", e))?;

                fs::write(dest_dir.join(&name), content)
                    .map_err(|e| format!("写入文件失败: {}", e))?;
            }
            "dir" => {
                let sub_url = item["url"].as_str().ok_or("缺少 url")?.to_string();
                let sub_dir = dest_dir.join(&name);
                Box::pin(download_directory(client, &sub_url, token, &sub_dir)).await?;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Base64 解码
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(input)
        .map_err(|e| format!("Base64 解码失败: {}", e))
}
