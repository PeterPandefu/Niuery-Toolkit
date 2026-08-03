import { describe, it, expect } from 'vitest';
import {
  type GrayImage,
  framesIdentical,
  findVerticalOffset,
  planStitch,
  computeStitchLayout,
  MATCH_SAD_THRESHOLD,
} from '@/lib/longshot-stitch';

/** 构造测试用灰度帧：每行灰度由行号函数决定（横向均匀） */
function makeFrame(width: number, height: number, rowValue: (row: number) => number): GrayImage {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = rowValue(y);
    for (let x = 0; x < width; x++) data[y * width + x] = v;
  }
  return { data, width, height };
}

/** 确定性伪随机行灰度（整数哈希，行间无相关性，避免恒定差值误匹配） */
function patternRow(seed: number): (row: number) => number {
  return (row) => {
    let h = (row + 1) * 374761393 + (seed + 1) * 668265263;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return Math.abs(h) % 251;
  };
}

const W = 8;
const H = 40;

describe('framesIdentical', () => {
  it('完全相同的帧视为未滚动', () => {
    const a = makeFrame(W, H, patternRow(3));
    const b = makeFrame(W, H, patternRow(3));
    expect(framesIdentical(a, b)).toBe(true);
  });

  it('有位移的帧不视为相同', () => {
    const a = makeFrame(W, H, patternRow(3));
    const b = makeFrame(W, H, (row) => patternRow(3)(row + 10));
    expect(framesIdentical(a, b)).toBe(false);
  });
});

describe('findVerticalOffset', () => {
  it('正确找到带重叠帧对的垂直偏移', () => {
    // frame2 的前 30 行 == frame1 的后 30 行（向下滚动 10 像素）
    const dy = 10;
    const f1 = makeFrame(W, H, patternRow(7));
    const f2 = makeFrame(W, H, (row) => patternRow(7)(row + dy));
    const match = findVerticalOffset(f1, f2);
    expect(match).not.toBeNull();
    expect(match!.dy).toBe(dy);
    expect(match!.sad).toBeLessThan(MATCH_SAD_THRESHOLD);
  });

  it('无重叠的帧返回 null（对齐失败）', () => {
    const f1 = makeFrame(W, H, patternRow(7));
    const f2 = makeFrame(W, H, patternRow(99));
    expect(findVerticalOffset(f1, f2)).toBeNull();
  });

  it('尺寸不一致返回 null', () => {
    const f1 = makeFrame(W, H, patternRow(1));
    const f2 = makeFrame(W, H + 4, patternRow(1));
    expect(findVerticalOffset(f1, f2)).toBeNull();
  });
});

describe('planStitch', () => {
  it('丢弃重复帧（未滚动）', () => {
    const f1 = makeFrame(W, H, patternRow(5));
    const fDup = makeFrame(W, H, patternRow(5));
    const f3 = makeFrame(W, H, (row) => patternRow(5)(row + 12));
    const { offsets, droppedIndices } = planStitch([f1, fDup, f3]);
    expect(droppedIndices).toEqual([1]);
    expect(offsets).toEqual([0, 12]);
  });

  it('丢弃无重叠帧', () => {
    const f1 = makeFrame(W, H, patternRow(5));
    const fOther = makeFrame(W, H, patternRow(200));
    const { offsets, droppedIndices } = planStitch([f1, fOther]);
    expect(droppedIndices).toEqual([1]);
    expect(offsets).toEqual([0]);
  });

  it('多帧拼接：偏移序列正确', () => {
    const d1 = 10;
    const d2 = 12;
    const f1 = makeFrame(W, H, patternRow(2));
    const f2 = makeFrame(W, H, (row) => patternRow(2)(row + d1));
    const f3 = makeFrame(W, H, (row) => patternRow(2)(row + d1 + d2));
    const { offsets, droppedIndices } = planStitch([f1, f2, f3]);
    expect(droppedIndices).toEqual([]);
    expect(offsets).toEqual([0, d1, d2]);
  });

  it('丢弃中间帧后继续对齐后续帧', () => {
    const f1 = makeFrame(W, H, patternRow(8));
    const fBad = makeFrame(W, H, patternRow(120)); // 无重叠
    const f3 = makeFrame(W, H, (row) => patternRow(8)(row + 15));
    const { offsets, droppedIndices } = planStitch([f1, fBad, f3]);
    expect(droppedIndices).toEqual([1]);
    expect(offsets).toEqual([0, 15]);
  });

  it('空输入', () => {
    expect(planStitch([])).toEqual({ offsets: [], droppedIndices: [] });
  });
});

describe('computeStitchLayout', () => {
  it('多帧拼接总高度正确（原图坐标）', () => {
    // 原图帧高 400，采样高 40（scale=10），偏移 [0, 10, 12]（小图坐标）
    const { totalHeight, ys } = computeStitchLayout(400, [0, 10, 12], 40);
    expect(ys).toEqual([0, 100, 220]);
    expect(totalHeight).toBe(220 + 400);
  });

  it('单帧布局', () => {
    const { totalHeight, ys } = computeStitchLayout(300, [0], 30);
    expect(ys).toEqual([0]);
    expect(totalHeight).toBe(300);
  });

  it('空偏移', () => {
    expect(computeStitchLayout(100, [], 10)).toEqual({ totalHeight: 0, ys: [] });
  });
});
