import { describe, expect, it, vi } from 'vitest';
import type { PixelFrame } from '@/tools/graphic/screenshot/longScreenshotStitch';
import {
  LongCaptureAlignmentError,
  LongCaptureRecoverableError,
  runAutoLongCapture,
} from '@/tools/graphic/screenshot/autoLongCaptureRunner';

function frameFromRows(rows: number[]): PixelFrame {
  const width = 4;
  const data = new Uint8ClampedArray(width * rows.length * 4);
  rows.forEach((value, y) => {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
      data[offset + 3] = 255;
    }
  });
  return { width, height: rows.length, data };
}

describe('automatic long capture runner', () => {
  it('stops at the page bottom without adding the duplicated final frame', async () => {
    const first = frameFromRows([10, 20, 30, 40, 50, 60]);
    const second = frameFromRows([40, 50, 60, 70, 80, 90]);
    const captureAfterScroll = vi.fn().mockResolvedValueOnce(second).mockResolvedValueOnce(second);
    const scroll = vi.fn().mockResolvedValue(undefined);

    const result = await runAutoLongCapture({
      captureInitial: async () => first,
      captureAfterScroll,
      scroll,
      toPixels: (frame) => frame,
      matchOptions: { minOverlap: 2, maxOverlap: 4 },
    });

    expect(result.frames).toEqual([first, second]);
    expect(result.overlaps).toEqual([3]);
    expect(result.endedBy).toBe('bottom');
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it('retains verified frames when the next screen cannot be aligned safely', async () => {
    const first = frameFromRows([10, 20, 30, 40, 50, 60]);
    const second = frameFromRows([40, 50, 60, 70, 80, 90]);
    const unrelated = frameFromRows([180, 181, 182, 183, 184, 185]);

    await expect(runAutoLongCapture({
      captureInitial: async () => first,
      captureAfterScroll: vi.fn().mockResolvedValueOnce(second).mockResolvedValueOnce(unrelated),
      scroll: vi.fn().mockResolvedValue(undefined),
      toPixels: (frame) => frame,
      matchOptions: { minOverlap: 2, maxOverlap: 4 },
    })).rejects.toMatchObject({
      name: 'LongCaptureAlignmentError',
      frames: [first, second],
      overlaps: [3],
    } satisfies Partial<LongCaptureAlignmentError<PixelFrame>>);
  });

  it('cancels after a stability capture instead of mistaking that frame for the bottom', async () => {
    const first = frameFromRows([10, 20, 30, 40]);
    let cancelled = false;

    const result = await runAutoLongCapture({
      captureInitial: async () => first,
      captureAfterScroll: async () => {
        cancelled = true;
        return first;
      },
      scroll: vi.fn().mockResolvedValue(undefined),
      toPixels: (frame) => frame,
      shouldStop: () => cancelled,
    });

    expect(result).toMatchObject({ frames: [first], overlaps: [], endedBy: 'cancelled' });
  });

  it('keeps verified frames when scrolling fails because the target lost focus', async () => {
    const first = frameFromRows([10, 20, 30, 40]);

    await expect(runAutoLongCapture({
      captureInitial: async () => first,
      captureAfterScroll: vi.fn(),
      scroll: async () => { throw new Error('目标窗口已失焦'); },
      toPixels: (frame) => frame,
    })).rejects.toMatchObject({
      name: 'LongCaptureRecoverableError',
      frames: [first],
      overlaps: [],
      message: '目标窗口已失焦',
    } satisfies Partial<LongCaptureRecoverableError<PixelFrame>>);
  });

  it('stops before memory growth becomes unsafe while preserving every verified frame', async () => {
    const first = frameFromRows([10, 20, 30, 40, 50, 60]);
    const second = frameFromRows([40, 50, 60, 70, 80, 90]);

    await expect(runAutoLongCapture({
      captureInitial: async () => first,
      captureAfterScroll: vi.fn().mockResolvedValue(second),
      scroll: vi.fn().mockResolvedValue(undefined),
      toPixels: (frame) => frame,
      matchOptions: { minOverlap: 2, maxOverlap: 4 },
      maxCapturedPixels: first.width * first.height,
    })).rejects.toMatchObject({
      name: 'LongCaptureRecoverableError',
      frames: [first],
      overlaps: [],
    } satisfies Partial<LongCaptureRecoverableError<PixelFrame>>);
  });
});
