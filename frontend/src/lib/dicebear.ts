/**
 * DiceBear 头像生成器
 * 
 * 使用 DiceBear API 生成多种风格的头像
 * 文档: https://www.dicebear.com/styles/
 */

export interface DiceBearConfig {
  seed: string;
  style?: DiceBearStyle;
  size?: number;
  backgroundColor?: string[];
  radius?: number;
}

/** DiceBear 支持的头像风格 */
export type DiceBearStyle = 
  | 'toon-head'
  | 'adventurer'
  | 'avataaars'
  | 'bottts'
  | 'croodles'
  | 'fun-emoji'
  | 'glass'
  | 'lorelei'
  | 'micah'
  | 'miniavs'
  | 'notionists'
  | 'open-peeps'
  | 'personas'
  | 'pixel-art';

/** 风格显示名称映射 */
export const STYLE_LABELS: Record<DiceBearStyle, string> = {
  'toon-head': '卡通头像',
  'adventurer': '冒险家',
  'avataaars': '卡通人物',
  'bottts': '机器人',
  'croodles': '涂鸦风格',
  'fun-emoji': '表情符号',
  'glass': '玻璃质感',
  'lorelei': '艺术肖像',
  'micah': '极简人物',
  'miniavs': '迷你头像',
  'notionists': 'Notion 风格',
  'open-peeps': '手绘人物',
  'personas': '人物角色',
  'pixel-art': '像素艺术',
};

/** 所有可用风格列表 */
export const DICEBEAR_STYLES: DiceBearStyle[] = Object.keys(STYLE_LABELS) as DiceBearStyle[];

/**
 * 生成 DiceBear 头像的 SVG URL
 * 
 * @param config 头像配置
 * @returns DiceBear API URL
 */
export function generateDiceBearUrl(config: DiceBearConfig): string {
  const {
    seed,
    style = 'toon-head',
    size = 128,
    backgroundColor,
    radius = 50,
  } = config;

  // 编码 seed 以确保 URL 安全
  const encodedSeed = encodeURIComponent(seed);
  
  // 构建查询参数
  const params = new URLSearchParams({
    size: size.toString(),
    radius: radius.toString(),
  });

  // 如果指定了背景色，添加背景色参数
  if (backgroundColor && backgroundColor.length > 0) {
    params.append('backgroundColor', backgroundColor.join(','));
  }

  // 构建完整 URL
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodedSeed}&${params.toString()}`;
}

/**
 * 向后兼容：保留旧函数名
 */
export function generateToonHeadUrl(config: Omit<DiceBearConfig, 'style'>): string {
  return generateDiceBearUrl({ ...config, style: 'toon-head' });
}

/**
 * 预设的背景色组合 - 柔和现代色调
 */
export const DICEBEAR_COLOR_PALETTES = {
  // 柔和蓝紫色调
  softBlue: ['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf'],
  // 温暖橙色调
  warmOrange: ['ffd5dc', 'ffdfbf', 'f9c8d9', 'fbc5c5', 'f6d5a0'],
  // 清新绿色调
  freshGreen: ['c0aede', 'd1d4f9', 'b6e3f4', 'a8e6cf', 'dcedc1'],
  // 现代灰色调
  modernGray: ['e8e8e8', 'f0f0f0', 'd9d9d9', 'c4c4c4', 'b0b0b0'],
  // 活力彩虹
  vibrant: ['ff6b6b', '4ecdc4', '45b7d1', '96ceb4', 'ffeaa7'],
} as const;

export type ColorPaletteName = keyof typeof DICEBEAR_COLOR_PALETTES;

/**
 * 根据 agent 名称选择合适的色板
 * 
 * @param agentName Agent 名称
 * @returns 色板名称
 */
export function selectColorPalette(agentName: string): ColorPaletteName {
  const palettes: ColorPaletteName[] = [
    'softBlue',
    'warmOrange',
    'freshGreen',
    'modernGray',
    'vibrant',
  ];
  
  // 使用名称的第一个字符来选择色板（确保一致性）
  const index = agentName.charCodeAt(0) % palettes.length;
  return palettes[index];
}

/**
 * 生成 Data URI 格式的头像（用于内联使用）
 * 
 * @param svg SVG 字符串
 * @returns Data URI
 */
export function svgToDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg);
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

/**
 * 从 URL 加载 SVG 头像
 * 
 * @param url DiceBear API URL
 * @returns Promise<string> SVG 字符串
 */
export async function fetchToonHeadSvg(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch avatar: ${response.statusText}`);
  }
  return await response.text();
}
