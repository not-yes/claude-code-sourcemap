#!/bin/bash

# 彻底修复 macOS Keychain 授权问题
# 此脚本会：
# 1. 删除旧的 Keychain 条目（可能有错误的 ACL 配置）
# 2. 创建新的条目，并设置正确的访问控制

SERVICE_NAME="claude-desktop"
ACCOUNT_NAME="secrets"

echo "🔐 彻底修复 macOS Keychain 授权..."
echo ""

# 步骤 1: 删除旧条目
echo "📋 步骤 1: 删除旧的 Keychain 条目..."
security delete-generic-password -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ 旧条目已删除"
else
    echo "ℹ️  未找到旧条目（正常）"
fi

echo ""
echo "📋 步骤 2: 创建新的 Keychain 条目（带空密码用于测试）..."

# 步骤 2: 创建新条目
# 使用 add-generic-password 创建条目
echo "[]" | security add-generic-password -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" -w "[]" -U 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ 新条目已创建"
else
    echo "❌ 创建失败，请手动操作："
    echo ""
    echo "手动步骤："
    echo "1. 打开 '钥匙串访问' (Keychain Access)"
    echo "2. 搜索 'claude-desktop' 并删除所有相关条目"
    echo "3. 重新启动应用"
    echo "4. 首次授权时选择 '始终允许'"
    exit 1
fi

echo ""
echo "📋 步骤 3: 配置 ACL - 允许所有应用访问..."

# 步骤 3: 设置 ACL（允许所有应用访问，不需要密码确认）
# 使用 codesign 获取当前应用的 team ID
TEAM_ID=$(codesign -dvvv /Applications/Claude.app 2>&1 | grep "Authority=Developer ID" | head -1 | sed 's/.*=//')

if [ -n "$TEAM_ID" ]; then
    echo "ℹ️  检测到 Team ID: $TEAM_ID"
    # 为特定应用设置 ACL
    security set-generic-password-partition-list -S "teamid:$TEAM_ID" -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" 2>/dev/null
else
    echo "ℹ️  开发模式：设置为允许所有应用访问"
    # 开发模式：允许所有应用访问
    security set-generic-password-partition-list -S "" -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" 2>/dev/null
fi

if [ $? -eq 0 ]; then
    echo "✅ ACL 配置成功"
else
    echo "⚠️  ACL 配置失败（可能需要手动输入密码）"
    echo ""
    echo "请在弹出的密码窗口中："
    echo "1. 输入系统密码"
    echo "2. 勾选 '始终允许'"
    echo "3. 点击 '允许'"
fi

echo ""
echo "🎉 修复完成！"
echo ""
echo "📖 验证步骤："
echo "1. 关闭所有应用窗口"
echo "2. 重新运行: npm run tauri:dev"
echo "3. 如果仍然弹出密码窗口，勾选 '始终允许'"
echo "4. 后续启动不应该再要求密码"
echo ""
echo "💡 如果问题仍然存在："
echo "   - 打开 '钥匙串访问'"
echo "   - 搜索 'claude-desktop'"
echo "   - 双击条目 -> 访问控制"
echo "   - 确保选择 '允许所有应用程序访问此项目'"
echo ""
echo "按回车键退出..."
read
