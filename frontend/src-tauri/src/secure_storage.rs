//! 跨平台安全存储模块
//!
//! 支持平台：
//! - macOS: Keychain
//! - Windows: Credential Manager
//! - Linux: libsecret
//!
//! 用于安全存储敏感信息如：
//! - LLM API Key / Auth Token
//! - LLM Base URL
//! - LLM Model (主模型 + 4个场景模型)
//! - GitHub Personal Access Token

use std::sync::OnceLock;
use tauri::command;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

/// 安全存储服务名称
const SERVICE_NAME: &str = "claude-desktop";

/// 存储条目（简化版，无时间戳）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct SecretEntry {
    key: String,
    value: String,
}

/// 存储键名常量
const KEY_API_KEY: &str = "llm_api_key";
const KEY_BASE_URL: &str = "llm_base_url";
// 模型配置（5个字段）
const KEY_MODEL: &str = "llm_model";                           // 主模型
const KEY_SMALL_FAST_MODEL: &str = "llm_small_fast_model";     // 快速模型
const KEY_SONNET_MODEL: &str = "llm_sonnet_model";             // Sonnet 默认
const KEY_OPUS_MODEL: &str = "llm_opus_model";                 // Opus 默认
const KEY_HAIKU_MODEL: &str = "llm_haiku_model";               // Haiku 默认
const KEY_GITHUB_TOKEN: &str = "github_sync_token";
const KEY_SYNC_USERNAME: &str = "sync_username";
// 语音识别 API Key
const KEY_ASR_API_KEY: &str = "asr_api_key";                  // 语音识别专用 API Key

/// 全局 keyring 实例
static KEYRING: OnceLock<keyring::Entry> = OnceLock::new();

/// 完整的 secrets 缓存（避免重复读取 keychain）
/// 一旦初始化，所有读写操作都使用内存缓存
static SECRETS_CACHE: OnceLock<RwLock<Option<Vec<SecretEntry>>>> = OnceLock::new();

/// 获取 secrets 缓存实例
fn get_secrets_cache() -> &'static RwLock<Option<Vec<SecretEntry>>> {
    SECRETS_CACHE.get_or_init(|| RwLock::new(None))
}

/// 从 keychain 加载 secrets 到缓存（只调用一次）
fn load_secrets_to_cache() -> Result<(), String> {
    let cache = get_secrets_cache();
    let mut guard = cache.write().map_err(|e| format!("获取缓存写锁失败: {}", e))?;

    if guard.is_some() {
        // 已初始化，跳过
        return Ok(());
    }

    log::info!("load_secrets_to_cache: 首次加载，访问 keychain");
    let secrets = read_all_secrets_from_keychain()?;
    log::info!("load_secrets_to_cache: 读取到 {} 条记录", secrets.len());
    *guard = Some(secrets);
    log::info!("load_secrets_to_cache: 加载完成");
    Ok(())
}

/// 获取缓存的 secrets（只读）
fn get_cached_secrets() -> Result<Vec<SecretEntry>, String> {
    // 快速路径：检查缓存是否已初始化
    {
        let cache = get_secrets_cache();
        let guard = cache.read().map_err(|e| format!("获取缓存读锁失败: {}", e))?;
        if let Some(ref secrets) = *guard {
            return Ok(secrets.clone());
        }
    }

    // 需要初始化，获取写锁（此时可能其他线程已完成初始化）
    load_secrets_to_cache()?;

    let cache = get_secrets_cache();
    let guard = cache.read().map_err(|e| format!("获取缓存读锁失败: {}", e))?;
    Ok(guard.clone().unwrap_or_default())
}

/// 更新缓存的 secrets（同时写入 keychain）
fn update_cached_secrets(secrets: Vec<SecretEntry>) -> Result<(), String> {
    // 写入 keychain
    save_all_secrets_to_keychain(&secrets)?;

    // 更新内存缓存
    let cache = get_secrets_cache();
    let mut guard = cache.write().map_err(|e| format!("获取缓存写锁失败: {}", e))?;
    *guard = Some(secrets.clone());
    
    // 同步更新 CONFIG_CACHE（避免下次读取时重复加载）
    let config_cache = get_config_cache();
    if let Ok(mut config_guard) = config_cache.write() {
        // 从 secrets 中提取各字段
        let get_value = |key: &str| -> Option<String> {
            secrets.iter().find(|s| s.key == key).map(|s| s.value.clone())
        };
        config_guard.api_key = get_value(KEY_API_KEY);
        config_guard.base_url = get_value(KEY_BASE_URL);
        config_guard.model = get_value(KEY_MODEL);
        config_guard.small_fast_model = get_value(KEY_SMALL_FAST_MODEL);
        config_guard.sonnet_model = get_value(KEY_SONNET_MODEL);
        config_guard.opus_model = get_value(KEY_OPUS_MODEL);
        config_guard.haiku_model = get_value(KEY_HAIKU_MODEL);
        log::info!("update_cached_secrets: CONFIG_CACHE 已同步更新");
    }

    Ok(())
}

