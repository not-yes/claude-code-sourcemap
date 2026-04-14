import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export interface CronTimePickerProps {
  value: string;
  onChange: (cron: string) => void;
}

/**
 * Cron 时间选择器组件
 * 
 * 将手动输入 cron 表达式改为可视化选择，避免格式错误
 * 支持常用调度模式：每天、每周、每月、每小时等
 */
export function CronTimePicker({ value, onChange }: CronTimePickerProps) {
  // 解析 cron 表达式
  const parseCron = (cron: string) => {
    const parts = cron.trim().split(/\s+/);
    if (parts.length === 5) {
      return {
        minute: parts[0] || "*",
        hour: parts[1] || "*",
        dayOfMonth: parts[2] || "*",
        month: parts[3] || "*",
        dayOfWeek: parts[4] || "*",
      };
    }
    return {
      minute: "*",
      hour: "*",
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    };
  };

  const parsed = parseCron(value);
  
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly" | "hourly" | "custom">("daily");
  const [hour, setHour] = useState(parsed.hour === "*" ? "10" : parsed.hour);
  const [minute, setMinute] = useState(parsed.minute === "*" ? "0" : parsed.minute);
  const [weekDays, setWeekDays] = useState<string[]>(
    parsed.dayOfWeek === "*" ? [] : parsed.dayOfWeek.split(",")
  );
  const [dayOfMonth, setDayOfMonth] = useState(parsed.dayOfMonth === "*" ? "1" : parsed.dayOfMonth);
  
  // 使用 ref 跟踪是否已经初始化，避免 useEffect 中的 setState
  const isInitialized = useRef(false);

  // 当 value 从外部改变时，重新解析
  useEffect(() => {
    // 跳过首次渲染，避免与初始 state 冲突
    if (!isInitialized.current) {
      isInitialized.current = true;
      return;
    }

    const p = parseCron(value);
    if (p.hour !== "*" && p.minute !== "*" && p.dayOfMonth === "*" && p.month === "*" && p.dayOfWeek === "*") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFrequency("daily");
      setHour(p.hour);
      setMinute(p.minute);
    } else if (p.dayOfWeek !== "*") {
      setFrequency("weekly");
      setHour(p.hour === "*" ? "10" : p.hour);
      setMinute(p.minute === "*" ? "0" : p.minute);
      setWeekDays(p.dayOfWeek.split(","));
    } else if (p.dayOfMonth !== "*") {
      setFrequency("monthly");
      setHour(p.hour === "*" ? "10" : p.hour);
      setMinute(p.minute === "*" ? "0" : p.minute);
      setDayOfMonth(p.dayOfMonth);
    } else if (p.hour === "*" && p.minute.startsWith("*/")) {
      setFrequency("hourly");
    } else {
      setFrequency("custom");
    }
  }, [value]);

  // 构建 cron 表达式
  const buildCron = (freq: string, h: string, m: string, days: string[], dom: string) => {
    switch (freq) {
      case "daily":
        return `${m} ${h} * * *`;
      case "weekly":
        return `${m} ${h} * * ${days.length > 0 ? days.join(",") : "*"}`;
      case "monthly":
        return `${m} ${h} ${dom} * *`;
      case "hourly":
        return `*/${m} * * * *`;
      default:
        return value; // 自定义模式保持不变
    }
  };

  const handleFrequencyChange = (freq: "daily" | "weekly" | "monthly" | "hourly" | "custom") => {
    setFrequency(freq);
    const newCron = buildCron(freq, hour, minute, weekDays, dayOfMonth);
    onChange(newCron);
  };

  const handleTimeChange = (h: string, m: string) => {
    setHour(h);
    setMinute(m);
    const newCron = buildCron(frequency, h, m, weekDays, dayOfMonth);
    onChange(newCron);
  };

  const toggleWeekDay = (day: string) => {
    const newDays = weekDays.includes(day)
      ? weekDays.filter((d) => d !== day)
      : [...weekDays, day];
    setWeekDays(newDays);
    const newCron = buildCron(frequency, hour, minute, newDays, dayOfMonth);
    onChange(newCron);
  };

  const weekDayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  return (
    <div className="space-y-4">
      {/* 频率选择 */}
      <div>
        <label className="text-sm font-medium text-foreground">执行频率</label>
        <Select value={frequency} onValueChange={handleFrequencyChange}>
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="选择频率" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="daily">每天</SelectItem>
            <SelectItem value="weekly">每周</SelectItem>
            <SelectItem value="monthly">每月</SelectItem>
            <SelectItem value="hourly">每小时</SelectItem>
            <SelectItem value="custom">自定义（高级）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 每天/每月 - 时间选择 */}
      {(frequency === "daily" || frequency === "monthly") && (
        <div>
          <label className="text-sm font-medium text-foreground">执行时间</label>
          <div className="flex items-center gap-2 mt-1">
            <Select value={hour} onValueChange={(h) => handleTimeChange(h, minute)}>
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {i.toString().padStart(2, "0")} 时
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-lg font-bold">:</span>
            <Select value={minute} onValueChange={(m) => handleTimeChange(hour, m)}>
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["0", "5", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.padStart(2, "0")} 分
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* 每周 - 星期选择 */}
      {frequency === "weekly" && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">选择星期</label>
          <div className="flex flex-wrap gap-2 mt-1">
            {weekDayNames.map((name, index) => {
              const day = index.toString();
              const isSelected = weekDays.includes(day);
              return (
                <div key={day} className="flex items-center gap-1">
                  <Checkbox
                    id={`weekday-${day}`}
                    checked={isSelected}
                    onCheckedChange={() => toggleWeekDay(day)}
                  />
                  <label
                    htmlFor={`weekday-${day}`}
                    className="text-sm cursor-pointer select-none"
                  >
                    {name}
                  </label>
                </div>
              );
            })}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Select value={hour} onValueChange={(h) => handleTimeChange(h, minute)}>
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {i.toString().padStart(2, "0")} 时
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-lg font-bold">:</span>
            <Select value={minute} onValueChange={(m) => handleTimeChange(hour, m)}>
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["0", "5", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.padStart(2, "0")} 分
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* 每月 - 日期选择 */}
      {frequency === "monthly" && (
        <div>
          <label className="text-sm font-medium text-foreground">每月几号</label>
          <Select value={dayOfMonth} onValueChange={(dom) => {
            setDayOfMonth(dom);
            onChange(buildCron(frequency, hour, minute, weekDays, dom));
          }}>
            <SelectTrigger className="mt-1 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <SelectItem key={d} value={d.toString()}>
                  {d} 号
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 每小时 - 间隔选择 */}
      {frequency === "hourly" && (
        <div>
          <label className="text-sm font-medium text-foreground">间隔分钟数</label>
          <Select value={minute} onValueChange={(m) => handleTimeChange(hour, m)}>
            <SelectTrigger className="mt-1 w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[
                { label: "每 5 分钟", value: "5" },
                { label: "每 10 分钟", value: "10" },
                { label: "每 15 分钟", value: "15" },
                { label: "每 20 分钟", value: "20" },
                { label: "每 30 分钟", value: "30" },
              ].map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 高级模式 - 手动输入 */}
      {frequency === "custom" && (
        <div>
          <label className="text-sm font-medium text-foreground">Cron 表达式</label>
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="分 时 日 月 周，例如: 10 10 * * *"
            className="mt-1 font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            格式：分钟(0-59) 小时(0-23) 日(1-31) 月(1-12) 星期(0-6)
          </p>
        </div>
      )}

      {/* 预览 */}
      <div className="rounded-md bg-muted/50 p-3">
        <p className="text-xs text-muted-foreground mb-1">生成的 Cron 表达式：</p>
        <code className="text-sm font-mono font-bold text-foreground">{value}</code>
      </div>
    </div>
  );
}
