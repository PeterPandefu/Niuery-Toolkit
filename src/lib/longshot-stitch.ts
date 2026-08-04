/**
 * 长截图拼接算法
 *
 * 原理：连拍得到的相邻帧之间存在垂直重叠区。将帧横向降采样为灰度图、
 * 同时保留原始纵向分辨率后，
 * 在重叠范围内逐行计算误差，用稳健统计做严格门控：
 * 只有「inlier 行占比 ≥ MIN_INLIER_RATIO 且 inlier 平均误差 ≤ MATCH_SAD_THRESHOLD」
 * 的重叠才视为对齐成功，通过门控的候选中取最大重叠（最小 dy）。
 *
 * 该设计针对代码等重复纹理场景：错位的相似行会表现为离群行被门控拦截，
 * 避免旧版「平均 SAD + 容忍带 + 最大重叠优先」在重复纹理下高估重叠、
 * 导致合成结果内容重复的问题。对齐失败（无重叠 / 歧义）的帧会被丢弃。
 */

/** 降采样灰度图 */
export interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

/** 对齐用的降采样宽度（高度按帧宽高比等比缩放）；越宽行判别力越强 */
export const ALIGN_SAMPLE_WIDTH = 320;

/** 拼接用的横向采样宽度；纵向保留原始分辨率，避免滚动距离量化误差累积 */
const FINE_ALIGN_SAMPLE_WIDTH = 160;

/** 匹配成功的 inlier 平均绝对误差阈值（0-255 灰度） */
export const MATCH_SAD_THRESHOLD = 6.0;

/** 单行视为 inlier 的平均绝对误差阈值（0-255 灰度） */
export const ROW_INLIER_TAU = 12.0;

/** 对齐成功所需的最小 inlier 行占比（严格门控，重复纹理下宁丢帧不误配） */
export const MIN_INLIER_RATIO = 0.9;

/** 视为同一帧（页面未滚动）的平均绝对误差阈值 */
export const IDENTICAL_SAD_THRESHOLD = 0.75;

/** 最小重叠范围（占帧高比例） */
const MIN_OVERLAP_RATIO = 0.05;

/** dy 历史一致性阈值（相对偏差）：相邻两次采纳 dy 偏差小于该比例才启用连续性先验 */
export const HISTORY_CONSIST_RATIO = 0.2;

/** 先验搜索窗在比例容差之外再加的绝对边距（小图行数），覆盖取整与轻微速度变化 */
export const HINT_MARGIN_ROWS = 4;

/** 时间连续性先验：以历史 dy 中位数收窄搜索窗 */
export interface DyHint {
  /** 历史 dy 中位数（小图坐标系） */
  dy: number;
  /** 比例容差：搜索窗为 dy ± (dy*tol + HINT_MARGIN_ROWS) */
  tol: number;
}

/** 两帧是否完全相同（未滚动） */
export function framesIdentical(a: GrayImage, b: GrayImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const mean = meanAbsDiff(a.data, 0, b.data, 0, a.data.length);
  return mean < IDENTICAL_SAD_THRESHOLD;
}

/**
 * 在 prev 底部 / next 顶部之间搜索垂直位移。
 * 对每个候选重叠逐行计算误差并做严格门控（inlier 占比 + inlier 平均误差），
 * 通过门控的候选中取最大重叠（最小 dy），延续「不丢内容」初衷。
 * 提供 hint（时间连续性先验）时先在收窄窗口内搜索，命中即返回；
 * 窗口内无合格匹配再回退全范围门控搜索，保证先验只降噪不致盲。
 * 返回 dy（next 相对 prev 向下滚动的像素数，小图坐标系）与 inlier 平均误差；
 * 无合格匹配时返回 null。
 */
export function findVerticalOffset(
  prev: GrayImage,
  next: GrayImage,
  hint?: DyHint | null,
): { dy: number; sad: number } | null {
  if (prev.width !== next.width || prev.height !== next.height) return null;
  const { height } = prev;
  if (height < 3) return null;
  const minOverlap = Math.min(height - 1, Math.max(2, Math.round(height * MIN_OVERLAP_RATIO)));
  // 一格滚轮通常只移动三行文本，重叠可能超过视口的 90%。重复帧已在
  // framesIdentical 中过滤，因此这里必须允许搜索到仅移动一个采样行的位置。
  const maxOverlap = height - 1;

  if (hint && hint.dy > 0) {
    const margin = Math.round(hint.dy * hint.tol) + HINT_MARGIN_ROWS;
    const dyLo = Math.max(1, hint.dy - margin);
    const dyHi = hint.dy + margin;
    // overlap = height - dy，dy 窗映射为 overlap 窗并夹紧
    const lo = Math.max(minOverlap, height - dyHi);
    const hi = Math.min(maxOverlap, height - dyLo);
    if (lo <= hi) {
      const hit = scanOverlapRange(prev, next, lo, hi);
      if (hit) return hit;
    }
  }
  return scanOverlapRange(prev, next, minOverlap, maxOverlap);
}

