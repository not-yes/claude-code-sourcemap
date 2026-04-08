# AGENTS.md

This file provides guidance to AI coding agents (such as Qoder) when working with code in this repository.

## Project Overview

This repository contains a **desktop application built on top of the Claude Code source code**. It extends the original CLI-focused `claude-desktop` project into a Tauri-based desktop app with a React frontend, a Rust backend, and a Bun-powered sidecar process.

The system is organized into three main layers:

1. **React Frontend** (`frontend/`): Desktop UI built with React 19, TypeScript, Tailwind CSS, and shadcn/ui, running inside a Tauri 2.x WebView.
2. **Rust Backend** (`frontend/src-tauri/`): Tauri Rust application responsible for window/runner lifecycle, spawning and supervising the Bun sidecar, and bridging IPC between frontend and sidecar.
3. **Bun Sidecar (Claude Code)** (`claude-code/`): A modified Claude Code TypeScript codebase running as a Bun process. It exposes JSON-RPC 2.0 over stdin/stdout and implements the core assistant/agent/tooling logic.

The goal of this document is to help agents quickly understand how these pieces fit together and where to make changes for different types of tasks (UI, IPC, tools, session management, etc.).

## Architecture

### High-Level Layers

- **React Frontend (Tauri WebView)**
  - Renders the desktop UI, sessions, checkpoints, tools, and settings.
  - Talks to the Rust backend exclusively via `tauri.invoke` and Tauri events.

- **Rust Backend (Tauri Core + IPC Bridge)**
  - Implements Tauri commands invoked from the frontend.
  - Manages the Bun sidecar process (spawn, restart, shutdown).
  - Bridges JSON-RPC 2.0 requests/responses/notifications between the frontend and the Bun sidecar.
  - Emits Tauri events for streaming updates back to the frontend.

- **Bun Sidecar (Claude Code Runtime)**
  - Runs the Claude Code TypeScript runtime using Bun.
  - Exposes a JSON-RPC 2.0 API over stdin/stdout.
  - Implements tools, agent coordination, sessions, checkpoints, permissions, and skills.

### Communication Flow

**Request path (non-streaming and streaming alike):**

