use std::path::PathBuf;
use std::fs;
use tauri::command;

/// 展开路径中的 ~ 符号
fn expand_home(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs_next::home_dir() {
            return home.join(&path[2..]);
        }
    }
    PathBuf::from(path)
}

/// 从 GitHub 拉取配置 (使用 GitHub API)
#[command]
pub async fn sync_config_pull(
    repo_url: String,
    username: String,
    token: String,
) -> Result<(), String> {
    log::info!("开始拉取配置: repo={}, user={}", repo_url, username);

    let claude_dir = expand_home("~/.claude-desktop");
    fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;

    // 解析仓库 URL
    let (owner, repo) = parse_github_url(&repo_url)?;

    // 创建 HTTP 客户端
    let client = reqwest::Client::new();
    let base_url = format!("https://api.github.com/repos/{}/{}", owner, repo);

    // 用户配置在 organizations/{username}/ 目录下
    let user_prefix = format!("organizations/{}", username);

    // 下载 settings.json
    log::info!("下载 settings.json");
    let settings_url = format!("{}/contents/{}/settings.json", base_url, user_prefix);
    match download_file(&client, &settings_url, &token).await {
        Ok(content) => {
            let path = claude_dir.join("settings.json");
            fs::write(&path, content)
                .map_err(|e| format!("写入 settings.json 失败: {}", e))?;
            log::info!("已下载 settings.json 到 {:?}", path);
        }
        Err(e) => {
            log::warn!("settings.json 不存在或下载失败: {}", e);
        }
    }

    // 下载 agents/ 目录
    log::info!("下载 agents/ 目录");
    let agents_url = format!("{}/contents/{}/agents", base_url, user_prefix);
    let agents_dest = claude_dir.join("agents");
    match download_directory(&client, &agents_url, &token, &agents_dest).await {
        Ok(_) => log::info!("已下载 agents/ 目录到 {:?}", agents_dest),
        Err(e) => {
            log::warn!("agents/ 目录不存在或下载失败: {}", e);
        }
    }

    // 下载 skills/ 目录
    log::info!("下载 skills/ 目录");
    let skills_url = format!("{}/contents/{}/skills", base_url, user_prefix);
    let skills_dest = claude_dir.join("skills");
    match download_directory(&client, &skills_url, &token, &skills_dest).await {
        Ok(_) => log::info!("已下载 skills/ 目录到 {:?}", skills_dest),
        Err(e) => {
            log::warn!("skills/ 目录不存在或下载失败: {}", e);
        }
    }

    // 下载 plugins/ 目录（插件配置文件，非插件本身）
    log::info!("下载 plugins/ 目录");
    let plugins_url = format!("{}/contents/{}/plugins", base_url, user_prefix);
    let plugins_dest = claude_dir.join("plugins");
    match download_directory(&client, &plugins_url, &token, &plugins_dest).await {
        Ok(_) => log::info!("已下载 plugins/ 目录到 {:?}", plugins_dest),
        Err(e) => {
            log::warn!("plugins/ 目录不存在或下载失败: {}", e);
        }
    }

    log::info!("配置拉取完成");
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

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
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

/// 下载目录 (递归)
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

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {} - {}", status, error_text));
    }

    let items: Vec<serde_json::Value> = response.json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;

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
