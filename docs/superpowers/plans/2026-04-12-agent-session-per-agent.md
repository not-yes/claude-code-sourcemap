# Per-Agent 会话管理修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复前端 Agent 会话区域的核心 Bug——每个 Agent 的会话历史和当前会话状态应该完全独立，互不干扰。

**Architecture:** 将全局单一的 `activeBackendSessionId` 改为 per-agent 的状态管理。新建 `agentSessionsStore.ts` 作为专用 store，ContentList 从 store 直接读取当前会话标题（不再重复调 API），MainContent 传 per-agent 的 sessionId 给 ChatArea 和 ConversationHistorySheet。

**Tech Stack:** React 18 + Zustand + TypeScript + Tauri API

---

## File Structure

```
frontend/src/
├── stores/
│   ├── agentSessionsStore.ts    # 新建：per-agent 会话状态管理
│   └── appStore.ts              # 修改：移除 activeBackendSessionId 及相关方法
├── components/layout/
│   ├── ContentList.tsx          # 修改：从 store 读取会话标题，移除重复 API 调用
│   └── MainContent.tsx          # 修改：传 per-agent sessionId 而非全局状态
├── components/chat/
│   ├── ChatArea.tsx             # 修改：从 agentSessionsStore 读取 per-agent session
│   └── ConversationHistorySheet.tsx  # 修改：传 per-agent sessionId
└── lib/
    └── backendSessionStorage.ts # 现有：保持不变，作为持久化层
```

---

## Task 1: 创建 agentSessionsStore

**Files:**
- Create: `frontend/src/stores/agentSessionsStore.ts`
- Test: `frontend/src/stores/__tests__/agentSessionsStore.test.ts` (创建目录)

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p frontend/src/stores/__tests__
```

- [ ] **Step 2: 编写 agentSessionsStore**

```typescript
import { create } from "zustand";
import {
  loadPersistedBackendSession,
  savePersistedBackendSession,
} from "@/lib/backendSessionStorage";

interface AgentSessionState {
  // per-agent 的当前活跃后端会话 ID: agentId -> sessionId | null
  activeBackendSessions: Record<string, string | null>;
  // per-agent 的最近会话标题: agentId -> title
  recentSessionTitles: Record<string, string>;
}

interface AgentSessionActions {
  // 获取指定 agent 的活跃会话 ID
  getActiveSessionId: (agentId: string) => string | null;
  // 设置指定 agent 的活跃会话 ID（同时持久化）
  setActiveSessionId: (agentId: string, sessionId: string | null) => void;
  // 获取指定 agent 的最近会话标题
  getRecentTitle: (agentId: string) => string | undefined;
  // 设置指定 agent 的最近会话标题
  setRecentTitle: (agentId: string, title: string) => void;
  // 清除指定 agent 的会话（新建对话时调用）
  clearSession: (agentId: string) => void;
  // 初始化：从 localStorage 恢复所有 agent 的会话
  initFromStorage: (agentIds: string[]) => void;
}

const SESSION_TITLES_KEY = "claude_recent_session_titles";

export const useAgentSessionsStore = create<AgentSessionState & AgentSessionActions>()(
  (set, get) => ({
    activeBackendSessions: {},
    recentSessionTitles: {},

    getActiveSessionId: (agentId: string) => {
      return get().activeBackendSessions[agentId] ?? null;
    },

    setActiveSessionId: (agentId: string, sessionId: string | null) => {
      savePersistedBackendSession(agentId, sessionId);
      set((state) => ({
        activeBackendSessions: {
          ...state.activeBackendSessions,
          [agentId]: sessionId,
        },
      }));
    },

    getRecentTitle: (agentId: string) => {
      return get().recentSessionTitles[agentId];
    },

    setRecentTitle: (agentId: string, title: string) => {
      set((state) => ({
        recentSessionTitles: {
          ...state.recentSessionTitles,
          [agentId]: title,
        },
      }));
      // 同时持久化到 localStorage
      try {
        const raw = localStorage.getItem(SESSION_TITLES_KEY);
        const titles = raw ? JSON.parse(raw) : {};
        titles[agentId] = title;
        localStorage.setItem(SESSION_TITLES_KEY, JSON.stringify(titles));
      } catch {
        // 静默忽略
      }
    },

    clearSession: (agentId: string) => {
      savePersistedBackendSession(agentId, null);
      set((state) => {
        const next = { ...state.activeBackendSessions };
        delete next[agentId];
        return { activeBackendSessions: next };
      });
    },

    initFromStorage: (agentIds: string[]) => {
      const sessions: Record<string, string | null> = {};
      const titlesRaw = localStorage.getItem(SESSION_TITLES_KEY);
      const titles = titlesRaw ? JSON.parse(titlesRaw) : {};
      for (const id of agentIds) {
        sessions[id] = loadPersistedBackendSession(id);
      }
      set({
        activeBackendSessions: sessions,
        recentSessionTitles: titles,
      });
    },
  })
);
```

- [ ] **Step 3: 创建测试文件**

```typescript
import { renderHook, act } from "@testing-library/react";
import { useAgentSessionsStore } from "../agentSessionsStore";