1. **React Frontend** calls a function in [`tauri-api.ts`](file:///Users/wangke/Documents/Program/Claude/frontend/src/api/tauri-api.ts).
2. `tauri-api.ts` uses `@tauri-apps/api` to **invoke a Tauri command** in the Rust backend.
3. **Rust Backend** Tauri command handler constructs a JSON-RPC 2.0 request and writes it to the Bun sidecar process via stdin.
4. **Bun Sidecar** (Claude Code) handles the request, runs tools/agents, and sends JSON-RPC responses and/or notifications back via stdout.
5. **Rust IPC Bridge** parses the JSON-RPC messages and either
   - resolves the original Tauri command (for request/response style calls), or
   - forwards notifications as Tauri events.
6. **React Frontend** listens for Tauri events and updates UI/state (streams, progress, logs, etc.).

**Streaming path:**

- Sidecar emits **JSON-RPC notifications** on stdout as tokens/updates become available.
- Rust IPC bridge receives these notifications and uses **Tauri`s event system** to emit structured events.
- Frontend hooks/stores subscribe to these events and update UI progressively (e.g., streaming assistant responses, tool output, or progress updates).

## Key File Locations

### Frontend (React + Tauri API)

- Entry point: [`frontend/src/main.tsx`](file:///Users/wangke/Documents/Program/Claude/frontend/src/main.tsx)
- Root application component: [`frontend/src/App.tsx`](file:///Users/wangke/Documents/Program/Claude/frontend/src/App.tsx)
- **Tauri API layer (core integration point, ~800+ lines):**
  - [`frontend/src/api/tauri-api.ts`](file:///Users/wangke/Documents/Program/Claude/frontend/src/api/tauri-api.ts)
    - Central place where the frontend invokes Tauri commands and handles responses/events.
    - Most cross-layer behavior starts here.
- Hooks: [`frontend/src/hooks/`](file:///Users/wangke/Documents/Program/Claude/frontend/src/hooks/)
  - React hooks for data fetching, streaming updates, UI state, and integration with stores.
- Stores: [`frontend/src/stores/`](file:///Users/wangke/Documents/Program/Claude/frontend/src/stores/)
  - Zustand stores for sessions, UI state, configuration, logs, etc.
- Components: [`frontend/src/components/`](file:///Users/wangke/Documents/Program/Claude/frontend/src/components/)
  - Reusable UI components and feature-specific views.

### Rust Backend (Tauri + IPC Bridge)

- Tauri entry point: [`frontend/src-tauri/src/main.rs`](file:///Users/wangke/Documents/Program/Claude/frontend/src-tauri/src/main.rs)
  - Application setup, command registration, and window configuration.
- IPC bridge and types:
  - [`frontend/src-tauri/src/ipc/bridge.rs`](file:///Users/wangke/Documents/Program/Claude/frontend/src-tauri/src/ipc/bridge.rs)
  - [`frontend/src-tauri/src/ipc/types.rs`](file:///Users/wangke/Documents/Program/Claude/frontend/src-tauri/src/ipc/types.rs)
- Tauri configuration:
  - [`frontend/src-tauri/tauri.conf.json`](file:///Users/wangke/Documents/Program/Claude/frontend/src-tauri/tauri.conf.json)
  - [`frontend/src-tauri/Cargo.toml`](file:///Users/wangke/Documents/Program/Claude/frontend/src-tauri/Cargo.toml)

### Bun Sidecar (Claude Code)

- Main source root: [`claude-code/src/`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/)
- CLI / runtime entrypoint: [`claude-code/src/main.tsx`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/main.tsx)
- Tool system:
  - Tool definitions and registry: [`claude-code/src/tools.ts`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/tools.ts)
  - Individual tool implementations: [`claude-code/src/tools/`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/tools/)
- Services layer: [`claude-code/src/services/`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/services/)
- Sidecar-specific logic: [`claude-code/src/sidecar/`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/sidecar/)
- High-level engine & task orchestration:
  - [`claude-code/src/QueryEngine.ts`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/QueryEngine.ts)
  - [`claude-code/src/Task.ts`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/Task.ts)
  - [`claude-code/src/Tool.ts`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/Tool.ts)

### Documentation

- Desktop implementation plan: [`docs/desktop-implementation-plan.md`](file:///Users/wangke/Documents/Program/Claude/docs/desktop-implementation-plan.md)

## Tech Stack

### Frontend

- **Framework:** React 19 + TypeScript
- **Runtime / Shell:** Tauri 2.x (WebView-based desktop container)
- **Styling:** Tailwind CSS, tailwind-merge, tailwindcss-animate
- **UI Components:** shadcn/ui (Radix UI primitives: dialog, popover, dropdown, select, etc.)
- **State Management:** Zustand
- **Routing:** react-router-dom
- **Markdown Rendering:** react-markdown + remark-gfm

### Rust Backend

- **Language:** Rust
- **Async runtime:** tokio
- **Tauri:** `@tauri-apps/cli` 2.x, Tauri 2.x Rust crates
- **Responsibilities:** window lifecycle, command dispatch, spawning the Bun sidecar, JSON-RPC bridging, event emission.

### Bun Sidecar (Claude Code)

- **Runtime:** Bun
- **Language:** TypeScript (module type: `module`)
- **Build:** `bun scripts/build.ts` and `bun build --compile` for producing a single executable.
- **CLI / Dev scripts:** defined in [`claude-code/package.json`](file:///Users/wangke/Documents/Program/Claude/claude-code/package.json)
  - `bun run dev` – development entrypoint for Claude Code CLI/sidecar
  - `bun run build` – build Claude Code
  - `bun run debug` – debug mode

### Cross-Cutting

- **IPC Protocol:** JSON-RPC 2.0 (stdin/stdout between Rust and Bun)
- **Validation:** Zod schemas in the Claude Code codebase
- **Testing (where present):** Vitest / bun test (depending on package)

## Directory Structure

High-level directories relevant to agents:

- [`frontend/`](file:///Users/wangke/Documents/Program/Claude/frontend/)
  - `src/main.tsx` – React entry for Tauri WebView
  - `src/App.tsx` – root app component
  - `src/api/` – Tauri API wrapper(s), especially `tauri-api.ts`
  - `src/hooks/` – custom hooks (streaming, IPC, UI behavior)
  - `src/stores/` – Zustand stores (sessions, UI state, config, logs)
  - `src/components/` – UI components and layout
  - `src-tauri/` – Rust Tauri project (see below)

- [`frontend/src-tauri/`](file:///Users/wangke/Documents/Program/Claude/frontend/src-tauri/)
  - `src/main.rs` – Tauri Rust entrypoint
  - `src/ipc/bridge.rs` – process and IPC bridge for Bun sidecar
  - `src/ipc/types.rs` – shared IPC types, JSON-RPC message structs
  - `tauri.conf.json` – Tauri configuration
  - `Cargo.toml` – Rust project configuration and dependencies

- [`claude-code/`](file:///Users/wangke/Documents/Program/Claude/claude-code/)
  - `src/main.tsx` – primary CLI / runtime entrypoint
  - `src/tools/` – individual tools
  - `src/services/` – API, MCP, telemetry, LSP, etc.
  - `src/sidecar/` – sidecar-related abstractions
  - `src/assistant/`, `src/commands/`, `src/utils/`, etc. – core Claude Code logic
  - `package.json` – scripts, dependencies, and Bun tooling

- [`docs/`](file:///Users/wangke/Documents/Program/Claude/docs/)
  - `desktop-implementation-plan.md` – design and implementation notes for the desktop integration
  - Other documents for architecture and telemetry of Claude Code itself.

## Important Patterns

### 1. Three-Layer Separation

- **Frontend** should not talk directly to the Bun sidecar or use Node/Bun APIs.
- All cross-process communication must go through:
  - Frontend → `tauri-api.ts` → Tauri invoke → Rust commands → JSON-RPC → Bun sidecar.
- When introducing new functionality, keep this separation clear:
  - Frontend: UI, UX, local state only.
  - Rust: process management, IPC, validation/sanitization as needed.
  - Bun/Claude Code: core assistant logic, tools, agents, sessions.

### 2. JSON-RPC 2.0 Contract

- Rust and Bun communicate using JSON-RPC 2.0 over stdin/stdout.
- Requests/responses/notifications must preserve the standard fields: `jsonrpc`, `id`, `method`, `params`.
- When adding new methods:
  - Define the method name and schema on the Bun side (using Zod where appropriate).
  - Update the Rust IPC bridge/types to mirror the contract.
  - Add or update frontend API methods in `tauri-api.ts` and any related hooks/stores.

### 3. Streaming via Notifications + Events

- Streaming is implemented using **JSON-RPC notifications** from the sidecar and **Tauri events** to the frontend.
- When implementing new streaming behaviors:
  - Emit notifications from Claude Code (Bun) with clear, typed payloads.
  - Ensure Rust bridge maps them to Tauri events with stable event names.
  - Frontend should subscribe via hooks or stores and update UI incrementally.

### 4. Tool Implementation Pattern (Claude Code)

For tools in [`claude-code/src/tools/`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/tools/), the pattern generally follows the original Claude Code structure:

- Each tool directory typically contains:
  - `ToolName.ts` – main tool implementation
  - `UI.tsx` – Ink UI component (used in CLI contexts)
  - `prompt.ts` – tool description and prompt snippets
  - `constants.ts` – tool name and constants
- Tools are registered and exposed via the central tools registry in [`claude-code/src/tools.ts`](file:///Users/wangke/Documents/Program/Claude/claude-code/src/tools.ts).

### 5. Session, Agents, Permissions, Skills, Cron

Core functional areas (implemented inside `claude-code/src/`):

- **Session management & checkpoints** – stored and manipulated via session-related services and tasks.
- **Agents / multi-agent coordination** – coordinator/assistant logic and agent tools.
- **Permissions** – permission prompts and policy enforcement before running certain tools.
- **Skills** – skill-based extension mechanism to add capabilities or workflows.
- **Cron / scheduled jobs** – task scheduling for recurring or delayed operations.

When changing these behaviors, prefer modifying Claude Code services and tools rather than hacking around them from the frontend.

### 6. Dual Mode: CLI vs Sidecar

Claude Code can run in two main modes:

- **CLI mode (development / standalone):**
  - Run via Bun using scripts in [`claude-code/package.json`](file:///Users/wangke/Documents/Program/Claude/claude-code/package.json) (e.g., `bun run dev`).
  - Primarily used during development and debugging outside of Tauri.

- **Sidecar mode (desktop packaging):**
  - Enabled via a build-time flag, e.g.:
    - `bun build --define 'process.env.SIDECAR_MODE="true"' ...`
  - In this mode, Claude Code runs as a sidecar process controlled by the Rust backend and communicates only via JSON-RPC.

When adding features, ensure they behave correctly in both modes or are explicitly guarded by feature flags / environment checks.

## Development Workflow

### Frontend + Tauri

From [`frontend/`](file:///Users/wangke/Documents/Program/Claude/frontend/):

- `pnpm dev` / `npm run dev` / `yarn dev` (depending on your package manager) – start Vite dev server and Tauri in dev mode.
- `pnpm build` / `npm run build` – type-check and build the frontend for production.
- `pnpm tauri` / `npm run tauri` – run Tauri-specific commands (dev, build, etc.).
- `pnpm test` / `npm run test` – run Vitest tests for the frontend (where present).

(Use the appropriate package manager for your environment; the lockfiles include `pnpm-lock.yaml`, `package-lock.json`, and `bun.lock`.)

### Claude Code / Bun Sidecar

From [`claude-code/`](file:///Users/wangke/Documents/Program/Claude/claude-code/):

- `bun run dev` – run the Claude Code dev entrypoint (CLI / sidecar).
- `bun run debug` – run in debug mode.
- `bun run build` – build the project.
- `bun run test` – run Bun tests.
- `bun run lint` / `bun run lint:fix` – lint the TypeScript source.

### Typical Change Flows

- **Frontend-only change (UI, state, routing):**
  - Modify React components/hooks/stores under `frontend/src/`.
  - If you need new backend data, first expose it via `tauri-api.ts` and then wire it into hooks/stores.

- **Add a new JSON-RPC method:**
  1. Define the method and schema on the Claude Code side (tool/service/task).
  2. Update Rust IPC types and bridge logic to handle the new method.
  3. Add a corresponding function in `tauri-api.ts`.
  4. Use it from frontend hooks/stores/components.

- **Add or modify a tool/agent behavior:**
  - Work under `claude-code/src/tools/`, `claude-code/src/assistant/`, `claude-code/src/services/`, or related engine files.

## Notes / Caveats

- **Do not bypass Tauri IPC:**
  - Frontend code must not attempt to spawn processes or access filesystem/network directly; always go through the Rust backend and tools.

- **Sidecar lifecycle is critical:**
  - Changes to Rust IPC bridge or sidecar spawn logic can break the whole app. Be conservative and keep behavior backwards-compatible when possible.

- **Keep JSON-RPC contracts in sync:**
  - Any change in method names, params, or payloads must be reflected across **Bun (Claude Code)**, **Rust IPC bridge**, and **frontend `tauri-api.ts`**.

- **Streaming assumptions:**
  - Frontend UI may assume that certain operations emit streaming events; if you change streaming behavior, update listeners and UI expectations.

- **Existing Claude Code docs still apply:**
  - Many internal patterns (tools, services, feature flags) mirror the original Claude Code project. When in doubt, follow existing conventions in `claude-code/src/`.

- **Be explicit about modes:**
  - When introducing new behavior, consider whether it should run in CLI mode, sidecar mode, or both, and gate it accordingly.

This document should give you enough context to quickly locate relevant code and implement changes safely across the React frontend, Rust backend, and Bun sidecar.