import { describe, it, expect } from "vitest";
// buildAgentEventName 是纯函数，不依赖 Tauri runtime，直接导入
import { buildAgentEventName } from "@/api/tauri-api";

describe("buildAgentEventName", () => {
  it("应使用 agentId 构建事件名", () => {
    expect(buildAgentEventName("agent-1", "stream:abc")).toBe("agent:agent-1:stream:abc");
  });

  it("agentId 为 undefined 时应默认 main", () => {
    expect(buildAgentEventName(undefined, "stream:abc")).toBe("agent:main:stream:abc");
  });

  it("agentId 为 main 时应正常工作", () => {
    expect(buildAgentEventName("main", "permission-request")).toBe("agent:main:permission-request");
  });

  it("应处理复杂事件名", () => {
    expect(buildAgentEventName("agent-2", "checkpoint:events:session-123"))
      .toBe("agent:agent-2:checkpoint:events:session-123");
  });

  it("应处理空字符串 agentId", () => {
    expect(buildAgentEventName("", "stream:abc")).toBe("agent:main:stream:abc");
  });

  it("应处理流式事件名格式 stream:{streamId}", () => {
    const streamId = "550e8400-e29b-41d4-a716-446655440000";
    expect(buildAgentEventName("main", `stream:${streamId}`))
      .toBe(`agent:main:stream:${streamId}`);
  });

  it("应处理 done 事件名格式 stream:{streamId}:done", () => {
    const streamId = "abc-123";
    expect(buildAgentEventName("agent-1", `stream:${streamId}:done`))
      .toBe(`agent:agent-1:stream:${streamId}:done`);
  });

  it("应处理 cron-complete 事件名", () => {
    expect(buildAgentEventName("main", "cron-complete"))
      .toBe("agent:main:cron-complete");
  });

  it("应处理 checkpoint:events 事件名", () => {
    expect(buildAgentEventName("agent-2", "checkpoint:events"))
      .toBe("agent:agent-2:checkpoint:events");
  });
});
