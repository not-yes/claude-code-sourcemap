# AGENTS.md

This file provides guidance to Qoder (qoder.com) when working with code in this repository.

## Project Overview

This is **restored TypeScript source code** from the `@anthropic-ai/claude-code` npm package (version 2.1.88), reconstructed via source map analysis. It is for research purposes only and does not represent the original internal development repository structure.

## Key Architecture

### Entry Point
- `restored-src/src/main.tsx` - CLI entry point, handles argument parsing (Commander.js), initialization, and routes to interactive REPL or headless mode

### Core Components

**Query Engine** (`restored-src/src/QueryEngine.ts`)
- Main loop for processing user queries
- Manages conversation state, tool calls, and API interactions
- Handles message accumulation and context compaction

**Tool System** (`restored-src/src/Tool.ts`, `restored-src/src/tools.ts`)
- All tools implement a common interface with `name`, `prompt`, `inputSchema`
- Tools have permission checks, progress tracking, and result handling

**Tools Directory** (`restored-src/src/tools/`)
30+ built-in tools including:
- `BashTool/` - Shell command execution with sandboxing and permission validation
- `FileEditTool/`, `FileReadTool/`, `FileWriteTool/` - File operations
- `GlobTool/`, `GrepTool/` - File searching
- `AgentTool/` - Subagent spawning and management (built-in agents: explore, plan, verification)
- `MCPTool/` - Model Context Protocol tool execution
- `AskUserQuestionTool/` - Interactive prompts
- `LSPTool/` - Language Server Protocol integration

### Services (`restored-src/src/services/`)

- `api/` - Claude API client, streaming, error handling, retry logic
- `mcp/` - MCP server management, connections, authentication
- `analytics/` - Telemetry and feature flags (GrowthBook)
- `lsp/` - Language server management
- `compact/` - Context compaction strategies

### Commands (`restored-src/src/commands/`)
40+ CLI subcommands (e.g., `mcp`, `plugin`, `auth`, `doctor`, `resume`, `config`)

### State Management
- `restored-src/src/bootstrap/state.ts` - Global application state
- `restored-src/src/state/` - React-style state store

### Utils (`restored-src/src/utils/`)
300+ utility files covering:
- `permissions/` - Permission modes and validation
- `settings/` - Configuration management
- `model/` - Model string parsing and capabilities
- `auth.js` - Authentication handling

## Important Patterns

### Tool Implementation Pattern
Each tool follows this structure:
```
ToolName/
  ├── ToolName.ts      # Main implementation
  ├── UI.tsx           # React/Ink UI component
  ├── prompt.ts        # Tool description for LLM
  └── constants.ts     # Tool name and constants
```

### Feature Flags
Feature flags are accessed via `feature('FLAG_NAME')` from `bun:bundle`. Key flags:
- `COORDINATOR_MODE` - Multi-agent coordination
- `KAIROS` - Assistant mode
- `DIRECT_CONNECT` - Direct server connection
- `SSH_REMOTE` - SSH session support

### Bundled Dependencies
The package includes vendored binaries:
- `package/vendor/ripgrep/` - ripgrep binary for file search
- `package/vendor/audio-capture/` - Native audio capture modules

## Notes

- This is restored source code, not a development repository - no build/test/lint commands exist
- Uses React/Ink for terminal UI components
- Uses Zod for schema validation
- Built with Bun bundler (single-file executable output)
