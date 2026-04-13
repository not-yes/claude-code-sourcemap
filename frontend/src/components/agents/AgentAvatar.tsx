import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgentMetadataStore } from "@/stores/agentMetadataStore";
import { generateDiceBearUrl } from "@/lib/dicebear";

interface AgentAvatarProps {
  agentId: string;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}

const sizes = { sm: "w-8 h-8 text-sm", md: "w-12 h-12 text-lg", lg: "w-16 h-16 text-xl" };
const sizePixels = { sm: 32, md: 48, lg: 64 };

/** 默认回退背景色（当 DiceBear 无法加载时使用） */
const FALLBACK_BG = "#6366f1"; // Indigo-500

/**
 * Agent 头像组件
 * 
 * 优先级：本地图片 > DiceBear 头像 > 字母头像
 */
export function AgentAvatar({
  agentId,
  name,
  size = "md",
  className,
  onClick,
}: AgentAvatarProps) {
  const get = useAgentMetadataStore((s) => s.get);
  const meta = get(agentId);

  // 检查头像类型
  const hasCustomImage = !!meta?.avatarImage;
  const diceBearStyle = meta?.diceBearStyle;
  const useCustomLetter = !!meta?.avatarLetter;

  // DiceBear 头像 URL（始终调用，避免条件调用 Hook）
  const avatarUrl = useMemo(() => {
    // 如果有自定义图片，返回 null（不使用 DiceBear）
    if (hasCustomImage) return null;

    return generateDiceBearUrl({
      seed: agentId,
      style: diceBearStyle,
      size: sizePixels[size] * 2,
      radius: 50,
    });
  }, [agentId, size, hasCustomImage, diceBearStyle]);

  // 优先：本地图片
  if (hasCustomImage && meta?.avatarImage) {
    return (
      <CustomImageAvatar
        src={meta.avatarImage}
        size={size}
        className={className}
        onClick={onClick}
      />
    );
  }

  // 其次：DiceBear 头像
  if (!useCustomLetter && avatarUrl) {
    return (
      <DiceBearAvatarImage
        url={avatarUrl}
        size={size}
        className={className}
        onClick={onClick}
        fallbackLetter={name.slice(0, 2).toUpperCase()}
      />
    );
  }

  // 最后：字母头像
  const letter = (meta?.avatarLetter ?? name.slice(0, 2).toUpperCase()).slice(0, 2) || "?";

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center shrink-0 font-semibold",
        sizes[size],
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
        className
      )}
      style={{ backgroundColor: FALLBACK_BG }}
      role={onClick ? "button" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="text-white">
        {letter}
      </span>
    </div>
  );
}

/**
 * 自定义图片头像组件
 */
function CustomImageAvatar({
  src,
  size,
  className,
  onClick,
}: {
  src: string;
  size: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
}) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div
        className={cn(
          "rounded-full bg-muted flex items-center justify-center",
          sizes[size],
          onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
          className
        )}
        role={onClick ? "button" : undefined}
        onClick={onClick}
      >
        <span className="text-xs text-muted-foreground">!</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-full overflow-hidden shrink-0",
        sizes[size],
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
        className
      )}
      role={onClick ? "button" : undefined}
      onClick={onClick}
    >
      <img
        src={src}
        alt="Custom avatar"
        className="w-full h-full object-cover"
        onError={() => setError(true)}
        loading="lazy"
      />
    </div>
  );
}

/**
 * DiceBear 头像图片组件（内部使用）
 * 包含加载状态和错误降级处理
 */
function DiceBearAvatarImage({
  url,
  size,
  className,
  onClick,
  fallbackLetter,
}: {
  url: string;
  size: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  fallbackLetter: string;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 降级：显示字母头像（使用默认背景色）
  if (error || !url) {
    return (
      <div
        className={cn(
          "rounded-full flex items-center justify-center shrink-0 font-semibold",
          sizes[size],
          onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
          className
        )}
        style={{ backgroundColor: FALLBACK_BG }}
        role={onClick ? "button" : undefined}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        tabIndex={onClick ? 0 : undefined}
      >
        <span className="text-white">
          {fallbackLetter.slice(0, 2) || "?"}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-full overflow-hidden shrink-0 relative",
        sizes[size],
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
        className
      )}
      role={onClick ? "button" : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      tabIndex={onClick ? 0 : undefined}
    >
      {/* 加载状态 */}
      {loading && (
        <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 头像图片 */}
      <img
        src={url}
        alt={`Agent avatar`}
        className="w-full h-full object-cover"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setError(true);
        }}
        loading="lazy"
      />
    </div>
  );
}
