import { describe, it, expect } from 'vitest';
import {
  toDegrees,
  fromDegrees,
  convertAngle,
  formatAngle,
  convertDataSize,
  formatDataSize,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  DATA_SIZE_UNITS,
} from '@/lib/converter-utils';

// ============ 角度转换 ============

describe('角度转换', () => {
  describe('toDegrees', () => {
    it('度转度（恒等）', () => {
      expect(toDegrees(90, 'degree')).toBe(90);
      expect(toDegrees(0, 'degree')).toBe(0);
      expect(toDegrees(360, 'degree')).toBe(360);
    });

    it('弧度转度', () => {
      expect(toDegrees(Math.PI, 'radian')).toBeCloseTo(180);
      expect(toDegrees(Math.PI / 2, 'radian')).toBeCloseTo(90);
      expect(toDegrees(0, 'radian')).toBe(0);
      expect(toDegrees(2 * Math.PI, 'radian')).toBeCloseTo(360);
    });

    it('梯度转度', () => {
      expect(toDegrees(100, 'gradian')).toBeCloseTo(90);
      expect(toDegrees(200, 'gradian')).toBeCloseTo(180);
      expect(toDegrees(400, 'gradian')).toBeCloseTo(360);
      expect(toDegrees(0, 'gradian')).toBe(0);
    });

    it('圈转度', () => {
      expect(toDegrees(0.25, 'turn')).toBeCloseTo(90);
      expect(toDegrees(0.5, 'turn')).toBeCloseTo(180);
      expect(toDegrees(1, 'turn')).toBeCloseTo(360);
      expect(toDegrees(0, 'turn')).toBe(0);
    });
  });

  describe('fromDegrees', () => {
    it('度转弧度', () => {
      expect(fromDegrees(180, 'radian')).toBeCloseTo(Math.PI);
      expect(fromDegrees(90, 'radian')).toBeCloseTo(Math.PI / 2);
    });

    it('度转梯度', () => {
      expect(fromDegrees(90, 'gradian')).toBeCloseTo(100);
      expect(fromDegrees(360, 'gradian')).toBeCloseTo(400);
    });

    it('度转圈', () => {
      expect(fromDegrees(90, 'turn')).toBeCloseTo(0.25);
      expect(fromDegrees(360, 'turn')).toBeCloseTo(1);
    });
  });

  describe('convertAngle', () => {
    it('弧度转梯度', () => {
      expect(convertAngle(Math.PI, 'radian', 'gradian')).toBeCloseTo(200);
    });

    it('圈转弧度', () => {
      expect(convertAngle(0.5, 'turn', 'radian')).toBeCloseTo(Math.PI);
    });

    it('梯度转圈', () => {
      expect(convertAngle(100, 'gradian', 'turn')).toBeCloseTo(0.25);
    });

    it('同单位转换（恒等）', () => {
      expect(convertAngle(45, 'degree', 'degree')).toBe(45);
      expect(convertAngle(1.5, 'radian', 'radian')).toBeCloseTo(1.5);
    });
  });

  describe('formatAngle', () => {
    it('整数直接返回', () => {
      expect(formatAngle(90)).toBe('90');
      expect(formatAngle(0)).toBe('0');
    });

    it('浮点数保留合理精度', () => {
      expect(formatAngle(1.5707963267948966)).toBe('1.570796327');
      expect(formatAngle(0.1 + 0.2)).toBe('0.3');
    });
  });
});

// ============ 数据大小转换 ============

describe('数据大小转换', () => {
  describe('convertDataSize', () => {
    it('1 GB (IEC 1024) 转换', () => {
      const results = convertDataSize(1, 'GB', 1024);
      expect(results).toHaveLength(6);
      expect(results[0]).toEqual({ unit: 'B', value: 1073741824 });
      expect(results[1]).toEqual({ unit: 'KB', value: 1048576 });
      expect(results[2]).toEqual({ unit: 'MB', value: 1024 });
      expect(results[3]).toEqual({ unit: 'GB', value: 1 });
      expect(results[4].value).toBeCloseTo(1 / 1024);
    });

    it('1 KB (SI 1000) 转换', () => {
      const results = convertDataSize(1, 'KB', 1000);
      expect(results[0]).toEqual({ unit: 'B', value: 1000 });
      expect(results[1]).toEqual({ unit: 'KB', value: 1 });
      expect(results[2]).toEqual({ unit: 'MB', value: 0.001 });
    });

    it('0 值转换', () => {
      const results = convertDataSize(0, 'MB', 1024);
      results.forEach((r) => expect(r.value).toBe(0));
    });

    it('小数输入', () => {
      const results = convertDataSize(0.5, 'TB', 1024);
      expect(results[3].value).toBeCloseTo(512); // GB
    });

    it('返回所有 6 个单位', () => {
      const results = convertDataSize(1, 'B', 1024);
      expect(results.map((r) => r.unit)).toEqual([...DATA_SIZE_UNITS]);
    });
  });

  describe('formatDataSize', () => {
    it('正常数值格式化', () => {
      expect(formatDataSize(1024)).toBe('1,024');
      expect(formatDataSize(0)).toBe('0');
    });

    it('极小数值使用科学计数法', () => {
      const result = formatDataSize(0.0000001);
      expect(result).toContain('e');
    });
  });
});

// ============ 颜色转换 ============

describe('颜色转换', () => {
  describe('hexToRgb', () => {
    it('6位 HEX', () => {
      expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
      expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
      expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('3位简写 HEX', () => {
      expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
      expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
    });

    it('无 # 前缀', () => {
      expect(hexToRgb('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    });

    it('无效输入返回 null', () => {
      expect(hexToRgb('#gg0000')).toBeNull();
      expect(hexToRgb('#12345')).toBeNull();
      expect(hexToRgb('')).toBeNull();
    });
  });

  describe('rgbToHex', () => {
    it('基本转换', () => {
      expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#ff0000');
      expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe('#00ff00');
      expect(rgbToHex({ r: 0, g: 0, b: 255 })).toBe('#0000ff');
    });

    it('边界值裁剪', () => {
      expect(rgbToHex({ r: 300, g: -10, b: 128 })).toBe('#ff0080');
    });
  });

  describe('rgbToHsl', () => {
    it('纯红色', () => {
      expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    });

    it('纯绿色', () => {
      expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 });
    });

    it('纯蓝色', () => {
      expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 });
    });

    it('白色', () => {
      expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 });
    });

    it('黑色', () => {
      expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
    });

    it('灰色', () => {
      expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 });
    });
  });

  describe('hslToRgb', () => {
    it('纯红色', () => {
      expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 });
    });

    it('纯绿色', () => {
      expect(hslToRgb({ h: 120, s: 100, l: 50 })).toEqual({ r: 0, g: 255, b: 0 });
    });

    it('纯蓝色', () => {
      expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 });
    });

    it('无饱和度（灰色）', () => {
      expect(hslToRgb({ h: 0, s: 0, l: 50 })).toEqual({ r: 128, g: 128, b: 128 });
    });

    it('RGB → HSL → RGB 往返转换', () => {
      const original = { r: 66, g: 135, b: 245 };
      const hsl = rgbToHsl(original);
      const back = hslToRgb(hsl);
      expect(back.r).toBeCloseTo(original.r, 0);
      expect(back.g).toBeCloseTo(original.g, 0);
      expect(back.b).toBeCloseTo(original.b, 0);
    });
  });
});