/// 预加载缓存（应用启动时调用，确保只访问 1 次 Keychain）
pub fn preload_cache() -> Result<(), String> {
    log::info!("preload_cache: 开始预加载安全存储缓存");
    let secrets = get_cached_secrets()?;

    // 同步初始化 CONFIG_CACHE，避免 sidecar 启动时再次走初始化路径
    let cache = get_config_cache();
    if let Ok(mut cache_guard) = cache.write() {
        if !cache_guard.initialized {
            let get_value = |key: &str| -> Option<String> {
                secrets.iter().find(|s| s.key == key).map(|s| s.value.clone())
            };
            cache_guard.api_key = get_value(KEY_API_KEY);
            cache_guard.base_url = get_value(KEY_BASE_URL);
            cache_guard.model = get_value(KEY_MODEL);
            cache_guard.small_fast_model = get_value(KEY_SMALL_FAST_MODEL);
            cache_guard.sonnet_model = get_value(KEY_SONNET_MODEL);
            cache_guard.opus_model = get_value(KEY_OPUS_MODEL);
            cache_guard.haiku_model = get_value(KEY_HAIKU_MODEL);
            cache_guard.initialized = true;
            log::info!("preload_cache: CONFIG_CACHE 已同步初始化");
        }
    }

    log::info!("preload_cache: 预加载完成");
    Ok(())
}

/// 配置缓存（兼容旧代码，用于 Sidecar 启动时的同步读取）
/// 使用 RwLock 支持运行时更新
static CONFIG_CACHE: OnceLock<RwLock<CachedConfig>> = OnceLock::new();

/// 缓存的配置结构
#[derive(Debug, Clone, Default)]
struct CachedConfig {
    api_key: Option<String>,
    base_url: Option<String>,
    // 模型配置
    model: Option<String>,
    small_fast_model: Option<String>,
    sonnet_model: Option<String>,
    opus_model: Option<String>,
    haiku_model: Option<String>,
    // 显式标记缓存是否已初始化（避免所有字段为 None 时误判为未初始化）
    initialized: bool,
}

/// 获取 keyring 实例
fn get_keyring() -> &'static keyring::Entry {
    KEYRING.get_or_init(|| {
        keyring::Entry::new(SERVICE_NAME, "secrets").expect("Failed to create keyring entry")
    })
}

/// 直接从 keychain 读取所有密钥（内部函数，只在缓存初始化时调用）
fn read_all_secrets_from_keychain() -> Result<Vec<SecretEntry>, String> {
    eprintln!("[KEYCHAIN_DIAGNOSTIC] RUST: read_all_secrets_from_keychain() called — this will trigger macOS keychain prompt");
    log::warn!("read_all_secrets_from_keychain: 即将访问 macOS Keychain（如果看到此日志多次，说明有重复访问）");
    let keyring = get_keyring();

    match keyring.get_password() {
        Ok(json) => {
            log::info!("read_all_secrets_from_keychain: 成功读取 {} 字节", json.len());
            let secrets: Vec<SecretEntry> = match serde_json::from_str(&json) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("read_all_secrets_from_keychain: 反序列化失败 ({} 字节): {}", json.len(), e);
                    Vec::new()
                }
            };
            log::info!("read_all_secrets_from_keychain: 解析出 {} 条记录", secrets.len());
            Ok(secrets)
        }
        Err(keyring::Error::NoEntry) => {
            log::info!("read_all_secrets_from_keychain: 无存储记录");
            Ok(Vec::new())
        }
        Err(e) => {
            log::error!("read_all_secrets_from_keychain: 读取失败 - {}", e);
            Err(format!("读取密钥失败: {}", e))
        }
    }
}

