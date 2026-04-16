#!/bin/bash

# 诊断 Keychain 条目配置

SERVICE_NAME="claude-desktop"
ACCOUNT_NAME="secrets"

echo "🔍 诊断 Keychain 条目配置..."
echo ""

# 查找条目
echo "📋 查找 Keychain 条目..."
security find-generic-password -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" 2>&1

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ 未找到 Keychain 条目"
    echo "   请先运行应用创建条目，然后再次运行此脚本"
    exit 1
fi

echo ""
echo "📋 检查 ACL 配置..."
echo ""

# 检查 Access Control List
security find-generic-password -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" -a 2>&1 | grep -A 20 "access"

echo ""
echo "💡 分析结果："
echo ""

# 检查是否有限制
if security find-generic-password -s "$SERVICE_NAME" -a "$ACCOUNT_NAME" -l "$SERVICE_NAME" 2>&1 | grep -q "accc"; then
    echo "⚠️  检测到 ACL 限制（accc 字段）"
    echo "   这意味着每次访问都需要用户确认"
    echo ""
    echo "🔧 解决方案："
    echo "   运行: ./fix-keychain-permanent.sh"
else
    echo "✅ 未检测到 ACL 限制"
    echo "   如果仍然要求密码，可能是其他原因"
fi

echo ""
echo "📖 手动检查步骤："
echo "   1. 打开 '钥匙串访问' (Keychain Access)"
echo "   2. 搜索 'claude-desktop'"
echo "   3. 双击条目"
echo "   4. 查看 '访问控制' 标签页"
echo "   5. 确认选择的是 '允许所有应用程序访问此项目'"
echo ""
echo "按回车键退出..."
read
