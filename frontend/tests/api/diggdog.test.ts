import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  execute,
  getStats,
  getHealth,
  listCheckpoints,
  saveCheckpoint,
} from "@/api/diggdog";

describe("diggdog API", () => {
  beforeEach(() => {
    vi.stubGlobal("import.meta", {
      env: { DEV: true, VITE_DIGGDOG_URL: undefined },
    });
  });

  it("execute returns text on success", async () => {
    const mockRes = { ok: true, text: () => Promise.resolve("Hello") };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRes));

    const result = await execute("hello");
    expect(result).toBe("Hello");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/execute$/),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "hello", platform: "http" }),
      })
    );
  });

  it("execute appends session_id query when agentId provided", async () => {
    const mockRes = { ok: true, text: () => Promise.resolve("ok") };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRes));

    await execute("task", { agentId: "my-agent" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/execute\?session_id=my-agent$/),
      expect.objectContaining({
        body: JSON.stringify({
          content: "task",
          platform: "http",
          session_id: "my-agent",
        }),
      })
    );
  });

  it("execute throws on failure", async () => {
    const mockRes = {
      ok: false,
      text: () =>
        Promise.resolve(
          JSON.stringify({ success: false, error: { code: "ERR", message: "Bad request" } })
        ),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRes));

    await expect(execute("x")).rejects.toThrow("Bad request");
  });

  it("getStats returns data from unified response", async () => {
    const data = { total_calls: 10 };
    const mockRes = {
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ success: true, data })),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockRes));

    const result = await getStats();
    expect(result).toEqual(data);
  });

  it("getHealth returns true when ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const result = await getHealth();
    expect(result).toBe(true);
  });

  it("listCheckpoints parses unified list response", async () => {
    const payload = {
      success: true,
      data: [
        {
          id: "cp-1",
          created_at: "2025-01-01T00:00:00Z",
          step: 1,
          tags: ["t"],
          size_bytes: 10,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(payload)),
      })
    );

    const list = await listCheckpoints({ sessionId: "sess-a", limit: 20 });
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("cp-1");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("session_id=sess-a"),
      expect.any(Object)
    );
  });

  it("saveCheckpoint sends tag and optional comment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              success: true,
              data: { checkpoint_id: "x", tag: "v1", step: 2 },
            })
          ),
      })
    );

    const r = await saveCheckpoint({
      sessionId: "s1",
      tag: "v1",
      comment: "note",
    });
    expect(r.checkpoint_id).toBe("x");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/checkpoints"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          session_id: "s1",
          tag: "v1",
          comment: "note",
        }),
      })
    );
  });
});
