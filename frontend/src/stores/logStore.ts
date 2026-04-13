import { create } from "zustand";

export interface LogEntry {
  time: string;
  type: "error" | "info";
  message: string;
}

interface LogState {
  entries: LogEntry[];
  addError: (message: string) => void;
  addInfo: (message: string) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  entries: [],
  addError: (message) =>
    set((s) => ({
      entries: [
        ...s.entries.slice(-100),
        {
          time: new Date().toLocaleTimeString("zh-CN"),
          type: "error" as const,
          message,
        },
      ].slice(-100),
    })),
  addInfo: (message) =>
    set((s) => ({
      entries: [
        ...s.entries.slice(-100),
        {
          time: new Date().toLocaleTimeString("zh-CN"),
          type: "info" as const,
          message,
        },
      ].slice(-100),
    })),
  clear: () => set({ entries: [] }),
}));
