
export interface MemoryMetrics {
  heapUsedMB: number | null;       // JS heap used (MB)
  heapTotalMB: number | null;      // JS heap total (MB)
  localStorageUsedKB: number;      // localStorage usage estimate (KB)
  activeStreams: number;            // current active stream count (always 0, limit removed)
}

export function getMemoryMetrics(): MemoryMetrics {
  // Heap memory (Chrome/WebView only)
  let heapUsedMB: number | null = null;
  let heapTotalMB: number | null = null;
  interface PerformanceWithMemory extends Performance {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number };
  }
  const perf = performance as PerformanceWithMemory;
  if (perf.memory) {
    heapUsedMB = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024 * 10) / 10;
    heapTotalMB = Math.round(perf.memory.totalJSHeapSize / 1024 / 1024 * 10) / 10;
  }

  // localStorage usage estimate
  let localStorageUsedKB = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        localStorageUsedKB += (key.length + (value?.length || 0)) * 2; // UTF-16
      }
    }
    localStorageUsedKB = Math.round(localStorageUsedKB / 1024 * 10) / 10;
  } catch { /* ignore */ }

  return {
    heapUsedMB,
    heapTotalMB,
    localStorageUsedKB,
    activeStreams: 0,  // concurrent stream limit removed, backend controls concurrency
  };
}

// Format for display
export function formatMemoryMetrics(m: MemoryMetrics): string {
  const parts: string[] = [];
  if (m.heapUsedMB !== null) {
    parts.push(`Heap: ${m.heapUsedMB}/${m.heapTotalMB}MB`);
  }
  parts.push(`Storage: ${m.localStorageUsedKB}KB`);
  parts.push(`Streams: ${m.activeStreams}`);
  return parts.join(' | ');
}
