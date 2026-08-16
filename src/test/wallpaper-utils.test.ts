import { describe, expect, it } from 'vitest';
import {
  WALLPAPER_SIZES,
  WALLPAPER_STYLES,
  buildAiPrompt,
  formatWallpaperResolution,
  getWallpaperSize,
  getWallpaperStyle,
  randomWallpaperSeed,
} from '@/lib/wallpaper-utils';

describe('buildAiPrompt', () => {
  it('空描述时只使用风格后缀', () => {
    expect(buildAiPrompt('  ', 'space')).toBe(getWallpaperStyle('space').suffix);
  });

  it('拼接用户描述与风格后缀', () => {
    const result = buildAiPrompt('雨夜东京', 'cyberpunk');
    expect(result.startsWith('雨夜东京, ')).toBe(true);
    expect(result).toContain(getWallpaperStyle('cyberpunk').suffix);
  });

  it('描述已包含风格后缀时不重复拼接', () => {
    const suffix = getWallpaperStyle('minimal').suffix;
    expect(buildAiPrompt(suffix, 'minimal')).toBe(suffix);
  });
});

describe('wallpaper size and style presets', () => {
  it('未知尺寸回退到 1080p', () => {
    expect(getWallpaperSize('unknown').id).toBe('1080p');
    expect(getWallpaperSize('unknown').width).toBe(1920);
  });

  it('包含竖屏与 4K 预设', () => {
    expect(WALLPAPER_SIZES.map((item) => item.id)).toEqual(['1080p', '1440p', '4k', 'portrait']);
    expect(getWallpaperSize('portrait')).toEqual({
      id: 'portrait',
      label: '1080 × 1920',
      width: 1080,
      height: 1920,
    });
  });

  it('未知风格回退到写实风景', () => {
    expect(getWallpaperStyle('nope').id).toBe('scenic');
    expect(WALLPAPER_STYLES.length).toBeGreaterThanOrEqual(6);
  });

  it('格式化分辨率', () => {
    expect(formatWallpaperResolution(1920, 1080)).toBe('1920 × 1080');
  });

  it('随机种子落在有效范围', () => {
    const seed = randomWallpaperSeed();
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(1_000_000_000);
  });
});
