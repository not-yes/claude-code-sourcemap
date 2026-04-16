# 🔐 Keychain 重复密码问题 - 彻底诊断与修复指南

## 问题现象

启动应用时，**多次弹出 Keychain 密码窗口**，即使已经勾选"始终允许"。

---

## 根本原因分析

### 1. 代码层面 ✅ 已优化

```rust
// secure_storage.rs
static SECRETS_CACHE: OnceLock<RwLock<Option<Vec<SecretEntry>>>> = OnceLock::new();

fn get_cached_secrets() -> Result<Vec<SecretEntry>, String> {
    // 快速路径：检查缓存
    {
        let cache = get_secrets_cache();
        let guard = cache.read()?;
        if let Some(ref secrets) = *guard {
            return Ok(secrets.clone());  // 已缓存，0 次 Keychain 访问
        }
    }
    
    // 只有首次加载时访问 Keychain
    load_secrets_to_cache()?;  // 1 次 Keychain 访问
    ...
}
```

**结论**：代码层面已经优化到**运行期间只有 1 次 Keychain 访问**。

### 2. macOS Keychain ACL 配置 ⚠️ 问题所在

macOS Keychain 有两种访问控制模式：

#### 模式 A：User Prompt（当前）
- 每次访问都弹出密码窗口
- 即使用户勾选"始终允许"，开发模式下也会失效
- **原因**：开发模式每次编译签名不同，macOS 认为是新应用

#### 模式 B：Allow All（目标）
- 不需要密码确认
- 任何应用都可以访问
- **需要手动配置**

---

## 诊断步骤

### 步骤 1：运行诊断脚本

```bash
cd frontend/src-tauri
./diagnose-keychain.sh
```

**输出示例**：

```
🔍 诊断 Keychain 条目配置...

📋 查找 Keychain 条目...
keychain: "/Users/wangke/Library/Keychains/login.keychain-db"
version: 512
class: "genp"
attributes:
    0x00000007 <blob>="claude-desktop"
    "acct"<blob>="secrets"
    "svce"<blob>="claude-desktop"
    ...

📋 检查 ACL 配置...

💡 分析结果：

⚠️  检测到 ACL 限制（accc 字段）
   这意味着每次访问都需要用户确认

🔧 解决方案：
   运行: ./fix-keychain-permanent.sh
```

### 步骤 2：手动检查（备选）

1. 打开 **钥匙串访问** (Keychain Access)
   - `Cmd + Space` → 输入 "钥匙串访问"

2. 搜索 `claude-desktop`

3. 双击找到的条目

4. 切换到 **访问控制** 标签页

5. 检查当前配置：
   - ❌ "确认访问前提示" → 需要密码
   - ✅ "允许所有应用程序访问此项目" → 不需要密码

---

## 修复方案

### 方案 1：自动修复（推荐）

```bash
cd frontend/src-tauri
./fix-keychain-permanent.sh
```

**脚本会**：
1. 删除旧的 Keychain 条目（可能有错误的 ACL）
2. 创建新的条目
3. 设置 ACL 为允许所有应用访问
4. 配置正确的访问控制

### 方案 2：手动修复

1. **删除旧条目**：
   - 打开 **钥匙串访问**
   - 搜索 `claude-desktop`
   - 右键删除所有相关条目

2. **重新启动应用**：
   ```bash
   npm run tauri:dev
   ```

3. **首次授权时**：
   - 输入系统密码
   - ✅ **勾选 "始终允许"**（关键！）
   - 点击 "允许"

4. **验证 ACL 配置**：
   ```bash
   ./diagnose-keychain.sh
   ```

### 方案 3：使用 security 命令

```bash
# 删除旧条目
security delete-generic-password -s "claude-desktop" -a "secrets"

# 创建新条目（带正确的 ACL）
echo "[]" | security add-generic-password \
  -s "claude-desktop" \
  -a "secrets" \
  -l "claude-desktop" \
  -w "[]" \
  -U

# 设置 ACL（允许所有应用）
security set-generic-password-partition-list \
  -S "" \
  -s "claude-desktop" \
  -a "secrets" \
  -l "claude-desktop"
```

---

## 开发模式 vs 正式构建

### 开发模式 (`npm run tauri:dev`)

| 特性 | 行为 |
|------|------|
| 应用签名 | 每次编译不同 |
| macOS 识别 | 认为是不同的应用 |
| "始终允许" | ❌ 不会生效 |
| 每次启动 | 需要输入 1 次密码 |
| 运行期间 | ✅ 只有 1 次 Keychain 访问（已优化） |

**结论**：开发模式下，**每次启动输入 1 次密码是正常的 macOS 安全行为**，无法完全绕过。

### 正式构建 (`pnpm tauri build`)

| 特性 | 行为 |
|------|------|
| 应用签名 | 固定 |
| macOS 识别 | 认为是同一个应用 |
| "始终允许" | ✅ 会生效 |
| 首次启动 | 输入 1 次密码 + 勾选"始终允许" |
| 后续启动 | ✅ 不再要求密码 |

---

## 验证修复

### 1. 检查日志

启动应用后，查看终端输出：

```
[INFO] 应用启动：预加载安全存储缓存...
[INFO] preload_cache: 开始预加载安全存储缓存
[INFO] load_secrets_to_cache: 首次加载，访问 keychain  ← 只有这 1 次！
[INFO] load_secrets_to_cache: 读取到 X 条记录
[INFO] preload_cache: 预加载完成
```

**如果看到多次 "首次加载"**，说明缓存机制有问题。

### 2. 检查密码窗口

- **启动时**：弹出 1 次密码窗口 ✅
- **打开设置面板**：不弹出 ✅
- **打开配置同步**：不弹出 ✅
- **保存配置**：不弹出 ✅

### 3. 运行诊断

```bash
./diagnose-keychain.sh
```

应该看到：

```
✅ 未检测到 ACL 限制
   如果仍然要求密码，可能是其他原因
```

---

## 常见问题

### Q1: 为什么开发模式每次都要密码？

**A**: macOS 安全机制。开发模式每次编译的应用签名不同，macOS 无法识别为同一个应用，所以"始终允许"不会生效。

### Q2: 能完全去掉开发模式的密码吗？

**A**: 不能。这是 macOS 的安全设计，除非：
1. 使用正式构建
2. 或手动配置 Keychain ACL 为"允许所有应用"

### Q3: 配置 ACL 后安全吗？

**A**: 取决于你的场景：
- **开发环境**：安全，因为只有你本地能访问
- **生产环境**：建议使用代码签名 + ACL 限制特定应用

### Q4: 运行期间还会多次弹出吗？

**A**: 不会。代码已经优化到只有 1 次 Keychain 访问（启动时预加载）。

---

## 总结

| 优化项 | 状态 | 说明 |
|--------|------|------|
| 代码缓存机制 | ✅ 完成 | 运行期间只有 1 次访问 |
| 竞态条件修复 | ✅ 完成 | 消除 CACHE_INITIALIZED |
| 错误处理改进 | ✅ 完成 | 全部使用 map_err |
| Keychain ACL | ⚠️ 需配置 | 需要手动或使用脚本 |
| 开发模式密码 | ⚠️ 正常 | macOS 安全机制，无法绕过 |
| 正式构建密码 | ✅ 只需 1 次 | 首次授权后不再要求 |

**下一步**：运行 `./fix-keychain-permanent.sh` 修复 ACL 配置。
