# GitHub 配置仓库使用指南

## ✅ 仓库已创建成功

**仓库地址**: https://github.com/not-yes/config-sync-hub
**组织名称**: `laozheng`
**仓库类型**: 私有仓库

---

## 📁 仓库结构

```
config-sync-hub/
├── README.md                           # 完整使用说明
├── .gitignore                          # 排除敏感信息
└── organizations/                      # 组织配置根目录
    └── laozheng/                       # ← laozheng 组织配置包
        ├── README.md                   # 组织配置说明
        ├── settings.json               # 设置文件 (示例)
        ├── agents/                     # Agents 目录
        │   └── example-assistant.md    # 示例 agent
        └── skills/                     # Skills 目录
            └── example-skill/          # 示例 skill
                ├── SKILL.md
                ├── scripts/
                └── templates/
```

---

## 🚀 下一步操作

### 1️⃣ 配置 laozheng 组织

根据实际需求修改配置:

```bash
# 克隆仓库
cd /tmp/config-sync-hub

# 编辑 settings.json
vim organizations/laozheng/settings.json

# 添加真实 agent
cat > organizations/laozheng/agents/finance.md << 'EOF'
---
name: finance-assistant
description: 金融分析助手
---

你是一个金融分析专家...
EOF

# 提交并推送
git add organizations/laozheng
git commit -m "feat: 更新 laozheng 配置"
git push
```

### 2️⃣ 添加新组织

```bash
# 创建新组织目录
mkdir -p organizations/team-finance/{agents,skills}

# 添加配置
cp organizations/laozheng/settings.json organizations/team-finance/

# 提交
git add organizations/team-finance
git commit -m "feat: 添加 team-finance 组织"
git push
```

### 3️⃣ 前端集成

在 Claude Desktop 设置面板中:

1. 打开 **设置** → **配置同步**
2. 输入仓库地址: `https://github.com/not-yes/config-sync-hub`
3. 输入 Personal Access Token (需要 `repo` 权限)
4. 选择组织: `laozheng`
5. 点击 **拉取配置**

---

## 🔐 创建 Personal Access Token

1. 访问: https://github.com/settings/tokens
2. 点击 **Generate new token (classic)**
3. 设置:
   - **Note**: `Claude Desktop Config Sync`
   - **Expiration**: 根据需求选择
   - **Scopes**: ✅ `repo` (完整仓库权限)
4. 点击 **Generate token**
5. **复制 Token** (只显示一次!)

---

## 📋 管理命令速查

### 查看组织列表

```bash
ls organizations/
```

### 查看某个组织的配置

```bash
cat organizations/laozheng/settings.json
ls organizations/laozheng/agents/
ls organizations/laozheng/skills/
```

### 查看配置历史

```bash
# 查看 laozheng 的所有更改
git log --oneline -- organizations/laozheng/

# 查看某次提交的详细更改
git show <commit-hash>
```

### 回滚配置

```bash
# 查看历史版本
git log --oneline -- organizations/laozheng/

# 回退到某个版本
git checkout <commit-hash> -- organizations/laozheng/
git commit -m "revert: 回退 laozheng 配置"
git push
```

---

## 🎯 典型工作流

### 场景 1: 更新组织配置

```bash
# 1. 修改配置
cd /tmp/config-sync-hub
vim organizations/laozheng/settings.json

# 2. 添加新 agent
cat > organizations/laozheng/agents/new-agent.md << 'EOF'
---
name: new-agent
description: 新助手
---

描述...
EOF

# 3. 提交并推送
git add organizations/laozheng
git commit -m "update: 添加新 agent"
git push

# 4. 用户端拉取
# 用户在 Claude Desktop 点击"拉取配置"
```

### 场景 2: 添加新组织

```bash
# 1. 创建组织
mkdir -p organizations/new-org/{agents,skills}

# 2. 添加配置
cat > organizations/new-org/settings.json << 'EOF'
{
  "model": "claude-sonnet-4-20250514",
  "permissions": {"defaultMode": "default"}
}
EOF

# 3. 提交并推送
git add organizations/new-org
git commit -m "feat: 添加 new-org 组织"
git push

# 4. 用户选择新组织同步
```

### 场景 3: 批量更新所有组织

```bash
# 1. 更新所有组织的 settings.json
for org in organizations/*/; do
  echo "更新 $org"
  # 执行更新逻辑
done

# 2. 提交所有更改
git add organizations/
git commit -m "update: 批量更新所有组织配置"
git push
```

---

## ⚠️ 安全注意事项

### ✅ 应该做的

- ✅ 使用 `.gitignore` 排除敏感文件
- ✅ 在 settings.json 中使用环境变量引用密钥
- ✅ 定期轮换 Personal Access Token
- ✅ 使用最小权限 Token (只需 `repo`)
- ✅ 审查每次提交的内容

### ❌ 不应该做的

- ❌ 在 settings.json 中存储 API Key
- ❌ 在 agents/skills 中硬编码密码
- ❌ 使用过期的 Token
- ❌ 给予 Token 过多权限
- ❌ 提交 `.env` 文件

---

## 📊 仓库信息

| 项目 | 值 |
|------|-----|
| **仓库名称** | config-sync-hub |
| **完整地址** | https://github.com/not-yes/config-sync-hub |
| **仓库类型** | 私有 |
| **当前组织** | laozheng |
| **初始提交** | 2026-04-13 |
| **文件大小** | ~4.4 KB |

---

## 🔗 相关文档

- [配置同步完整方案](./config-sync-solution.md)
- [快速实施指南](./config-sync-quick-start.md)
- [GitHub Token 创建指南](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

---

## 💡 提示

1. **本地仓库位置**: `./config-sync-hub/` (项目根目录下)
2. **SSH 克隆**: `git clone git@github.com:not-yes/config-sync-hub.git`
3. **HTTPS 克隆**: `https://github.com/not-yes/config-sync-hub.git`

---

**创建时间**: 2026-04-13
**创建者**: not-yes (aaronwang123321)
