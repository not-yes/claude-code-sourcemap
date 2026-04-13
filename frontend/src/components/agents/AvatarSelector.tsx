import { useState, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { generateDiceBearUrl } from "@/lib/dicebear";

interface AvatarSelectorProps {
  agentId: string;
  agentName: string;
  currentImage?: string;
  onImageSelect: (imageData: string) => void;
  onClear: () => void;
}

/**
 * 头像选择器组件
 * 支持选择多个 DiceBear toon-head 头像或上传本地图片
 */
export function AvatarSelector({
  agentId,
  agentName,
  currentImage,
  onImageSelect,
  onClear,
}: AvatarSelectorProps) {
  const [activeTab, setActiveTab] = useState<'dicebear' | 'upload'>(currentImage ? 'upload' : 'dicebear');
  const [previewUrl, setPreviewUrl] = useState<string>(currentImage || "");
  const [selectedSeed, setSelectedSeed] = useState<string>(agentId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 生成多个不同的 toon-head 头像变体
  const avatarVariants = useMemo(() => {
    const seeds = [
      agentId,
      `${agentId}-v1`,
      `${agentId}-v2`,
      `${agentId}-v3`,
      `${agentId}-v4`,
      `${agentId}-v5`,
      `${agentId}-v6`,
      `${agentId}-v7`,
      `${agentId}-v8`,
    ];

    return seeds.map((seed) => ({
      seed,
      url: generateDiceBearUrl({
        seed,
        style: 'toon-head',
        size: 128,
        radius: 50,
      }),
      isSelected: seed === selectedSeed,
    }));
  }, [agentId, selectedSeed]);

  // 生成当前选中头像的大预览 URL
  const currentAvatarUrl = generateDiceBearUrl({
    seed: selectedSeed,
    style: 'toon-head',
    size: 128,
    radius: 50,
  });

  // 处理文件上传
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件');
      return;
    }

    // 验证文件大小（限制 2MB）
    if (file.size > 2 * 1024 * 1024) {
      alert('图片大小不能超过 2MB');
      return;
    }

    // 读取文件为 Base64
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setPreviewUrl(result);
      onImageSelect(result);
    };
    reader.readAsDataURL(file);
  };

  // 触发文件选择
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // 选择一个 DiceBear 头像
  const handleSelectAvatar = (seed: string) => {
    setSelectedSeed(seed);
    const url = generateDiceBearUrl({
      seed,
      style: 'toon-head',
      size: 128,
      radius: 50,
    });
    onImageSelect(url);
  };

  return (
    <div className="space-y-4">
      {/* Tab 切换 */}
      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setActiveTab('dicebear')}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors relative",
            activeTab === 'dicebear'
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          默认头像
          {activeTab === 'dicebear' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={cn(
            "px-4 py-2 text-sm font-medium transition-colors relative",
            activeTab === 'upload'
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          本地图片
          {activeTab === 'upload' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {/* DiceBear 头像选择 */}
      {activeTab === 'dicebear' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            选择一个喜欢的头像（基于 Agent ID 生成不同变体）
          </p>
          
          {/* 头像网格 */}
          <div className="grid grid-cols-5 gap-1.5 justify-items-center">
            {avatarVariants.map((variant) => (
              <button
                key={variant.seed}
                type="button"
                onClick={() => handleSelectAvatar(variant.seed)}
                className={cn(
                  "relative w-12 h-12 rounded-full overflow-hidden border-2 transition-all hover:scale-105",
                  variant.isSelected
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-muted hover:border-primary/50"
                )}
              >
                <img
                  src={variant.url}
                  alt={`Avatar variant`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {variant.isSelected && (
                  <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                    <div className="w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* 当前选中预览 */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-muted">
              <img
                src={currentAvatarUrl}
                alt="Selected avatar"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="p-2 bg-muted/50 rounded-lg">
            <p className="text-xs font-medium text-center">Toon Head 卡通头像</p>
            <p className="text-xs text-muted-foreground text-center">
              简约简笔画风格
            </p>
          </div>
        </div>
      )}

      {/* 本地图片上传 */}
      {activeTab === 'upload' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            上传本地图片作为头像（支持 JPG、PNG、GIF，最大 2MB）
          </p>

          {/* 预览区域 */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-muted">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <span className="text-xl text-muted-foreground">
                    {agentName.slice(0, 2).toUpperCase()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 上传按钮 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUploadClick}
              className="flex-1 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              选择图片
            </button>
            {previewUrl && (
              <button
                type="button"
                onClick={() => {
                  setPreviewUrl("");
                  onClear();
                }}
                className="px-3 py-2 text-sm font-medium bg-destructive text-destructive-foreground rounded-lg hover:opacity-90 transition-opacity"
              >
                清除
              </button>
            )}
          </div>

          {/* 隐藏的文件输入 */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* 使用提示 */}
          <p className="text-xs text-muted-foreground text-center">
            点击图片文件选择器上传新图片
          </p>
        </div>
      )}
    </div>
  );
}