/// 直接保存所有密钥到 keychain（内部函数，只在更新缓存时调用）
fn save_all_secrets_to_keychain(secrets: &[SecretEntry]) -> Result<(), String> {
    let keyring = get_keyring();
    let json = serde_json::to_string(secrets)
        .map_err(|e| format!("序列化失败: {}", e))?;

    log::info!("save_all_secrets_to_keychain: 保存 {} 条记录, {} 字节", secrets.len(), json.len());

    keyring.set_password(&json)
        .map_err(|e| format!("保存密钥失败: {}", e))
}

/// 安全存储密钥（使用缓存，避免重复 keychain 访问）
#[command]
pub async fn secure_store_set(key: String, value: String) -> Result<(), String> {
    log::info!("安全存储密钥: {}", key);

    // 从缓存获取（首次访问会触发 keychain 读取）
    let mut secrets = get_cached_secrets()?;

    // 查找是否已存在，存在则更新
    if let Some(existing) = secrets.iter_mut().find(|s| s.key == key) {
        existing.value = value;
    } else {
        secrets.push(SecretEntry { key: key.clone(), value });
    }

    // 更新缓存并写入 keychain
    update_cached_secrets(secrets)?;

    log::info!("安全存储密钥: {} 完成", key);
    Ok(())
}

/// 读取安全存储的密钥（使用缓存）
#[command]
pub async fn secure_store_get(key: String) -> Result<Option<String>, String> {
    // 从缓存获取（首次访问会触发 keychain 读取）
    let secrets = get_cached_secrets()?;
    Ok(secrets.iter().find(|s| s.key == key).map(|s| s.value.clone()))
}

/// 删除安全存储的密钥（使用缓存）
#[command]
pub async fn secure_store_delete(key: String) -> Result<(), String> {
    // 从缓存获取
    let mut secrets = get_cached_secrets()?;
    let initial_len = secrets.len();
    secrets.retain(|s| s.key != key);

    if secrets.len() < initial_len {
        // 更新缓存并写入 keychain
        update_cached_secrets(secrets)?;
    }
    Ok(())
}

// ============================================================================
// 同步版本读取函数（用于 Sidecar 启动时，避免 async 问题）
// ============================================================================

/// 获取配置缓存实例
fn get_config_cache() -> &'static RwLock<CachedConfig> {
    CONFIG_CACHE.get_or_init(|| RwLock::new(CachedConfig::default()))
}

/// 刷新配置缓存（在配置更新后调用）
/// 清空缓存，下次读取时会重新加载
pub fn refresh_config_cache() {
    // 清空 secrets 缓存
    let secrets_cache = get_secrets_cache();
    if let Ok(mut guard) = secrets_cache.write() {
        *guard = None;
        log::info!("refresh_config_cache: secrets 缓存已清空");
    }

    // 清空 CONFIG_CACHE（保留 initialized=false 的默认状态）
    let cache = get_config_cache();
    if let Ok(mut cache_guard) = cache.write() {
        *cache_guard = CachedConfig::default();
        log::info!("refresh_config_cache: CONFIG_CACHE 已清空");
    }
}

/// 初始化配置缓存（从 secrets 缓存加载）
fn init_config_cache(cache: &mut CachedConfig) {
    log::info!("init_config_cache: 开始加载配置");

    // 使用 secrets 缓存（首次访问会触发 keychain 读取）
    let secrets = match get_cached_secrets() {
        Ok(s) => s,
        Err(e) => {
            log::error!("init_config_cache: 读取失败 - {}", e);
            return;
        }
    };

    // 从 secrets 中提取各字段
    let get_value = |key: &str| -> Option<String> {
        secrets.iter().find(|s| s.key == key).map(|s| s.value.clone())
    };

    cache.api_key = get_value(KEY_API_KEY);
    cache.base_url = get_value(KEY_BASE_URL);
    cache.model = get_value(KEY_MODEL);
    cache.small_fast_model = get_value(KEY_SMALL_FAST_MODEL);
    cache.sonnet_model = get_value(KEY_SONNET_MODEL);
    cache.opus_model = get_value(KEY_OPUS_MODEL);
    cache.haiku_model = get_value(KEY_HAIKU_MODEL);
    cache.initialized = true;

    log::info!(
        "init_config_cache: 加载完成 - api_key={}, base_url={}, model={}",
        cache.api_key.as_deref().map(|k| if k.len() > 8 { &k[..4] } else { "***" }).unwrap_or("None"),
        cache.base_url.as_deref().unwrap_or("None"),
        cache.model.as_deref().unwrap_or("None")
    );
}

