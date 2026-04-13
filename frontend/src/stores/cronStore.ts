import { create } from "zustand";
import { getCronJobs, listenCronComplete, type CronJob, type CronCompleteEvent } from "@/api/tauri-api";
import { toast } from "sonner";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface CronState {
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  handleCronComplete: (event: CronCompleteEvent) => void;
  initCronListener: () => Promise<UnlistenFn>;
}

/** 用于防竞态：记录最新一次 reload 调用的标识 */
let reloadSeq = 0;

export const useCronStore = create<CronState>((set, get) => ({
  jobs: [],
  loading: false,
  error: null,
  reload: async () => {
    const seq = ++reloadSeq;
    set({ loading: true, error: null });
    try {
      const data = await getCronJobs();
      if (seq !== reloadSeq) return;
      set({ jobs: data });
    } catch (e) {
      if (seq !== reloadSeq) return;
      set({
        error: e instanceof Error ? e.message : "加载失败",
        jobs: [],
      });
    } finally {
      // 只有当前序号未过期才清除 loading
      if (seq === reloadSeq) {
        set({ loading: false });
      }
    }
  },
  handleCronComplete: (event: CronCompleteEvent) => {
    const { jobs, reload } = get();
    const job = jobs.find((j) => j.id === event.jobId);
    if (job) {
      set({
        jobs: jobs.map((j) =>
          j.id === event.jobId
            ? {
                ...j,
                last_result: {
                  success: event.success,
                  output: event.output,
                  error: event.error ?? undefined,
                  duration_ms: event.duration_ms,
                },
                last_run: Math.floor(event.timestamp / 1000),
                run_count: j.run_count + 1,
              }
            : j
        ),
      });
    } else {
      console.log("[cronStore] 收到 cron-complete 事件，但未找到对应 job", event);
      // 未找到 job 时仍然触发 reload 以同步最新状态
      void reload();
    }

    // Toast 通知
    if (event.success) {
      toast.success(`定时任务「${event.jobName}」执行成功`);
    } else {
      toast.error(`定时任务「${event.jobName}」执行失败: ${event.error ?? "未知错误"}`);
    }
  },
  initCronListener: async () => {
    const { handleCronComplete } = get();
    return listenCronComplete(handleCronComplete);
  },
}));
