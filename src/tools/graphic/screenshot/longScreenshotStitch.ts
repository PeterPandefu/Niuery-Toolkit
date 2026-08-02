export interface PixelFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface FrameMatch {
  overlap: number;
  similarity: number;
}

export interface FrameMatchOptions {
  minOverlap?: number;
  maxOverlap?: number;
  minSimilarity?: number;
}

export interface StitchFrameSize {
  width: number;
  height: number;
}

export interface StitchSegment {
  sourceIndex: number;
  sourceY: number;
  height: number;
  destinationY: number;
}

export interface VerticalStitchPlan {
  width: number;
  height: number;
  rawWidth: number;
  rawHeight: number;
  scale: number;
  segments: StitchSegment[];
}

export function areFramesEquivalent(previous: PixelFrame, next: PixelFrame, channelTolerance = 0): boolean {
  if (previous.width !== next.width || previous.height !== next.height) return false;
  const xStep = Math.max(1, Math.floor(previous.width / 96));
  const yStep = Math.max(1, Math.floor(previous.height / 96));

  for (let y = 0; y < previous.height; y += yStep) {
    for (let x = 0; x < previous.width; x += xStep) {
      const offset = (y * previous.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        if (Math.abs(previous.data[offset + channel] - next.data[offset + channel]) > channelTolerance) return false;
      }
    }
  }

  return true;
}

export function createVerticalStitchPlan(
  frames: StitchFrameSize[],
  overlaps: number[],
  maxOutputHeight: number,
): VerticalStitchPlan {
  if (frames.length === 0) throw new Error('至少需要一帧截图');
  if (overlaps.length !== Math.max(0, frames.length - 1)) throw new Error('帧重叠信息不完整');
  if (maxOutputHeight < 1) throw new Error('最大输出高度必须大于零');

  const rawWidth = frames[0].width;
  if (rawWidth < 1 || frames[0].height < 1) throw new Error('截图尺寸无效');

  const segments: StitchSegment[] = [];
  let rawHeight = 0;

  frames.forEach((frame, sourceIndex) => {
    if (frame.width !== rawWidth || frame.height < 1) throw new Error('截图尺寸不一致');
    const sourceY = sourceIndex === 0 ? 0 : Math.max(0, Math.min(frame.height - 1, Math.round(overlaps[sourceIndex - 1])));
    const height = frame.height - sourceY;
    segments.push({ sourceIndex, sourceY, height, destinationY: rawHeight });
    rawHeight += height;
  });

  const scale = Math.min(1, maxOutputHeight / rawHeight);
  return {
    width: Math.max(1, Math.round(rawWidth * scale)),
    height: Math.max(1, Math.round(rawHeight * scale)),
    rawWidth,
    rawHeight,
    scale,
    segments,
  };
}

function overlapSimilarity(previous: PixelFrame, next: PixelFrame, overlap: number): number {
  let error = 0;
  let samples = 0;
  const xStep = Math.max(1, Math.floor(previous.width / 96));
  const yStep = Math.max(1, Math.floor(overlap / 96));

  for (let y = 0; y < overlap; y += yStep) {
    const previousY = previous.height - overlap + y;
    for (let x = 0; x < previous.width; x += xStep) {
      const previousOffset = (previousY * previous.width + x) * 4;
      const nextOffset = (y * next.width + x) * 4;
      error += Math.abs(previous.data[previousOffset] - next.data[nextOffset]);
      error += Math.abs(previous.data[previousOffset + 1] - next.data[nextOffset + 1]);
      error += Math.abs(previous.data[previousOffset + 2] - next.data[nextOffset + 2]);
      samples += 3;
    }
  }

  return samples === 0 ? 0 : 1 - error / (samples * 255);
}

export function findVerticalFrameMatch(
  previous: PixelFrame,
  next: PixelFrame,
  options: FrameMatchOptions = {},
): FrameMatch | null {
  if (previous.width !== next.width || previous.height < 2 || next.height < 2) return null;

  // A user can scroll by only one line at a time, so an almost-complete
  // viewport overlap is valid. Search the full possible range unless the
  // caller deliberately narrows it.
  const minOverlap = Math.max(1, Math.min(previous.height - 1, options.minOverlap ?? 1));
  const maxOverlap = Math.max(minOverlap, Math.min(previous.height - 1, options.maxOverlap ?? previous.height - 1));
  const minSimilarity = options.minSimilarity ?? 0.72;
  let best: FrameMatch | null = null;

  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += 1) {
    const similarity = overlapSimilarity(previous, next, overlap);
    if (!best || similarity > best.similarity) best = { overlap, similarity };
  }

  return best && best.similarity >= minSimilarity ? best : null;
}
