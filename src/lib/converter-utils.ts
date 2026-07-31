/**
 * 转换器工具函数
 * 角度转换、数据大小转换等纯函数
 */

// ============ 角度转换 ============

export type AngleUnit = 'degree' | 'radian' | 'gradian' | 'turn';

/** 将任意角度单位转换为度 */
export function toDegrees(value: number, from: AngleUnit): number {
  switch (from) {
    case 'degree': return value;
    case 'radian': return value * (180 / Math.PI);
    case 'gradian': return value * 0.9;
    case 'turn': return value * 360;
  }
}

/** 从度转换为任意角度单位 */
export function fromDegrees(degrees: number, to: AngleUnit): number {
  switch (to) {
    case 'degree': return degrees;
    case 'radian': return degrees * (Math.PI / 180);
    case 'gradian': return degrees / 0.9;
    case 'turn': return degrees / 360;
  }
}

/** 角度单位间直接转换 */
export function convertAngle(value: number, from: AngleUnit, to: AngleUnit): number {
  return fromDegrees(toDegrees(value, from), to);
}

/** 格式化角度数值（保留合理精度） */
export function formatAngle(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  const str = n.toPrecision(10);
  return parseFloat(str).toString();
}

// ============ 数据大小转换 ============

export const DATA_SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;
export type DataSizeUnit = (typeof DATA_SIZE_UNITS)[number];

export interface DataSizeResult {
  unit: DataSizeUnit;
  value: number;
}

/**
 * 数据大小转换
 * @param value 数值
 * @param fromUnit 源单位
 * @param standard 1024 (IEC) 或 1000 (SI)
 */
export function convertDataSize(
  value: number,
  fromUnit: DataSizeUnit,
  standard: 1024 | 1000 = 1024
): DataSizeResult[] {
  const fromIndex = DATA_SIZE_UNITS.indexOf(fromUnit);
  const bytes = value * Math.pow(standard, fromIndex);

  return DATA_SIZE_UNITS.map((unit, index) => ({
    unit,
    value: bytes / Math.pow(standard, index),
  }));
}

/** 格式化数据大小数值 */
export function formatDataSize(value: number): string {
  if (value < 0.000001 && value !== 0) {
    return value.toExponential(4);
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

// ============ 颜色转换 ============

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

/** HEX → RGB */
export function hexToRgb(hex: string): RGB | null {
  const cleaned = hex.replace(/^#/, '');
  let fullHex = cleaned;
  if (cleaned.length === 3) {
    fullHex = cleaned.split('').map((c) => c + c).join('');
  }
  if (fullHex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(fullHex)) return null;
  return {
    r: parseInt(fullHex.slice(0, 2), 16),
    g: parseInt(fullHex.slice(2, 4), 16),
    b: parseInt(fullHex.slice(4, 6), 16),
  };
}

/** RGB → HEX */
export function rgbToHex(rgb: RGB): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/** RGB → HSL */
export function rgbToHsl(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** HSL → RGB */
export function hslToRgb(hsl: HSL): RGB {
  const h = hsl.h / 360;
  const s = hsl.s / 100;
  const l = hsl.l / 100;

  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}
