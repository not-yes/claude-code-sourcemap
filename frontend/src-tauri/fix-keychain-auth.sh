#!/bin/bash

# 修复 macOS Keychain 授权问题
# 运行此脚本后，Keychain 条目将不再要求密码验证

SERVICE_NAME="claude-desktop"
ACCOUNT_NAME="secrets"

echo "🔐 修复 macOS Keychain 授权..."

# 查找 Keychain 条目
echo "📋 查找 Keychain 条目..."
security find-generic-password -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ 找到 Keychain 条目"
    
    # 清除现有的 ACL 设置
    echo "🔓 清除 ACL 限制..."
    security set-generic-password-partition-list -S "" -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" 2>/dev/null
    
    if [ $? -eq 0 ]; then
        echo "✅ ACL 清除成功"
        echo ""
        echo "🎉 完成！现在应用访问 Keychain 不再需要密码验证"
        echo ""
        echo "💡 如果仍然有问题，请手动操作："
        echo "   1. 打开 '钥匙串访问' (Keychain Access)"
        echo "   2. 搜索 'claude-desktop'"
        echo "   3. 双击条目 -> 访问控制"
        echo "   4. 勾选 '允许所有应用程序访问此项目'"
    else
        echo "❌ ACL 清除失败，需要手动配置"
        echo ""
        echo "📖 手动操作步骤："
        echo "   1. 打开 '钥匙串访问' (Keychain Access)"
        echo "   2. 搜索 'claude-desktop'"
        echo "   3. 双击条目 -> 访问控制"
        echo "   4. 选择 '允许所有应用程序访问此项目'"
        echo "   5. 点击 '存储更改'（可能需要输入密码）"
    fi
else
    echo "⚠️  未找到 Keychain 条目"
    echo "   首次运行应用时会自动创建"
    echo "   创建后请运行此脚本修复授权"
fi

echo ""
echo "按回车键退出..."
read
