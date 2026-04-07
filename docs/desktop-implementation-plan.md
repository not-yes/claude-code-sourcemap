# Claude Code 桌面端实现方案

**创建日期**: 2026-04-07 10:30:00
**最后更新**: 2026-04-07 10:30:00 (v1.0)
**状态**: [DRAFT] 草稿

---

## 方案概述

采用 **CLI 子进程** 方案：将 Claude Code CLI 作为子进程运行，Tauri Rust 后端通过 stdin/stdout 与其通信。

```
Tauri Desktop (Rust + React)
└── 运行 Claude Code CLI 作为子进程
    ├── stdin: 写入 prompt/命令
    ├── stdout: 读取 JSON/ANSI 输出
    └── 复用全部 1332 个 TS 文件，零改造
```

---

## 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Desktop App                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │   React UI  │◄──►│ Rust IPC    │◄──►│ CLI Process │  │
│  │  (前端)      │    │ Bridge       │    │ (子进程)     │  │
│  └─────────────┘    └─────────────┘    └─────────────┘  │
│         │                  │                  │         │
│         │           ┌──────┴──────┐            │         │
│         │           │ Claude CLI  │◄───────────┘         │
│         │           │ (零改造)    │                      │
│         │           └─────────────┘                      │
└─────────┴─────────────────────────────────────────────────┘
```

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | Tauri 2.x | 轻量 (~15MB)、安全 |
| 前端 | React + TypeScript | 现代化 UI |
| 后端 | Rust | 进程管理、IPC 桥接 |
| 核心逻辑 | Claude Code CLI | 子进程运行，零改造 |

---

## 工作分解

### Phase 1: 基础框架 (2 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| Tauri 项目初始化 | 创建 src-tauri + React 前端 | 2 天 |
| CLI 进程管理 | Rust Command 启动/通信/管理 CLI | 3 天 |
| IPC 桥接 | stdin/stdout ↔ Tauri EventEmitter | 3 天 |
| 基础 UI | 聊天窗口、消息展示 | 3 天 |
| 流式输出 | 支持 Claude 流式响应 | 2 天 |

### Phase 2: 功能完善 (2 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| 终端模拟 | 内嵌终端显示 CLI 输出 | 3 天 |
| 工具链集成 | 文件编辑、bash 等工具 IPC 化 | 5 天 |
| 会话管理 | 多会话、会话持久化 | 3 天 |
| 设置面板 | 主题、快捷键等配置 | 2 天 |

### Phase 3: 打包发布 (1 周)

| 任务 | 说明 | 工作量 |
|------|------|--------|
| 跨平台构建 | macOS (.dmg) / Linux (.AppImage) / Windows (.exe) | 3 天 |
| CI/CD 配置 | GitHub Actions 自动构建 | 2 天 |
| 安装器 | 桌面快捷方式、关联文件类型 | 2 天 |

---

## 总工作量

| 阶段 | 时间 |
|------|------|
| MVP | **4-5 周** |
| 功能完整版 | + 2 周 |
| 生产发布 | + 1 周 |

---

## 关键实现细节

### Rust IPC 桥接

```rust
// src-tauri/src/cli_manager.rs
use std::process::{Command, Stdio};
use serde::{Deserialize, Serialize};

pub struct CliProcess {
    child: Child,
}

impl CliProcess {
    pub fn new() -> Result<Self> {
        let mut child = Command::new("./claude")
            .args(["--output-format", "json-stream"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;

        Ok(Self { child })
    }

    pub fn send_message(&mut self, prompt: &str) -> Result<String> {
        let input = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "complete",
            "params": { "prompt": prompt }
        });

        writeln!(self.child.stdin.as_ref().unwrap(), "{}", input)?;
        let mut buffer = String::new();
        self.child.stdout.as_ref().unwrap().read_to_string(&mut buffer)?;
        Ok(buffer)
    }
}
```

### React 前端事件监听

```typescript
// src/components/ChatWindow.tsx
import { listen } from '@tauri-apps/api/event';

useEffect(() => {
  const unlisten = listen<AgentEvent>('agent-event', (event) => {
    switch (event.payload.type) {
      case 'stream': appendChunk(event.payload.content); break;
      case 'tool-use': showToolUse(event.payload.tool); break;
      case 'complete': setLoading(false); break;
    }
  });

  return () => { unlisten(); };
}, []);
```

---

## 优势

| 优势 | 说明 |
|------|------|
| **零改造** | CLI 源码不用动 |
| **功能完整** | 所有工具链、插件直接可用 |
| **维护简单** | Anthropic 更新 CLI，桌面端自动跟进 |
| **调试友好** | CLI 问题可在终端单独复现 |

## 劣势

| 劣势 | 说明 |
|------|------|
| **体积较大** | ~150MB (含完整 Node.js runtime) |
| **启动开销** | 子进程启动约 200ms |

---

## 替代方案对比

| 方案 | 工作量 | 体积 | CLI 改造 |
|------|--------|------|----------|
| **CLI 子进程** | **4-5 周** | ~150MB | **零改造** |
| Node.js Sidecar + JSON-RPC | 1.5-2 月 | ~80MB | 小改造 |
| Tauri + napi-rs | 3-6 月 | ~40MB | 完全重写 |

---

## 下一步行动

- [ ] Tauri 项目初始化
- [ ] CLI 子进程集成测试
- [ ] 基础 UI 原型开发