describe("agentSessionsStore", () => {
  beforeEach(() => {
    localStorage.clear();
    // 重置 store 状态
    useAgentSessionsStore.setState({
      activeBackendSessions: {},
      recentSessionTitles: {},
    });
  });

  it("getActiveSessionId returns null for unknown agent", () => {
    const { result } = renderHook(() => useAgentSessionsStore());
    expect(result.current.getActiveSessionId("unknown")).toBeNull();
  });

  it("setActiveSessionId stores and persists session id", () => {
    const { result } = renderHook(() => useAgentSessionsStore());
    act(() => {
      result.current.setActiveSessionId("agent1", "session-abc");
    });
    expect(result.current.getActiveSessionId("agent1")).toBe("session-abc");
    expect(localStorage.getItem("claude_backend_session_agent1")).toBe("session-abc");
  });

  it("setActiveSessionId with null clears session", () => {
    const { result } = renderHook(() => useAgentSessionsStore());
    act(() => {
      result.current.setActiveSessionId("agent1", "session-abc");
    });
    act(() => {
      result.current.setActiveSessionId("agent1", null);
    });
    expect(result.current.getActiveSessionId("agent1")).toBeNull();
    expect(localStorage.getItem("claude_backend_session_agent1")).toBeNull();
  });

  it("setRecentTitle persists title", () => {
    const { result } = renderHook(() => useAgentSessionsStore());
    act(() => {
      result.current.setRecentTitle("agent1", "测试会话");
    });
    expect(result.current.getRecentTitle("agent1")).toBe("测试会话");
  });

  it("initFromStorage restores all agents", () => {
    localStorage.setItem("claude_backend_session_agent1", "session-1");
    localStorage.setItem("claude_backend_session_agent2", "session-2");
    const { result } = renderHook(() => useAgentSessionsStore());
    act(() => {
      result.current.initFromStorage(["agent1", "agent2"]);
    });
    expect(result.current.getActiveSessionId("agent1")).toBe("session-1");
    expect(result.current.getActiveSessionId("agent2")).toBe("session-2");
  });
});
```

- [ ] **Step 4: 运行测试验证**

```bash
cd frontend && npm test -- --testPathPattern="agentSessionsStore" --watchAll=false 2>&1 | head -40
```

Expected: Tests should pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/agentSessionsStore.ts
git commit -m "feat: add agentSessionsStore for per-agent session management"
```

---

## Task 2: 修改 appStore — 移除 activeBackendSessionId

**Files:**
- Modify: `frontend/src/stores/appStore.ts` (移除 activeBackendSessionId 及其 setter)

- [ ] **Step 1: 移除状态中的 activeBackendSessionId 声明**

找到 `activeBackendSessionId: string | null;` 和 `setActiveBackendSessionId`，从 AppState interface 和实现中删除。

- [ ] **Step 2: 验证 ChatArea 是否还在直接引用 setActiveBackendSessionId**

```bash
grep -n "setActiveBackendSessionId\|activeBackendSessionId" frontend/src/components/chat/ChatArea.tsx
```

如果有引用——这些将在 Task 3 中改为从 agentSessionsStore 读取，所以先跳过此处。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/appStore.ts
git commit -m "refactor: remove activeBackendSessionId from appStore (moved to agentSessionsStore)"
```

---

## Task 3: 修改 ChatArea — 从 agentSessionsStore 读取 per-agent session

**Files:**
- Modify: `frontend/src/components/chat/ChatArea.tsx`

- [ ] **Step 1: 替换 store 引用**

替换 `activeBackendSessionId` 的读取和写入：

```typescript
// 替换前:
const activeBackendSessionId = useAppStore((s) => s.activeBackendSessionId);
const setActiveBackendSessionId = useAppStore((s) => s.setActiveBackendSessionId);