/// 检查 CONFIG_CACHE 是否已初始化
fn is_config_cache_initialized(cache: &CachedConfig) -> bool {
    cache.initialized
}

/// 同步读取 API Key（用于 Sidecar 启动）
pub fn get_api_key_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.api_key)
}

/// 同步读取 Base URL（用于 Sidecar 启动）
pub fn get_base_url_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.base_url)
}

/// 同步读取主模型（用于 Sidecar 启动）
pub fn get_model_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.model)
}

/// 同步读取快速模型（用于 Sidecar 启动）
pub fn get_small_fast_model_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.small_fast_model)
}

/// 同步读取 Sonnet 模型（用于 Sidecar 启动）
pub fn get_sonnet_model_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.sonnet_model)
}

/// 同步读取 Opus 模型（用于 Sidecar 启动）
pub fn get_opus_model_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.opus_model)
}

/// 同步读取 Haiku 模型（用于 Sidecar 启动）
pub fn get_haiku_model_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.haiku_model)
}

/// 通用缓存字段读取函数（消除重复代码）
fn get_cached_config_field<F>(get_field: F) -> Result<Option<String>, String>
where
    F: Fn(&CachedConfig) -> &Option<String>,
{
    let cache = get_config_cache();

    // 快速路径：读缓存
    {
        let cache_guard = cache.read().map_err(|e| format!("获取配置缓存读锁失败: {}", e))?;
        if is_config_cache_initialized(&cache_guard) {
            return Ok(get_field(&cache_guard).clone());
        }
    }

    // 缓存未初始化，加载并缓存
    let mut cache_guard = cache.write().map_err(|e| format!("获取配置缓存写锁失败: {}", e))?;
    init_config_cache(&mut cache_guard);
    Ok(get_field(&cache_guard).clone())
}

// ============================================================================
// 便捷方法：LLM 配置
// ============================================================================

/// 存储 LLM API Key / Auth Token
#[command]
pub async fn store_api_key(api_key: String) -> Result<(), String> {
    log::info!("store_api_key: 开始存储 API Key (长度: {})", api_key.len());
    secure_store_set(KEY_API_KEY.to_string(), api_key).await?;
    log::info!("store_api_key: 存储成功");
    Ok(())
}

/// 读取 LLM API Key
#[command]
pub async fn get_api_key() -> Result<Option<String>, String> {
    secure_store_get(KEY_API_KEY.to_string()).await
}

/// 删除 LLM API Key
#[command]
pub async fn delete_api_key() -> Result<(), String> {
    secure_store_delete(KEY_API_KEY.to_string()).await
}

/// 存储 LLM Base URL
#[command]
pub async fn store_base_url(url: String) -> Result<(), String> {
    log::info!("store_base_url: 开始存储 Base URL: {}", url);
    secure_store_set(KEY_BASE_URL.to_string(), url).await?;
    log::info!("store_base_url: 存储成功");
    Ok(())
}

/// 读取 LLM Base URL
#[command]
pub async fn get_base_url() -> Result<Option<String>, String> {
    secure_store_get(KEY_BASE_URL.to_string()).await
}

/// 删除 LLM Base URL
#[command]
pub async fn delete_base_url() -> Result<(), String> {
    secure_store_delete(KEY_BASE_URL.to_string()).await
}

/// 存储 LLM Model
#[command]
pub async fn store_model(model: String) -> Result<(), String> {
    secure_store_set(KEY_MODEL.to_string(), model).await
}

/// 读取 LLM Model
#[command]
pub async fn get_model() -> Result<Option<String>, String> {
    secure_store_get(KEY_MODEL.to_string()).await
}

/// 删除 LLM Model
#[command]
pub async fn delete_model() -> Result<(), String> {
    secure_store_delete(KEY_MODEL.to_string()).await
}

// ============================================================================
// 场景模型配置
// ============================================================================

/// 存储快速模型
#[command]
pub async fn store_small_fast_model(model: String) -> Result<(), String> {
    secure_store_set(KEY_SMALL_FAST_MODEL.to_string(), model).await
}

/// 读取快速模型
#[command]
pub async fn get_small_fast_model() -> Result<Option<String>, String> {
    secure_store_get(KEY_SMALL_FAST_MODEL.to_string()).await
}

/// 存储 Sonnet 模型
#[command]
pub async fn store_sonnet_model(model: String) -> Result<(), String> {
    secure_store_set(KEY_SONNET_MODEL.to_string(), model).await
}

