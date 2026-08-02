import {
  areFramesEquivalent,
  findVerticalFrameMatch,
  type FrameMatchOptions,
  type PixelFrame,
} from './longScreenshotStitch';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class LongCaptureRecoverableError<Frame> extends Error {
  constructor(
    message: string,
    public readonly frames: Frame[],
    public readonly overlaps: number[],
  ) {
    super(message);
    this.name = 'LongCaptureRecoverableError';
  }
}

export class LongCaptureAlignmentError<Frame> extends LongCaptureRecoverableError<Frame> {
  constructor(frames: Frame[], overlaps: number[]) {
    super('无法可靠对齐相邻画面', frames, overlaps);
    this.name = 'LongCaptureAlignmentError';
  }
}

export interface AutoLongCaptureDependencies<Frame> {
  captureInitial: () => Promise<Frame>;
  captureAfterScroll: () => Promise<Frame>;
  scroll: () => Promise<void>;
  toPixels: (frame: Frame) => PixelFrame;
  shouldStop?: () => boolean;
  onFrameAccepted?: (frameCount: number) => void;
  matchOptions?: FrameMatchOptions;
  maxFrames?: number;
  /** Maximum decoded RGBA pixels retained while assembling the long capture. */
  maxCapturedPixels?: number;
}

export interface AutoLongCaptureResult<Frame> {
  frames: Frame[];
  overlaps: number[];
  endedBy: 'bottom' | 'cancelled';
}

export async function runAutoLongCapture<Frame>(
  dependencies: AutoLongCaptureDependencies<Frame>,
): Promise<AutoLongCaptureResult<Frame>> {
  const maxFrames = dependencies.maxFrames ?? 500;
  const maxCapturedPixels = dependencies.maxCapturedPixels ?? 64_000_000;
  const initial = (await dependencies.captureInitial()) as Frame;
  const initialPixels = dependencies.toPixels(initial);
  const frames: Frame[] = [initial];
  const overlaps: number[] = [];
  let capturedPixels = initialPixels.width * initialPixels.height;

  if (capturedPixels > maxCapturedPixels) {
    throw new LongCaptureRecoverableError('框选区域过大，已达到安全内存上限', frames, overlaps);
  }

  for (let index = 1; index < maxFrames; index += 1) {
    if (dependencies.shouldStop?.()) return { frames, overlaps, endedBy: 'cancelled' };
    try {
      await dependencies.scroll();
    } catch (error) {
      throw new LongCaptureRecoverableError(errorMessage(error), frames, overlaps);
    }
    if (dependencies.shouldStop?.()) return { frames, overlaps, endedBy: 'cancelled' };

    let next: Frame;
    try {
      next = await dependencies.captureAfterScroll();
    } catch (error) {
      throw new LongCaptureRecoverableError(errorMessage(error), frames, overlaps);
    }
    if (dependencies.shouldStop?.()) return { frames, overlaps, endedBy: 'cancelled' };
    const previousPixels = dependencies.toPixels(frames[frames.length - 1]);
    const nextPixels = dependencies.toPixels(next);
    if (areFramesEquivalent(previousPixels, nextPixels)) return { frames, overlaps, endedBy: 'bottom' };

    const match = findVerticalFrameMatch(previousPixels, nextPixels, dependencies.matchOptions);
    if (!match) throw new LongCaptureAlignmentError(frames, overlaps);

    const nextPixelCount = nextPixels.width * nextPixels.height;
    if (capturedPixels + nextPixelCount > maxCapturedPixels) {
      throw new LongCaptureRecoverableError('内容过长，已达到安全内存上限', frames, overlaps);
    }

    frames.push(next);
    overlaps.push(match.overlap);
    capturedPixels += nextPixelCount;
    dependencies.onFrameAccepted?.(frames.length);
  }

  throw new LongCaptureRecoverableError(`长截图超过 ${maxFrames} 段上限`, frames, overlaps);
}