/** 在 [overlapLo, overlapHi] 内升序扫描，返回通过门控的最大重叠（最小 dy） */
function scanOverlapRange(
  prev: GrayImage,
  next: GrayImage,
  overlapLo: number,
  overlapHi: number,
): { dy: number; sad: number } | null {
  const { width, height } = prev;
  let bestDy = -1;
  let bestSad = Infinity;

  // overlap 升序（dy 降序）遍历，后通过门控者覆盖前者 → 最终为最大重叠
  for (let overlap = overlapLo; overlap <= overlapHi; overlap++) {
    const maxOutliers = Math.floor((1 - MIN_INLIER_RATIO) * overlap);
    const prevBase = (height - overlap) * width;
    let outliers = 0;
    let inliers = 0;
    let inlierErr = 0;
    let aborted = false;

    for (let r = 0; r < overlap; r++) {
      const rowErr = meanAbsDiff(
        prev.data, prevBase + r * width,
        next.data, r * width,
        width,
      );
      if (rowErr <= ROW_INLIER_TAU) {
        inliers++;
        inlierErr += rowErr;
      } else if (++outliers > maxOutliers) {
        // 离群行已超限，该重叠不可能通过门控，提前终止
        aborted = true;
        break;
      }
    }

    if (aborted || inliers === 0) continue;
    const meanInlier = inlierErr / inliers;
    if (meanInlier > MATCH_SAD_THRESHOLD) continue;

    bestDy = height - overlap;
    bestSad = meanInlier;
  }

  if (bestDy < 0) return null;
  return { dy: bestDy, sad: bestSad };
}

/** 由最近采纳的 dy 序列构建连续性先验；历史不足或不一致时返回 null */
function buildHint(recent: number[], tol: number): DyHint | null {
  if (recent.length < 2) return null;
  const a = recent[recent.length - 1];
  const b = recent[recent.length - 2];
  if (Math.abs(a - b) > HISTORY_CONSIST_RATIO * Math.max(a, b, 1)) return null;
  const sorted = [...recent].sort((x, y) => x - y);
  return { dy: sorted[Math.floor(sorted.length / 2)], tol };
}

/**
 * 对一组等尺寸灰度帧规划拼接：返回每个被采纳帧相对上一个采纳帧的 dy，
 * 以及被丢弃帧的下标列表。
 */
export function planStitch(
  frames: GrayImage[],
  hintTol = 0.6,
): {
  offsets: number[];
  droppedIndices: number[];
} {
  const offsets: number[] = [];
  const droppedIndices: number[] = [];
  if (frames.length === 0) return { offsets, droppedIndices };

  offsets.push(0);
  let prevIdx = 0;
  const recent: number[] = [];
  let hint: DyHint | null = null;
  for (let i = 1; i < frames.length; i++) {
    if (framesIdentical(frames[prevIdx], frames[i])) {
      droppedIndices.push(i);
      continue;
    }
    const match = findVerticalOffset(frames[prevIdx], frames[i], hint);
    if (!match) {
      droppedIndices.push(i);
      continue;
    }
    offsets.push(match.dy);
    prevIdx = i;
    recent.push(match.dy);
    if (recent.length > 4) recent.shift();
    hint = buildHint(recent, hintTol);
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

/** 按指定尺寸转换为灰度图 */
function frameToGraySize(frame: ImageBitmap, width: number, height: number): GrayImage {
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

/** 将 ImageBitmap 转为降采样灰度图 */
export function frameToGray(
  frame: ImageBitmap,
  targetWidth: number = ALIGN_SAMPLE_WIDTH,
): GrayImage {
  const width = Math.max(2, Math.min(targetWidth, frame.width));
  const height = Math.max(2, Math.round((frame.height * width) / frame.width));
  return frameToGraySize(frame, width, height);
}

/** 将 ImageBitmap 转为仅横向降采样、纵向保持原高的精校灰度图 */
function frameToFineGray(frame: ImageBitmap): GrayImage {
  const width = Math.max(2, Math.min(FINE_ALIGN_SAMPLE_WIDTH, frame.width));
  return frameToGraySize(frame, width, frame.height);
}

export interface StitchResult {
  canvas: HTMLCanvasElement;
  droppedCount: number;
}

/**
 * 拼接全部连拍帧（等尺寸）。
 * 对齐失败的帧被丢弃；返回原分辨率拼接画布与丢弃帧数。
 */
export async function stitchLongshot(
  frames: ImageBitmap[],
  hintTol = 0.6,
): Promise<StitchResult> {
  if (frames.length === 0) throw new Error('没有可拼接的帧');
  if (frames.length === 1) {
    const canvas = document.createElement('canvas');
    canvas.width = frames[0].width;
    canvas.height = frames[0].height;
    canvas.getContext('2d')!.drawImage(frames[0], 0, 0);
    return { canvas, droppedCount: 0 };
  }

  // 纵向必须保持原始分辨率：一格滚轮常见为 57px，若等比缩图会变成
  // 23.x 个采样行，Canvas 重采样相位会让真实重叠失配并误中重复代码块。
  const grays = frames.map((f) => frameToFineGray(f));
  const sampleHeight = grays[0].height;
  const { offsets, droppedIndices } = planStitch(grays, hintTol);

  // 采纳帧与原偏移（相对上一采纳帧；纵向未缩放，因此单位即原图像素）
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

  const frameHeight = frames[0].height;
  const { totalHeight, ys } = computeStitchLayout(frameHeight, fullDy, sampleHeight);

  const canvas = document.createElement('canvas');
  canvas.width = frames[0].width;
  canvas.height = totalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 首帧完整绘制；后续帧只追加本次滚动新露出的底部条带。
  // 不重绘重叠区，可从根本上避免静态栏、光标或动画覆盖已拼好的内容。
  const frameH = frameHeight;
  accepted.forEach((frame, i) => {
    if (i === 0) {
      ctx.drawImage(frame, 0, ys[0]);
      return;
    }
    const addedHeight = ys[i] - ys[i - 1];
    const sourceY = frameH - addedHeight;
    ctx.drawImage(
      frame, 0, sourceY, frame.width, addedHeight,
      0, ys[i] + sourceY, frame.width, addedHeight,
    );
  });

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