/// 读取 Sonnet 模型
#[command]
pub async fn get_sonnet_model() -> Result<Option<String>, String> {
    secure_store_get(KEY_SONNET_MODEL.to_string()).await
}

/// 存储 Opus 模型
#[command]
pub async fn store_opus_model(model: String) -> Result<(), String> {
    secure_store_set(KEY_OPUS_MODEL.to_string(), model).await
}

/// 读取 Opus 模型
#[command]
pub async fn get_opus_model() -> Result<Option<String>, String> {
    secure_store_get(KEY_OPUS_MODEL.to_string()).await
}

/// 存储 Haiku 模型
#[command]
pub async fn store_haiku_model(model: String) -> Result<(), String> {
    secure_store_set(KEY_HAIKU_MODEL.to_string(), model).await
}

/// 读取 Haiku 模型
#[command]
pub async fn get_haiku_model() -> Result<Option<String>, String> {
    secure_store_get(KEY_HAIKU_MODEL.to_string()).await
}

// ============================================================================
// 便捷方法：GitHub Token
// ============================================================================

/// 存储 GitHub Token
#[command]
pub async fn store_github_token(token: String) -> Result<(), String> {
    secure_store_set(KEY_GITHUB_TOKEN.to_string(), token).await
}

/// 读取 GitHub Token
#[command]
pub async fn get_github_token() -> Result<Option<String>, String> {
    secure_store_get(KEY_GITHUB_TOKEN.to_string()).await
}

/// 删除 GitHub Token
#[command]
pub async fn delete_github_token() -> Result<(), String> {
    secure_store_delete(KEY_GITHUB_TOKEN.to_string()).await
}

// ============================================================================
// 便捷方法：同步用户名
// ============================================================================

/// 存储同步用户名
#[command]
pub async fn store_sync_username(username: String) -> Result<(), String> {
    secure_store_set(KEY_SYNC_USERNAME.to_string(), username).await
}

/// 读取同步用户名
#[command]
pub async fn get_sync_username() -> Result<Option<String>, String> {
    secure_store_get(KEY_SYNC_USERNAME.to_string()).await
}

/// 删除同步用户名
#[command]
pub async fn delete_sync_username() -> Result<(), String> {
    secure_store_delete(KEY_SYNC_USERNAME.to_string()).await
}

// ============================================================================
// 便捷方法：语音识别 API Key
// ============================================================================

/// 存储语音识别 API Key
#[command]
pub async fn store_asr_api_key(api_key: String) -> Result<(), String> {
    log::info!("store_asr_api_key: 开始存储语音识别 API Key");
    secure_store_set(KEY_ASR_API_KEY.to_string(), api_key).await
}

/// 读取语音识别 API Key
#[command]
pub async fn get_asr_api_key() -> Result<Option<String>, String> {
    secure_store_get(KEY_ASR_API_KEY.to_string()).await
}

/// 删除语音识别 API Key
#[command]
pub async fn delete_asr_api_key() -> Result<(), String> {
    secure_store_delete(KEY_ASR_API_KEY.to_string()).await
}

/// 同步读取语音识别 API Key（用于 Sidecar 启动）
pub fn get_asr_api_key_sync() -> Result<Option<String>, String> {
    get_cached_config_field(|c| &c.api_key)
}

/// 同步配置结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub username: Option<String>,
    pub github_token: Option<String>,
}

/// 批量读取同步配置（使用缓存，只触发 1 次 keychain 访问）
#[command]
pub async fn get_sync_config() -> Result<SyncConfig, String> {
    log::info!("get_sync_config: 开始读取同步配置");

    // 使用缓存（首次访问会触发 keychain 读取）
    let secrets = get_cached_secrets()?;

    // 从 secrets 中提取各字段
    let get_value = |key: &str| -> Option<String> {
        secrets.iter().find(|s| s.key == key).map(|s| s.value.clone())
    };

    let username = get_value(KEY_SYNC_USERNAME);
    let github_token = get_value(KEY_GITHUB_TOKEN);

    log::info!(
        "get_sync_config: username={}, token={}",
        username.as_deref().unwrap_or("None"),
        github_token.as_ref().map(|t| if t.len() > 8 { &t[..4] } else { "***" }).unwrap_or("None")
    );

    Ok(SyncConfig {
        username,
        github_token,
    })
}

