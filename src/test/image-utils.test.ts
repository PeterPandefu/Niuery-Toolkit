import { describe, expect, it } from 'vitest';
import { calcCenterCrop, calcMergeLayout, calcRatioCrop, calcResizeSize } from '@/lib/image-utils';

describe('calcResizeSize', () => {
  const orig = { width: 1000, height: 500 };

  it('锁定比例且只给宽度：按宽度等比缩放', () => {
    expect(calcResizeSize(orig, { width: 500 }, true)).toEqual({ width: 500, height: 250 });
  });

  it('锁定比例且只给高度：按高度等比缩放', () => {
    expect(calcResizeSize(orig, { height: 100 }, true)).toEqual({ width: 200, height: 100 });
  });

  it('锁定比例且双边给定：contain 缩放', () => {
    expect(calcResizeSize(orig, { width: 400, height: 400 }, true)).toEqual({ width: 400, height: 200 });
  });

  it('不锁定比例：直接取目标尺寸', () => {
    expect(calcResizeSize(orig, { width: 123, height: 456 }, false)).toEqual({ width: 123, height: 456 });
  });

  it('缺失或非法边回退原尺寸', () => {
    expect(calcResizeSize(orig, {}, true)).toEqual({ width: 1000, height: 500 });
    expect(calcResizeSize(orig, { width: 0 }, true)).toEqual({ width: 1000, height: 500 });
  });

  it('结果至少为 1 像素', () => {
    expect(calcResizeSize({ width: 10, height: 10 }, { width: 0.4 }, true).width).toBeGreaterThanOrEqual(1);
  });
});

describe('calcMergeLayout', () => {
  const sizes = [
    { width: 10, height: 20 },
    { width: 30, height: 40 },
  ];

  it('横向拼接：宽度求和 + 间距，高度取最大', () => {
    const layout = calcMergeLayout(sizes, { direction: 'horizontal', gap: 5 });
    expect(layout.canvas).toEqual({ width: 45, height: 40 });
    expect(layout.positions).toEqual([
      { x: 0, y: 0 },
      { x: 15, y: 0 },
    ]);
  });

  it('纵向拼接：高度求和 + 间距，宽度取最大', () => {
    const layout = calcMergeLayout(sizes, { direction: 'vertical', gap: 0 });
    expect(layout.canvas).toEqual({ width: 30, height: 60 });
    expect(layout.positions).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ]);
  });

  it('网格排列：2x2 布局取行列最大值', () => {
    const four = [
      { width: 10, height: 10 },
      { width: 20, height: 15 },
      { width: 30, height: 5 },
      { width: 40, height: 25 },
    ];
    const layout = calcMergeLayout(four, { direction: 'grid', gap: 10, cols: 2 });
    // 列宽 max(10,30)=30 / max(20,40)=40；行高 max(10,15)=15 / max(5,25)=25
    expect(layout.canvas).toEqual({ width: 80, height: 50 });
    expect(layout.positions).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 25 },
      { x: 40, y: 25 },
    ]);
  });

  it('空输入返回空布局', () => {
    expect(calcMergeLayout([], { direction: 'horizontal', gap: 0 })).toEqual({
      canvas: { width: 0, height: 0 },
      positions: [],
    });
  });
});

describe('calcRatioCrop', () => {
  it('竖图裁 1:1 取居中横边', () => {
    expect(calcRatioCrop({ width: 100, height: 200 }, 1, 1)).toEqual({ x: 0, y: 50, width: 100, height: 100 });
  });

  it('横图裁 16:9', () => {
    const rect = calcRatioCrop({ width: 1600, height: 1000 }, 16, 9);
    expect(rect.height).toBe(900);
    expect(rect.width).toBe(1600);
    expect(rect.y).toBe(50);
  });

  it('比例大于原图宽高比时以高为基准收缩', () => {
    const rect = calcRatioCrop({ width: 100, height: 100 }, 2, 1);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(50);
  });
});

describe('calcCenterCrop', () => {
  it('目标尺寸在原图内：居中裁剪', () => {
    expect(calcCenterCrop({ width: 100, height: 100 }, { width: 40, height: 20 })).toEqual({ x: 30, y: 40, width: 40, height: 20 });
  });

  it('目标尺寸超出原图：收缩到原图尺寸', () => {
    expect(calcCenterCrop({ width: 100, height: 100 }, { width: 300, height: 50 })).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });
});
