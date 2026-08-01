// Color conversion utilities

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }
export interface HSV { h: number; s: number; v: number }
export interface CMYK { c: number; m: number; y: number; k: number }
export interface HSI { h: number; s: number; i: number }
export interface CIELAB { l: number; a: number; b: number }

export function hexToRgb(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : null;
}

export function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('');
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = h / 360, sn = s / 100, ln = l / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
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
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return {
    r: Math.round(hue2rgb(p, q, hn + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hn) * 255),
    b: Math.round(hue2rgb(p, q, hn - 1 / 3) * 255),
  };
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (max !== min) {
    switch (max) {
      case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6; break;
      case gn: h = ((bn - rn) / d + 2) / 6; break;
      case bn: h = ((rn - gn) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s: s * 100, v: v * 100 };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hn = h / 360, sn = s / 100, vn = v / 100;
  const i = Math.floor(hn * 6);
  const f = hn * 6 - i;
  const p = vn * (1 - sn);
  const q = vn * (1 - f * sn);
  const t = vn * (1 - (1 - f) * sn);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = vn; g = t; b = p; break;
    case 1: r = q; g = vn; b = p; break;
    case 2: r = p; g = vn; b = t; break;
    case 3: r = p; g = q; b = vn; break;
    case 4: r = t; g = p; b = vn; break;
    case 5: r = vn; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export function rgbToCmyk({ r, g, b }: RGB): CMYK {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - rn - k) / (1 - k)) * 100,
    m: ((1 - gn - k) / (1 - k)) * 100,
    y: ((1 - bn - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

export function rgbToHsi({ r, g, b }: RGB): HSI {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const sum = rn + gn + bn;
  const i = sum / 3;
  const min = Math.min(rn, gn, bn);
  const s = sum === 0 ? 0 : (1 - (3 / sum) * min) * 100;
  let h = 0;
  if (s !== 0) {
    const num = 0.5 * ((rn - gn) + (rn - bn));
    const den = Math.sqrt((rn - gn) ** 2 + (rn - bn) * (gn - bn));
    const theta = Math.acos(Math.min(1, Math.max(-1, num / (den || 1))));
    h = bn <= gn ? theta : 2 * Math.PI - theta;
    h = (h * 180) / Math.PI;
  }
  return { h, s, i: i * 100 };
}

export function rgbToCielab({ r, g, b }: RGB): CIELAB {
  // RGB -> XYZ -> CIELAB
  let rn = r / 255, gn = g / 255, bn = b / 255;
  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;
  let x = (rn * 0.4124564 + gn * 0.3575761 + bn * 0.1804375) / 0.95047;
  let y = (rn * 0.2126729 + gn * 0.7151522 + bn * 0.0721750) / 1.00000;
  let z = (rn * 0.0193339 + gn * 0.1191920 + bn * 0.9503041) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

// Color harmonies
export function getComplementary(hsl: HSL): string[] {
  return [rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 180) % 360 }))];
}

export function getContrastColors(hsl: HSL): string[] {
  return [
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 150) % 360 })),
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 210) % 360 })),
  ];
}

export function getAnalogous(hsl: HSL): string[] {
  return [
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 30) % 360 })),
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 330) % 360 })),
  ];
}

export function getSplitComplementary(hsl: HSL): string[] {
  return [
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 150) % 360 })),
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 180) % 360 })),
    rgbToHex(hslToRgb({ ...hsl, h: (hsl.h + 210) % 360 })),
  ];
}

// Format helpers
export function formatHex(hex: string, removeHash: boolean): string {
  const upper = hex.toUpperCase().replace('#', '');
  return removeHash ? upper : '#' + upper;
}

export function formatRgb(rgb: RGB): string {
  return `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`;
}

export function formatHsv(hsv: HSV): string {
  return `${hsv.h.toFixed(2)}, ${hsv.s.toFixed(2)}%, ${hsv.v.toFixed(2)}%`;
}

export function formatHsl(hsl: HSL): string {
  return `${hsl.h.toFixed(2)}, ${hsl.s.toFixed(2)}%, ${hsl.l.toFixed(2)}%`;
}

export function formatCmyk(cmyk: CMYK): string {
  return `${Math.round(cmyk.c)}%, ${Math.round(cmyk.m)}%, ${Math.round(cmyk.y)}%, ${Math.round(cmyk.k)}%`;
}

export function formatHsi(hsi: HSI): string {
  return `${hsi.h.toFixed(2)}, ${hsi.s.toFixed(2)}%, ${hsi.i.toFixed(2)}%`;
}

export function formatCielab(lab: CIELAB): string {
  return `${lab.l.toFixed(3)}, ${lab.a.toFixed(3)}, ${lab.b.toFixed(3)}`;
}

// Extract colors from image canvas
export function extractColorsFromCanvas(canvas: HTMLCanvasElement, count = 8): string[] {
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  
  // Simple color quantization using median cut
  const colors: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(pixels.length / 4 / 1000));
  for (let i = 0; i < pixels.length; i += step * 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
    if (a < 128) continue;
    colors.push([r, g, b]);
  }
  
  // K-means-like clustering (simplified)
  const clusters = kMeansColors(colors, count);
  return clusters.map(c => rgbToHex({ r: c[0], g: c[1], b: c[2] }));
}

function kMeansColors(colors: [number, number, number][], k: number): [number, number, number][] {
  if (colors.length === 0) return [];
  if (colors.length <= k) return colors;
  
  // Initialize centroids randomly
  const centroids: [number, number, number][] = [];
  const used = new Set<number>();
  for (let i = 0; i < k; i++) {
    let idx: number;
    do { idx = Math.floor(Math.random() * colors.length); } while (used.has(idx));
    used.add(idx);
    centroids.push([...colors[idx]]);
  }
  
  // Iterate
  for (let iter = 0; iter < 10; iter++) {
    const groups: [number, number, number][][] = Array.from({ length: k }, () => []);
    for (const color of colors) {
      let minDist = Infinity, minIdx = 0;
      for (let i = 0; i < k; i++) {
        const d = (color[0] - centroids[i][0]) ** 2 + (color[1] - centroids[i][1]) ** 2 + (color[2] - centroids[i][2]) ** 2;
        if (d < minDist) { minDist = d; minIdx = i; }
      }
      groups[minIdx].push(color);
    }
    for (let i = 0; i < k; i++) {
      if (groups[i].length === 0) continue;
      centroids[i] = [
        Math.round(groups[i].reduce((s, c) => s + c[0], 0) / groups[i].length),
        Math.round(groups[i].reduce((s, c) => s + c[1], 0) / groups[i].length),
        Math.round(groups[i].reduce((s, c) => s + c[2], 0) / groups[i].length),
      ];
    }
  }
  
  return centroids;
}