// 替换后:
const activeBackendSessionId = useAgentSessionsStore((s) => s.getActiveSessionId(sessionId));
const setActiveBackendSessionId = useAgentSessionsStore((s) => s.setActiveSessionId.bind(null, sessionId));
```

注意：`getActiveSessionId` 是函数而非 state 属性，所以需要在 store selector 中使用或直接调用。

更好的方式——在组件中直接调用：

```typescript
const activeBackendSessionId = useAgentSessionsStore((s) => s.activeBackendSessions[sessionId] ?? null);
const setActiveSessionId = useAgentSessionsStore((s) => s.setActiveSessionId);
```

然后把 `setActiveBackendSessionId` 的调用替换为 `setActiveSessionId`。

- [ ] **Step 2: 替换所有 setActiveBackendSessionId 调用**

在 ChatArea 中将 `setActiveBackendSessionId(x)` 替换为 `setActiveSessionId(sessionId, x)`。

涉及的位置：
- `useEffect` 加载后端会话时（加载成功后 `setActiveBackendSessionId(id)` → `setActiveSessionId(sessionId, id)`）
- `handleNewChat` 中 `setActiveBackendSessionId(null)` → `setActiveSessionId(sessionId, null)`
- 加载失败时 `setActiveBackendSessionId(null)` → `setActiveSessionId(sessionId, null)`

- [ ] **Step 3: 替换 loadPersistedBackendSession 的调用**

在 `useEffect` 切换 Agent 时：

```typescript
// 替换前:
const persisted = loadPersistedBackendSession(sessionId);
setActiveBackendSessionId(persisted);

// 替换后:
setActiveSessionId(sessionId, persisted);
```

`savePersistedBackendSession` 的调用在 `handleNewChat` 中改为使用 store：

```typescript
// handleNewChat 中:
// savePersistedBackendSession(sessionId, null); // 删除这行
setActiveSessionId(sessionId, null); // 使用 store
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/chat/ChatArea.tsx
git commit -m "feat: ChatArea now uses per-agent session from agentSessionsStore"
```

---

## Task 4: 修改 ContentList — 从 store 读取会话标题，移除重复 API 调用

**Files:**
- Modify: `frontend/src/components/layout/ContentList.tsx`

- [ ] **Step 1: 添加 store 引用**

```typescript
import { useAgentSessionsStore } from "@/stores/agentSessionsStore";
```

- [ ] **Step 2: 替换摘要加载逻辑**

当前代码在 `useEffect` 中对每个 agent 并发调用 `getSessions({ agent_id: agent.id, limit: 1 })`。替换为从 store 读取：

```typescript
// 删除整个 useEffect 中的 getSessions 并发调用逻辑（lines ~345-376）
// 替换为直接读取 store:
const getRecentTitle = useAgentSessionsStore((s) => s.getRecentTitle);
const subtitle = getRecentTitle(a.id) ?? `Agent ID: ${a.id}`;
```

- [ ] **Step 3: 初始化 store**

在 ContentList 顶部 useEffect 中初始化 agent 列表到 store：

```typescript
// 当 agents 列表加载完成后，初始化 store
useEffect(() => {
  if (!agentsLoading && agents.length > 0) {
    useAgentSessionsStore.getState().initFromStorage(agents.map(a => a.id));
  }
}, [agents, agentsLoading]);
```

- [ ] **Step 4: 当新建或选择会话时更新标题**

在 `onSelectSession` 回调中，session 选中后应更新 store 中的标题：

```typescript
onSelectSession={(id) => {
  const agentKey = selectedAgentId ?? "main";
  setActiveSessionId(agentKey, id);
  setHistorySheetOpen(false);
  // 更新最近会话标题（从 sessions 列表中找）
  const session = sessions.find(s => s.id === id);
  if (session) {
    const title = session.title ?? session.task ?? "";
    useAgentSessionsStore.getState().setRecentTitle(agentKey, title.slice(0, 18));
  }
}}
```

注意：这需要把 `sessions` 状态传到 onSelectSession 中，或者让 ConversationHistorySheet 在选中后返回 session 信息。

更简单的方案：让 ConversationHistorySheet 的 `onSelectSession` 接收完整 session 对象，或者在 MainContent 中处理（因为 MainContent 能访问 sessions）。

实际上更好的做法是：在 ConversationHistorySheet 的 `onSelectSession` 回调中直接传回 session 对象。

```typescript
// 修改 ConversationHistorySheet 的 onSelectSession 回调签名
// 传回完整 sessionItem 而不是只传 id
onSelectSession: (sessionId: string, session?: SessionItem) => void;
```

然后在 ContentList 中：

```typescript
onSelectSession={(id, session) => {
  const agentKey = selectedAgentId ?? "main";
  setActiveSessionId(agentKey, id);
  setHistorySheetOpen(false);
  if (session) {
    const raw = session.title ?? session.task ?? "";
    const title = raw.length > 18 ? raw.slice(0, 18) + "…" : raw;
    useAgentSessionsStore.getState().setRecentTitle(agentKey, title);
  }
}}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/ContentList.tsx
git commit -m "feat: ContentList reads session titles from agentSessionsStore, removes per-agent API calls"
```

---

## Task 5: 修改 ConversationHistorySheet — 传回 session 对象

**Files:**
- Modify: `frontend/src/components/chat/ConversationHistorySheet.tsx`

- [ ] **Step 1: 修改 onSelectSession 回调签名**

```typescript
// 旧:
onSelectSession: (sessionId: string) => void;

