#!/bin/bash
# 测试 D_UI 与 diggdog 前后端连接
# 使用前请确保：1) npm run dev 已启动  2) diggdog-serve 已启动

set -e

echo "=== 前后端连接测试 ==="

# 1. 检查 D_UI 前端
echo -n "D_UI 前端 (localhost:1420): "
if curl -s -o /dev/null -w "%{http_code}" http://localhost:1420/ | grep -q 200; then
  echo "OK"
else
  echo "FAIL - 请先运行 npm run dev"
  exit 1
fi

# 2. 检查 diggdog 后端
echo -n "diggdog 后端 (localhost:3000): "
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
  echo "OK"
else
  echo "FAIL - 请先启动 diggdog-serve"
  echo "  cd ~/Documents/Program/diggdog"
  echo "  cargo run -p diggdog-server --bin diggdog-serve"
  exit 1
fi

# 3. 测试通过 D_UI proxy 调用 /health
echo -n "Proxy /health: "
PROXY_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:1420/health 2>/dev/null)
if [ "$PROXY_HEALTH" = "200" ]; then
  echo "OK"
else
  echo "FAIL (HTTP $PROXY_HEALTH)"
fi

# 4. 测试 /execute（简单任务）
echo -n "Execute 任务: "
RESP=$(curl -s -w "\n%{http_code}" -X POST http://localhost:1420/execute \
  -H "Content-Type: application/json" \
  -d '{"content":"1+1等于几？只回答数字","platform":"http"}' 2>/dev/null)
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
if [ "$CODE" = "200" ]; then
  echo "OK"
  echo "  响应: ${BODY:0:80}..."
else
  echo "FAIL (HTTP $CODE)"
  echo "  响应: $BODY"
fi

echo ""
echo "=== 测试完成 ==="
