# Chat 流式输出实现审查报告

## 一、整体评价

实现符合计划，流式/同步 fallback、Markdown 渲染、增量更新等核心逻辑正确。发现若干需优化点。

---

## 二、问题与建议

### 2.1 executeStream 中 onDone 被重复调用 [已修复]

**位置**: `src/api/diggdog.ts`

**问题**: 流正常结束时，`onDone(null)` 会执行两次（onclose + promise resolve 后各一次）。

**修复**: 已删除 `await` 之后的冗余 `if (usedStream) onDone(null)`，仅保留 `onclose` 中的调用。

---

### 2.2 快速连续发送时的并发处理 [可选优化]

**位置**: `src/components/chat/ChatArea.tsx`

**问题**: 快速连续发送两条消息（例如在 `loading` 尚未变为 `true` 时再次发送）时，会有两个 `executeStream` 并发执行，两个 `onDone` 会各自 `setLoading(false)`。

**影响**: 若第一条流先结束，会过早把 `loading` 设为 `false`，第二条仍在流式时输入框已可编辑。多数场景可接受。

**建议**: 若需严格串行，可维护 `inFlightRef` 或使用 `AbortController` 取消前一个请求；否则可维持现状。

---

### 2.3 无取消机制 [可选优化]

**位置**: `src/api/diggdog.ts` - `executeStream`

**问题**: 用户切换会话、关闭页面或快速离开时，流仍继续，`onChunk`/`onDone` 可能对已卸载组件调用 `setState`，触发 React 警告。

**建议**: 暴露 `AbortSignal`，在 ChatArea unmount 或用户取消时 abort 请求：

```ts
// executeStream 增加 signal 参数，传给 fetchEventSource
export async function executeStream(
  content: string,
  sessionId: string,
  callbacks: ExecuteStreamCallbacks,
  signal?: AbortSignal
): Promise<void>
```

---

### 2.4 Content-Type 探测与后端实际格式 [待确认]

**位置**: `src/api/diggdog.ts` 第 68–71 行

**问题**: 当前仅识别 `text/event-stream` 和 `application/x-ndjson`。若 diggdog 使用其他流式类型（如 `application/stream+json`），会被当成同步响应并在 `onopen` 中读取 `response.text()`，可能破坏实际为流式的响应。

**建议**: 与后端对齐实际 `Content-Type`，必要时扩展判断逻辑。

---

### 2.5 MarkdownContent 安全性 [通过]

**位置**: `src/components/chat/MarkdownContent.tsx`

**结论**: `react-markdown` 默认不启用 raw HTML，不会直接渲染 `<script>` 等危险标签，当前用法安全。

---

### 2.6 ChatArea 中 catch 块 [保留合理]

**位置**: `src/components/chat/ChatArea.tsx` 第 56–68 行

**说明**: `executeStream` 设计上不向外 `throw`，因此该 `catch` 基本不会触发，但作为兜底处理未预期错误是有意义的，建议保留。

---

### 2.7 空 assistant 消息展示 [可接受]

**位置**: `src/components/chat/MessageBubble.tsx`

**说明**: `content` 为空且 `streaming === false` 时仅渲染时间戳，没有正文。若服务端返回空回复会出现空泡，但属合法状态，可接受。

---

### 2.8 测试与 URL 断言 [通过]

**位置**: `tests/api/diggdog.test.ts`

**说明**: 使用 `expect.stringContaining("/execute")` 仍能匹配 `/api/v1/execute`，测试通过合理。

---

## 三、修复优先级

| 项 | 优先级 | 说明 |
|----|--------|------|
| 2.1 onDone 重复调用 | 高 | 已修复 |
| 2.3 取消机制 | 中 | 提升健壮性和体验 |
| 2.2 并发处理 | 低 | 视产品需求决定 |
| 2.4 Content-Type | 低 | 依赖后端实现 |

---

## 四、结论

实现整体质量良好，逻辑正确，符合计划设计。onDone 重复调用已修复；取消机制与并发控制可按需求后续补充。
