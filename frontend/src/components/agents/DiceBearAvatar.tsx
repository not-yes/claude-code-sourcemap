import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { generateToonHeadUrl, selectColorPalette, DICEBEAR_COLOR_PALETTES } from "@/lib/dicebear";

interface DiceBearAvatarProps {
  seed: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  onClick?: () => void;
  fallback?: React.ReactNode;
}

const sizeMap = {
  xs: 24,
  sm: 32,
  md: 48,
  lg: 64,
  xl: 96,
};

const tailwindSizes = {
  xs: "w-6 h-6",
  sm: "w-8 h-8",
  md: "w-12 h-12",
  lg: "w-16 h-16",
  xl: "w-24 h-24",
};

/**
 * DiceBear Toon Head 头像组件
 * 
 * 使用 DiceBear API 生成简约简笔画风格的头像
 * 支持加载状态、错误处理和降级显示
 * 
 * @example
 * // 基础使用
 * <DiceBearAvatar seed="agent-finance" size="md" />
 * 
 * @example
 * // 带点击事件
 * <DiceBearAvatar 
 *   seed="agent-tax" 
 *   size="lg"
 *   onClick={() => console.log('clicked')}
 * />
 */
export function DiceBearAvatar({
  seed,
  size = "md",
  className,
  onClick,
  fallback,
}: DiceBearAvatarProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // 使用 useMemo 替代 useEffect 来计算头像 URL
  const avatarUrl = useMemo(() => {
    const paletteName = selectColorPalette(seed);
    const colors = DICEBEAR_COLOR_PALETTES[paletteName];

    return generateToonHeadUrl({
      seed,
      size: sizeMap[size] * 2, // 请求更高分辨率的图片
      backgroundColor: [...colors], // 转为可变数组
      radius: 50, // 圆形
    });
  }, [seed, size]);

  const handleLoad = () => {
    setLoading(false);
    setError(false);
  };

  const handleError = () => {
    setLoading(false);
    setError(true);
  };

  // 降级显示：如果加载失败，显示 seed 的首字母
  if (error || !avatarUrl) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div
        className={cn(
          "rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center font-semibold text-white",
          tailwindSizes[size],
          onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
          className
        )}
        role={onClick ? "button" : undefined}
        onClick={onClick}
      >
        <span className="text-lg">
          {seed.charAt(0).toUpperCase()}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-full overflow-hidden shrink-0 relative",
        tailwindSizes[size],
        onClick && "cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all",
        className
      )}
      role={onClick ? "button" : undefined}
      onClick={onClick}
    >
      {/* 加载状态 */}
      {loading && (
        <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* 头像图片 */}
      <img
        src={avatarUrl}
        alt={`Avatar for ${seed}`}
        className="w-full h-full object-cover"
        onLoad={handleLoad}
        onError={handleError}
        loading="lazy"
      />
    </div>
  );
}