// 新:
onSelectSession: (sessionId: string, session?: SessionItem) => void;
```

- [ ] **Step 2: 修改 handleSelect 函数**

```typescript
const handleSelect = (session: SessionItem) => {
  onSelectSession(session.id, session);  // 传回完整 session
  onOpenChange(false);
};
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/chat/ConversationHistorySheet.tsx
git commit -m "feat: ConversationHistorySheet passes full session to onSelectSession callback"
```

---

## Task 6: 修改 MainContent — 传 per-agent sessionId 给各组件

**Files:**
- Modify: `frontend/src/components/layout/MainContent.tsx`

- [ ] **Step 1: 移除对 appStore activeBackendSessionId 的引用**

删除：
```typescript
const activeBackendSessionId = useAppStore((s) => s.activeBackendSessionId);
const setActiveBackendSessionId = useAppStore((s) => s.setActiveBackendSessionId);
```

- [ ] **Step 2: 使用 agentSessionsStore 获取当前 agent 的 session**

```typescript
import { useAgentSessionsStore } from "@/stores/agentSessionsStore";

// 在组件内:
const activeBackendSessionId = useAgentSessionsStore(
  (s) => s.activeBackendSessions[selectedAgentId ?? "main"] ?? null
);
```

- [ ] **Step 3: 修改 onSelectSession 传递给 ConversationHistorySheet 的回调**

当前代码：
```typescript
onSelectSession={(id) => {
  const agentKey = selectedAgentId ?? "main";
  savePersistedBackendSession(agentKey, id);
  setActiveBackendSessionId(id);
  setHistorySheetOpen(false);
}}
```

替换为使用 store：
```typescript
onSelectSession={(id, session) => {
  const agentKey = selectedAgentId ?? "main";
  setActiveSessionId(agentKey, id);
  setHistorySheetOpen(false);
  if (session) {
    const raw = session.title ?? session.task ?? "";
    const title = raw.length > 18 ? raw.slice(0, 18) + "…" : raw;
    useAgentSessionsStore.getState().setRecentTitle(agentKey, title);
  }
}}
```

- [ ] **Step 4: 传递给 ChatArea 的 sessionId 保持不变**

ChatArea 的 `sessionId` 已经是 per-agent 的（`selectedAgentId ?? "main"`），所以它会自动从新的 store 读取对应 agent 的 session。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/MainContent.tsx
git commit -m "feat: MainContent uses per-agent session from agentSessionsStore"
```

---

## Task 7: 端到端验证

**Files:**
- Test: Manual browser testing

- [ ] **Step 1: 启动应用**

```bash
cd frontend && npm run dev
```

- [ ] **Step 2: 验证场景**

1. **切换 Agent 会话独立**：
   - 选择 Agent A，发几条消息
   - 切换到 Agent B，发几条消息
   - 再切换回 Agent A — 应该看到 Agent A 的消息，而不是 Agent B 的

2. **历史会话列表 per-agent**：
   - 在 Agent A 打开历史会话列表 — 只显示 Agent A 的会话
   - 切换到 Agent B — 打开历史会话列表 — 只显示 Agent B 的会话

3. **会话标题独立**：
   - ContentList 左侧每个 Agent 的 subtitle 显示各自最近会话标题
   - 切换 Agent 后，subtitle 对应变化

4. **新建对话清理正确**：
   - Agent A 有活跃会话 → 点新建对话 → Agent A 的会话被清空，切换到 Agent B 不受影响

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: verify per-agent session isolation works correctly"
```

---

## Self-Review Checklist

1. **Spec coverage**: 每个设计缺陷都有对应任务覆盖
   - 全局 activeBackendSessionId → Task 1,2,3,6
   - ContentList 重复 API 调用 → Task 4
   - 历史会话列表串话 → Task 5,6
   - 新建会话清理不完整 → Task 3

2. **Placeholder scan**: 无 TBD/TODO，每个文件路径、函数名、变量名都明确

3. **Type consistency**: `SessionItem` 从 `frontend/src/types/api.ts` 导入，agentId 类型为 `string`，sessionId 类型为 `string | null`

---

## Execution Choice

**Plan complete and saved to `docs/superpowers/plans/2026-04-12-agent-session-per-agent.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
