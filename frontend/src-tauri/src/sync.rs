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
    token: String,
) -> Result<(), String> {
    log::info!("开始拉取配置: repo={}", repo_url);
    
    let claude_dir = expand_home("~/.claude");
    fs::create_dir_all(&claude_dir).map_err(|e| e.to_string())?;
    
    // 解析仓库 URL
    let (owner, repo) = parse_github_url(&repo_url)?;
    
    // 创建 HTTP 客户端
    let client = reqwest::Client::new();
    let base_url = format!("https://api.github.com/repos/{}/{}", owner, repo);
    
    // 下载 settings.json
    log::info!("下载 settings.json");
    let settings_url = format!("{}/contents/settings.json", base_url);
    match download_file(&client, &settings_url, &token).await {
        Ok(content) => {
            fs::write(claude_dir.join("settings.json"), content)
                .map_err(|e| format!("写入 settings.json 失败: {}", e))?;
            log::info!("已下载 settings.json");
        }
        Err(e) => log::warn!("settings.json 不存在或下载失败: {}", e),
    }
    
    // 下载 agents/ 目录
    log::info!("下载 agents/ 目录");
    let agents_url = format!("{}/contents/agents", base_url);
    match download_directory(&client, &agents_url, &token, &claude_dir.join("agents")).await {
        Ok(_) => log::info!("已下载 agents/ 目录"),
        Err(e) => log::warn!("agents/ 目录不存在或下载失败: {}", e),
    }
    
    // 下载 skills/ 目录
    log::info!("下载 skills/ 目录");
    let skills_url = format!("{}/contents/skills", base_url);
    match download_directory(&client, &skills_url, &token, &claude_dir.join("skills")).await {
        Ok(_) => log::info!("已下载 skills/ 目录"),
        Err(e) => log::warn!("skills/ 目录不存在或下载失败: {}", e),
    }
    
    log::info!("配置拉取成功");
    Ok(())
}

/// 推送配置到 GitHub (使用 GitHub API)
#[command]
pub async fn sync_config_push(
    repo_url: String,
    token: String,
) -> Result<(), String> {
    log::info!("开始推送配置: repo={}", repo_url);
    
    let claude_dir = expand_home("~/.claude");
    
    // 解析仓库 URL
    let (owner, repo) = parse_github_url(&repo_url)?;
    let base_url = format!("https://api.github.com/repos/{}/{}", owner, repo);
    
    // 创建 HTTP 客户端
    let client = reqwest::Client::new();
    
    // 上传 settings.json
    let settings_path = claude_dir.join("settings.json");
    if settings_path.exists() {
        log::info!("上传 settings.json");
        let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
        upload_file(&client, &base_url, "settings.json", &content, &token).await?;
    }
    
    // 上传 agents/ 目录
    let agents_path = claude_dir.join("agents");
    if agents_path.exists() {
        log::info!("上传 agents/ 目录");
        upload_directory(&client, &base_url, &agents_path, "agents", &token).await?;
    }
    
    // 上传 skills/ 目录
    let skills_path = claude_dir.join("skills");
    if skills_path.exists() {
        log::info!("上传 skills/ 目录");
        upload_directory(&client, &base_url, &skills_path, "skills", &token).await?;
    }
    
    log::info!("配置推送成功");
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
    
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
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
                
                let content = client.get(download_url)
                    .header("Authorization", format!("token {}", token))
                    .header("User-Agent", "claude-desktop")
                    .send()
                    .await
                    .map_err(|e| format!("下载文件失败: {}", e))?
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

/// 上传单个文件
async fn upload_file(
    client: &reqwest::Client,
    base_url: &str,
    path: &str,
    content: &str,
    token: &str,
) -> Result<(), String> {
    // 先获取文件 SHA (如果存在)
    let sha = get_file_sha(client, base_url, path, token).await.ok();
    
    let url = format!("{}/contents/{}", base_url, path);
    let mut body = serde_json::json!({
        "message": format!("update: 从桌面推送 {}", path),
        "content": base64_encode(content.as_bytes()),
    });
    
    if let Some(sha) = sha {
        body["sha"] = serde_json::json!(sha);
    }
    
    let response = client.put(&url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "claude-desktop")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    if !response.status().is_success() {
        let error = response.text().await.unwrap_or_default();
        return Err(format!("上传失败: {}", error));
    }
    
    Ok(())
}

/// 上传目录 (递归)
async fn upload_directory(
    client: &reqwest::Client,
    base_url: &str,
    dir_path: &PathBuf,
    remote_path: &str,
    token: &str,
) -> Result<(), String> {
    for entry in fs::read_dir(dir_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        
        if path.is_dir() {
            let remote_sub_path = format!("{}/{}", remote_path, name);
            Box::pin(upload_directory(client, base_url, &path, &remote_sub_path, token)).await?;
        } else {
            let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let remote_file_path = format!("{}/{}", remote_path, name);
            upload_file(client, base_url, &remote_file_path, &content, token).await?;
        }
    }
    
    Ok(())
}

/// 获取文件 SHA
async fn get_file_sha(
    client: &reqwest::Client,
    base_url: &str,
    path: &str,
    token: &str,
) -> Result<String, String> {
    let url = format!("{}/contents/{}", base_url, path);
    
    let response = client.get(&url)
        .header("Authorization", format!("token {}", token))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "claude-desktop")
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    
    let json: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("解析 JSON 失败: {}", e))?;
    
    json["sha"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or("缺少 sha 字段".to_string())
}

/// Base64 编码
fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Base64 解码
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(input)
        .map_err(|e| format!("Base64 解码失败: {}", e))
}
