# 🔐 修复 Keychain 重复要求密码问题

## 问题原因

在 **开发模式** (`pnpm tauri dev`) 下：
- 每次编译的应用签名不同
- macOS 认为是不同的应用
- "始终允许" 不会生效
- **每次启动都需要输入密码**（这是 macOS 安全机制，无法绕过）

在 **正式构建** (`pnpm tauri build`) 下：
- 应用签名固定
- 首次授权后应不再要求密码

---

## 解决方案

### 方案 1：手动配置（推荐）

1. 打开 **钥匙串访问** (Keychain Access)
   - 按 `Cmd + Space`，输入 "钥匙串访问" 或 "Keychain Access"

2. 搜索 `claude-desktop`
   - 在右上角搜索框输入 `claude-desktop`

3. 双击找到的条目

4. 切换到 **访问控制** 标签页

5. 选择 **允许所有应用程序访问此项目**

6. 点击 **存储更改**（可能需要输入一次密码）

✅ 完成！以后不再需要密码

---

### 方案 2：使用脚本（自动）

```bash
cd frontend/src-tauri
./fix-keychain-auth.sh
```

脚本会引导你完成配置。

---

### 方案 3：删除旧的 Keychain 条目（重新开始）

如果上述方法不行，可以删除旧条目重新开始：

1. 打开 **钥匙串访问**
2. 搜索 `claude-desktop`
3. 右键删除该条目
4. 重新启动应用
5. 首次授权时选择 **始终允许**

---

## 验证

运行应用后，检查日志应该看到：

```
应用启动：预加载安全存储缓存...
preload_cache: 开始预加载安全存储缓存
load_secrets_to_cache: 首次加载，访问 keychain  ← 只有这 1 次
load_secrets_to_cache: 读取到 X 条记录
preload_cache: 预加载完成
```

后续启动不应该再弹出密码窗口。

---

## 开发模式特别说明

⚠️ **开发模式下每次都要求密码是正常的 macOS 安全行为**

如果你想在开发时也避免重复输入，可以：

1. **使用正式构建测试**：
   ```bash
   cd frontend
   pnpm tauri build
   open src-tauri/target/release/bundle/macos/*.app
   ```

2. **或者接受开发模式的限制**：
   - 每次 `pnpm tauri dev` 都需要输入 1 次密码
   - 但应用运行期间不会再要求（因为使用了内存缓存）
