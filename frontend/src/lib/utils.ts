import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 检测是否在 Tauri 桌面端运行（v1 或 v2） */
export function checkIsTauri(): boolean {
  if (typeof window === "undefined") return false
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }
  return w.__TAURI__ !== undefined || w.__TAURI_INTERNALS__ !== undefined
}
