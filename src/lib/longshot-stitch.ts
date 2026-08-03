/**
 * 长截图拼接算法
 *
 * 原理：连拍得到的相邻帧之间存在垂直重叠区。将帧降采样为小尺寸灰度图后，
 * 在重叠范围内做 SAD（绝对差和）模板匹配，找出下一帧相对上一帧的垂直位移 dy。
 * 对齐失败（无重叠 / 页面未滚动产生的重复帧）的帧会被丢弃。
 */

/** 降采样灰度图 */
export interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

/** 对齐用的降采样宽度（高度按帧宽高比等比缩放） */
export const ALIGN_SAMPLE_WIDTH = 160;

/** 匹配成功的平均绝对误差阈值（0-255 灰度） */
export const MATCH_SAD_THRESHOLD = 6.0;

/** 视为同一帧（页面未滚动）的平均绝对误差阈值 */
export const IDENTICAL_SAD_THRESHOLD = 0.75;

/** 候选偏移容忍带：SAD 在最优值 + 该范围内均视为合格候选 */
const CANDIDATE_EPSILON = 1.5;

/** 重叠搜索范围（占帧高比例） */
const MIN_OVERLAP_RATIO = 0.05;
const MAX_OVERLAP_RATIO = 0.9;

/** 两帧是否完全相同（未滚动） */
export function framesIdentical(a: GrayImage, b: GrayImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const mean = meanAbsDiff(a.data, 0, b.data, 0, a.data.length);
  return mean < IDENTICAL_SAD_THRESHOLD;
}

/**
 * 在 prev 底部 / next 顶部之间搜索垂直位移。
 * 返回 dy（next 相对 prev 向下滚动的像素数，小图坐标系）与匹配 SAD；
 * 无合格匹配时返回 null。
 */
export function findVerticalOffset(
  prev: GrayImage,
  next: GrayImage,
): { dy: number; sad: number } | null {
  if (prev.width !== next.width || prev.height !== next.height) return null;
  const { width, height } = prev;
  const minOverlap = Math.max(2, Math.round(height * MIN_OVERLAP_RATIO));
  const maxOverlap = Math.max(minOverlap, Math.round(height * MAX_OVERLAP_RATIO));

  let bestSad = Infinity;
  // 合格候选中保留最大重叠（dy 最小），重复纹理场景下优先避免丢内容
  let bestDy = -1;

  for (let overlap = minOverlap; overlap <= maxOverlap; overlap++) {
    // prev 的 [height - overlap, height) 行 对应 next 的 [0, overlap) 行
    const prevStart = (height - overlap) * width;
    const sad = meanAbsDiff(prev.data, prevStart, next.data, 0, overlap * width);
    if (sad < bestSad - CANDIDATE_EPSILON) {
      bestSad = sad;
      bestDy = height - overlap;
    } else if (sad <= bestSad + CANDIDATE_EPSILON && bestDy >= 0 && height - overlap < bestDy) {
      bestDy = height - overlap;
    }
  }

  if (bestDy < 0 || bestSad > MATCH_SAD_THRESHOLD) return null;
  return { dy: bestDy, sad: bestSad };
}

/**
 * 对一组等尺寸灰度帧规划拼接：返回每个被采纳帧相对上一个采纳帧的 dy，
 * 以及被丢弃帧的下标列表。
 */
export function planStitch(frames: GrayImage[]): {
  offsets: number[];
  droppedIndices: number[];
} {
  const offsets: number[] = [];
  const droppedIndices: number[] = [];
  if (frames.length === 0) return { offsets, droppedIndices };

  offsets.push(0);
  let prevIdx = 0;
  for (let i = 1; i < frames.length; i++) {
    if (framesIdentical(frames[prevIdx], frames[i])) {
      droppedIndices.push(i);
      continue;
    }
    const match = findVerticalOffset(frames[prevIdx], frames[i]);
    if (!match) {
      droppedIndices.push(i);
      continue;
    }
    offsets.push(match.dy);
    prevIdx = i;
  }
  return { offsets, droppedIndices };
}

/** 计算拼接布局：总高度与每个采纳帧的 y 位置（原图坐标系） */
export function computeStitchLayout(
  frameHeight: number,
  offsets: number[],
  sampleHeight: number,
): { totalHeight: number; ys: number[] } {
  if (offsets.length === 0) return { totalHeight: 0, ys: [] };
  const scale = sampleHeight > 0 ? frameHeight / sampleHeight : 1;
  const ys: number[] = [];
  let y = 0;
  for (let i = 0; i < offsets.length; i++) {
    if (i > 0) y += offsets[i] * scale;
    ys.push(Math.round(y));
  }
  return { totalHeight: Math.round(ys[ys.length - 1] + frameHeight), ys };
}

/** 将 ImageBitmap 转为降采样灰度图 */
export function frameToGray(
  frame: ImageBitmap,
  targetWidth: number = ALIGN_SAMPLE_WIDTH,
): GrayImage {
  const width = Math.max(2, Math.min(targetWidth, frame.width));
  const height = Math.max(2, Math.round((frame.height * width) / frame.width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('无法创建 canvas 上下文');
  ctx.drawImage(frame, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    // ITU-R BT.601 亮度
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { data: gray, width, height };
}

export interface StitchResult {
  canvas: HTMLCanvasElement;
  droppedCount: number;
}

/**
 * 拼接全部连拍帧（等尺寸）。
 * 对齐失败的帧被丢弃；返回原分辨率拼接画布与丢弃帧数。
 */
export async function stitchLongshot(frames: ImageBitmap[]): Promise<StitchResult> {
  if (frames.length === 0) throw new Error('没有可拼接的帧');
  if (frames.length === 1) {
    const canvas = document.createElement('canvas');
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    canvas.getContext('2d')!.drawImage(frames[0], 0, 0);
    return { canvas, droppedCount: 0 };
  }

  const grays = frames.map((f) => frameToGray(f));
  const sampleHeight = grays[0].height;
  const { offsets, droppedIndices } = planStitch(grays);

  // 采纳帧与原偏移（相对上一采纳帧，小图坐标 → 原图坐标）
  const accepted: ImageBitmap[] = [];
  const fullDy: number[] = [];
  let di = 0;
  for (let i = 0; i < frames.length; i++) {
    if (di < droppedIndices.length && droppedIndices[di] === i) {
      di++;
      continue;
    }
    accepted.push(frames[i]);
    fullDy.push(offsets[accepted.length - 1]);
  }

  const scale = frames[0].height / sampleHeight;
  const ys: number[] = [];
  let y = 0;
  for (let i = 0; i < accepted.length; i++) {
    if (i > 0) y += fullDy[i] * scale;
    ys.push(Math.round(y));
  }
  const totalHeight = Math.round(ys[ys.length - 1] + frames[0].height);

  const canvas = document.createElement('canvas');
  canvas.width = frames[0].width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  accepted.forEach((frame, i) => ctx.drawImage(frame, 0, ys[i]));

  return { canvas, droppedCount: droppedIndices.length };
}

function meanAbsDiff(
  a: Float32Array,
  aStart: number,
  b: Float32Array,
  bStart: number,
  count: number,
): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += Math.abs(a[aStart + i] - b[bStart + i]);
  }
  return sum / count;
}
