import { useMemo, useState } from "react";
import { ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SkillItem } from "@/hooks/useSkills";

export function AgentSkillsMultiSelect({
  options,
  value,
  onChange,
  disabled,
  loading,
  error,
}: {
  options: SkillItem[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const optionNames = useMemo(
    () => new Set(options.map((o) => o.name)),
    [options]
  );
  const optionMap = useMemo(() => {
    const m = new Map<string, SkillItem>();
    for (const o of options) m.set(o.name, o);
    return m;
  }, [options]);

  const toggle = (name: string, checked: boolean) => {
    if (checked && !value.includes(name)) {
      onChange([...value, name].sort((a, b) => a.localeCompare(b)));
    } else if (!checked) {
      onChange(value.filter((x) => x !== name));
    }
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled || loading}
            className="h-10 w-full justify-between px-3 font-normal shadow-none"
          >
            <span
              className={cn(
                "truncate text-left",
                value.length === 0 && !loading && "text-muted-foreground"
              )}
            >
              {loading
                ? "加载技能列表…"
                : value.length === 0
                  ? "选择 Skills…"
                  : `已选择 ${value.length} 个 skills`}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="min-w-[16rem] w-[var(--radix-popover-trigger-width)] max-w-[min(100vw-2rem,36rem)] p-0"
          align="start"
        >
          <div className="max-h-[min(20rem,50vh)] overflow-y-auto p-2">
            {error && (
              <p className="px-2 py-1.5 text-xs text-destructive">{error}</p>
            )}
            {!loading && options.length === 0 && !error && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                暂无可用 Skill。请确认后端已启动且 `/api/v1/skills` 有数据。
              </p>
            )}
            <ul className="space-y-0.5">
              {options.map((s) => (
                <li key={s.name}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 text-sm",
                      "hover:bg-muted/60"
                    )}
                  >
                    <Checkbox
                      id={`skill-${s.name}`}
                      className="mt-0.5"
                      checked={value.includes(s.name)}
                      onCheckedChange={(c) => toggle(s.name, c === true)}
                    />
                    <span className="min-w-0 flex-1 leading-snug">
                      <span className="font-medium text-foreground">
                        {s.name}
                      </span>
                      {s.description ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {s.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </PopoverContent>
      </Popover>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">已选择</p>
        {value.length === 0 ? (
          <p className="text-xs text-muted-foreground/80">暂无，请从上方展开列表勾选</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.map((n) => {
              const inApi = optionNames.has(n);
              const desc = optionMap.get(n)?.description;
              return (
                <button
                  key={n}
                  type="button"
                  disabled={disabled}
                  title={desc?.trim() ? desc : inApi ? undefined : "此 Skill 未出现在当前 API 列表中"}
                  onClick={() => toggle(n, false)}
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-xs font-mono",
                    inApi
                      ? "border-border bg-muted/50 hover:bg-muted/70"
                      : "border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/15",
                    "disabled:pointer-events-none disabled:opacity-50"
                  )}
                >
                  <span className="truncate text-foreground">{n}</span>
                  <X className="h-3 w-3 shrink-0 opacity-70 text-foreground" aria-hidden />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