/// 批量保存同步配置（使用缓存）
#[command]
pub async fn store_sync_config(config: SyncConfig) -> Result<(), String> {
    log::info!("store_sync_config: 开始批量保存同步配置");

    // 从缓存获取
    let mut secrets = get_cached_secrets()?;

    // 辅助函数：更新或添加字段
    let update_or_add = |secrets: &mut Vec<SecretEntry>, key: &str, value: Option<&String>| {
        if let Some(v) = value {
            if let Some(existing) = secrets.iter_mut().find(|s| s.key == key) {
                existing.value = v.clone();
            } else {
                secrets.push(SecretEntry { key: key.to_string(), value: v.clone() });
            }
        }
    };

    // 更新所有字段
    update_or_add(&mut secrets, KEY_SYNC_USERNAME, config.username.as_ref());
    update_or_add(&mut secrets, KEY_GITHUB_TOKEN, config.github_token.as_ref());

    // 更新缓存并写入 keychain
    update_cached_secrets(secrets)?;

    log::info!("store_sync_config: 批量保存完成");
    Ok(())
}

// ============================================================================
// 批量读取（用于前端初始化）
// ============================================================================

/// LLM 配置结构（包含所有模型配置）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    // 主模型
    pub model: Option<String>,
    // 场景模型
    pub small_fast_model: Option<String>,
    pub sonnet_model: Option<String>,
    pub opus_model: Option<String>,
    pub haiku_model: Option<String>,
}

/// 批量读取 LLM 配置（使用缓存）
#[command]
pub async fn get_llm_config() -> Result<LlmConfig, String> {
    log::info!("get_llm_config: 开始读取配置");

    // 使用缓存（首次访问会触发 keychain 读取）
    let secrets = get_cached_secrets()?;

    // 从 secrets 中提取各字段
    let get_value = |key: &str| -> Option<String> {
        secrets.iter().find(|s| s.key == key).map(|s| s.value.clone())
    };

    let api_key = get_value(KEY_API_KEY);
    let base_url = get_value(KEY_BASE_URL);
    let model = get_value(KEY_MODEL);
    let small_fast_model = get_value(KEY_SMALL_FAST_MODEL);
    let sonnet_model = get_value(KEY_SONNET_MODEL);
    let opus_model = get_value(KEY_OPUS_MODEL);
    let haiku_model = get_value(KEY_HAIKU_MODEL);

    log::info!(
        "get_llm_config: api_key={}, base_url={}, model={}",
        api_key.as_deref().map(|k| if k.len() > 8 { &k[..4] } else { "***" }).unwrap_or("None"),
        base_url.as_deref().unwrap_or("None"),
        model.as_deref().unwrap_or("None")
    );

    Ok(LlmConfig {
        api_key,
        base_url,
        model,
        small_fast_model,
        sonnet_model,
        opus_model,
        haiku_model,
    })
}

/// 批量保存 LLM 配置（使用缓存）
#[command]
pub async fn store_llm_config(config: LlmConfig) -> Result<(), String> {
    log::info!("store_llm_config: 开始批量保存配置");

    // 从缓存获取
    let mut secrets = get_cached_secrets()?;

    // 辅助函数：更新或添加字段
    let update_or_add = |secrets: &mut Vec<SecretEntry>, key: &str, value: Option<&String>| {
        if let Some(v) = value {
            if let Some(existing) = secrets.iter_mut().find(|s| s.key == key) {
                existing.value = v.clone();
            } else {
                secrets.push(SecretEntry { key: key.to_string(), value: v.clone() });
            }
        }
    };

    // 更新所有字段
    update_or_add(&mut secrets, KEY_API_KEY, config.api_key.as_ref());
    update_or_add(&mut secrets, KEY_BASE_URL, config.base_url.as_ref());
    update_or_add(&mut secrets, KEY_MODEL, config.model.as_ref());
    update_or_add(&mut secrets, KEY_SMALL_FAST_MODEL, config.small_fast_model.as_ref());
    update_or_add(&mut secrets, KEY_SONNET_MODEL, config.sonnet_model.as_ref());
    update_or_add(&mut secrets, KEY_OPUS_MODEL, config.opus_model.as_ref());
    update_or_add(&mut secrets, KEY_HAIKU_MODEL, config.haiku_model.as_ref());

    // 更新缓存并写入 keychain
    update_cached_secrets(secrets)?;

    log::info!("store_llm_config: 批量保存完成");
    Ok(())
}
