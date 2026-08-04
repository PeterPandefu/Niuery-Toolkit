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

  it('自动滚轮的小步滚动即使重叠超过视口 90% 也能对齐', () => {
    const frameHeight = 400;
    const dy = 24;
    const f1 = makeFrame(W, frameHeight, patternRow(12));
    const f2 = makeFrame(W, frameHeight, (row) => patternRow(12)(row + dy));
    const match = findVerticalOffset(f1, f2);
    expect(match).not.toBeNull();
    expect(match!.dy).toBe(dy);
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

describe('重复纹理场景（稳健化门控）', () => {
  /** 模拟代码类内容：每 8 行一个结构相同的块，块间行灰度不同 */
  function blockContent(seed: number): (row: number) => number {
    return (row) => {
      const block = Math.floor(row / 8) + 1 + seed;
      const line = (row % 8) + 1;
      let h = Math.imul(block, 374761393) ^ Math.imul(line, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = h ^ (h >>> 16);
      return Math.abs(h) % 251;
    };
  }

  it('结构相似但内容不同的重复块不会误判偏移', () => {
    const dy = 16;
    const f1 = makeFrame(W, H, blockContent(1));
    const f2 = makeFrame(W, H, (row) => blockContent(1)(row + dy));
    const match = findVerticalOffset(f1, f2);
    expect(match).not.toBeNull();
    expect(match!.dy).toBe(dy);
  });

  it('重叠区内含空白段仍能找到真实偏移', () => {
    const content = (row: number) => {
      if (row >= 20 && row < 30) return 250; // 空白段
      return patternRow(11)(row);
    };
    const dy = 20;
    const f1 = makeFrame(W, 60, content);
    const f2 = makeFrame(W, 60, (row) => content(row + dy));
    const match = findVerticalOffset(f1, f2);
    expect(match).not.toBeNull();
    expect(match!.dy).toBe(dy);
  });

  it('inlier 占比不足（局部内容变化）时保守丢弃', () => {
    const dy = 10;
    const f1 = makeFrame(W, H, patternRow(21));
    // 20% 的行发生内容变化（如动画/光标），超过离群容忍 10%
    const f2 = makeFrame(W, H, (row) => {
      const base = patternRow(21)(row + dy);
      return row % 5 === 0 ? (base + 100) % 251 : base;
    });
    expect(findVerticalOffset(f1, f2)).toBeNull();
  });
});

describe('时间连续性先验', () => {
  it('hint 窗口内含真实偏移时直接命中', () => {
    const dy = 10;
    const f1 = makeFrame(W, H, patternRow(40));
    const f2 = makeFrame(W, H, (row) => patternRow(40)(row + dy));
    const match = findVerticalOffset(f1, f2, { dy: 10, tol: 0.3 });
    expect(match).not.toBeNull();
    expect(match!.dy).toBe(dy);
  });

  it('hint 窗口偏离真实偏移时回退全范围，不致盲', () => {
    const dy = 10;
    const f1 = makeFrame(W, H, patternRow(41));
    const f2 = makeFrame(W, H, (row) => patternRow(41)(row + dy));
    // hint 指向 25，窗口 [19,31] 不含 10 → 回退全范围仍找到真实 dy
    const match = findVerticalOffset(f1, f2, { dy: 25, tol: 0.1 });
    expect(match).not.toBeNull();
    expect(match!.dy).toBe(dy);
  });

  it('周期纹理下 hint 消除全范围最大重叠误判', () => {
    // 完全周期（周期 8）的内容：全范围会取最大重叠 dy=8，真实 dy=16
    const periodic = (row: number) => patternRow(4)(row % 8);
    const f1 = makeFrame(W, H, periodic);
    const f2 = makeFrame(W, H, (row) => periodic(row + 16));
    expect(findVerticalOffset(f1, f2)!.dy).toBe(8);
    const hinted = findVerticalOffset(f1, f2, { dy: 16, tol: 0.2 });
    expect(hinted!.dy).toBe(16);
  });

  it('planStitch 速度突变时回退全范围仍对齐', () => {
    const f1 = makeFrame(W, H, patternRow(30));
    const f2 = makeFrame(W, H, (row) => patternRow(30)(row + 10));
    const f3 = makeFrame(W, H, (row) => patternRow(30)(row + 20));
    const f4 = makeFrame(W, H, (row) => patternRow(30)(row + 44)); // 突变 dy=24
    const { offsets, droppedIndices } = planStitch([f1, f2, f3, f4]);
    expect(droppedIndices).toEqual([]);
    expect(offsets).toEqual([0, 10, 10, 24]);
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
