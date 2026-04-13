import { useState, useCallback, useEffect, useRef } from "react";
import { getCronJobs, type CronJob } from "@/api/tauri-api";

export function useCronJobs() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCronJobs();
      if (!mountedRef.current) return;
      setJobs(data);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "加载失败");
      setJobs([]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { jobs, loading, error, reload: load };
}
