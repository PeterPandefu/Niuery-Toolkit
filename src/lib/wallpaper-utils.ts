export type WallpaperSource = 'bing' | 'wallhaven' | 'ai' | 'import';

export type WallpaperTab = 'online' | 'ai' | 'library';

export interface OnlineWallpaper {
  id: string;
  title: string;
  thumbUrl: string;
  fullUrl: string;
  source: WallpaperSource;
  width: number;
  height: number;
}

export interface LocalWallpaper {
  id: string;
  path: string;
  title: string;
  source: WallpaperSource;
  prompt?: string;
  remoteId?: string;
  createdAt: number;
  width: number;
  height: number;
}

export interface WallpaperLibrary {
  items: LocalWallpaper[];
  currentId?: string;
}

export interface WallpaperSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface WallpaperStyle {
  id: string;
  label: string;
  suffix: string;
}

export const WALLPAPER_SIZES: WallpaperSize[] = [
  { id: '1080p', label: '1920 × 1080', width: 1920, height: 1080 },
  { id: '1440p', label: '2560 × 1440', width: 2560, height: 1440 },
  { id: '4k', label: '3840 × 2160', width: 3840, height: 2160 },
  { id: 'portrait', label: '1080 × 1920', width: 1080, height: 1920 },
];

export const WALLPAPER_STYLES: WallpaperStyle[] = [
  { id: 'scenic', label: '写实风景', suffix: 'photorealistic landscape, cinematic lighting, ultra detailed' },
  { id: 'cyberpunk', label: '赛博朋克', suffix: 'cyberpunk city, neon lights, rainy night, ultra detailed' },
  { id: 'minimal', label: '极简', suffix: 'minimalist composition, soft gradient, clean, elegant' },
  { id: 'anime', label: '动漫', suffix: 'anime style illustration, studio lighting, detailed background' },
  { id: 'oil', label: '油画', suffix: 'oil painting, impressionist brush strokes, rich colors' },
  { id: 'space', label: '太空', suffix: 'outer space, nebula, stars, planets, cosmic, ultra detailed' },
];

export const WALLHAVEN_CATEGORIES: { id: string; label: string; query: string }[] = [
  { id: 'nature', label: '自然', query: 'nature landscape' },
  { id: 'city', label: '城市', query: 'city architecture' },
  { id: 'abstract', label: '抽象', query: 'abstract' },
  { id: 'minimal', label: '极简', query: 'minimal' },
  { id: 'tech', label: '科技', query: 'technology' },
  { id: 'space', label: '太空', query: 'space nebula' },
];

export function getWallpaperSize(id: string): WallpaperSize {
  return WALLPAPER_SIZES.find((item) => item.id === id) ?? WALLPAPER_SIZES[0];
}

export function getWallpaperStyle(id: string): WallpaperStyle {
  return WALLPAPER_STYLES.find((item) => item.id === id) ?? WALLPAPER_STYLES[0];
}

/** 组合用户描述与风格后缀，供 AI 生成使用 */
export function buildAiPrompt(userPrompt: string, styleId: string): string {
  const prompt = userPrompt.trim();
  const style = getWallpaperStyle(styleId);
  if (!prompt) return style.suffix;
  if (prompt.toLowerCase().includes(style.suffix.toLowerCase())) return prompt;
  return `${prompt}, ${style.suffix}`;
}

export function formatWallpaperResolution(width: number, height: number): string {
  return `${width} × ${height}`;
}

export function randomWallpaperSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000);
}
