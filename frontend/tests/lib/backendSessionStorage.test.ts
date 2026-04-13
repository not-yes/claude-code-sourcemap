import { describe, it, expect, beforeEach } from "vitest";
import {
  loadPersistedBackendSession,
  savePersistedBackendSession,
} from "@/lib/backendSessionStorage";

describe("backendSessionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when unset", () => {
    expect(loadPersistedBackendSession("main")).toBeNull();
  });

  it("round-trips session id per agent key", () => {
    savePersistedBackendSession("main", "sess-uuid-1");
    expect(loadPersistedBackendSession("main")).toBe("sess-uuid-1");
    expect(loadPersistedBackendSession("other")).toBeNull();
  });

  it("clear removes key", () => {
    savePersistedBackendSession("a", "x");
    savePersistedBackendSession("a", null);
    expect(loadPersistedBackendSession("a")).toBeNull();
  });
});
