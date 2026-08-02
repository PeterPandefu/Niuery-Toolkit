import { describe, expect, it } from 'vitest';
import {
  areFramesEquivalent,
  createVerticalStitchPlan,
  findVerticalFrameMatch,
  type PixelFrame,
} from '@/tools/graphic/screenshot/longScreenshotStitch';

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
    }
  });
  return { width, height: rows.length, data };
}

describe('long screenshot stitching', () => {
  it('finds the actual vertical overlap instead of using a fixed percentage', () => {
    const previous = frameFromRows([10, 20, 30, 40, 50, 60]);
    const next = frameFromRows([40, 50, 60, 70, 80, 90]);

    expect(findVerticalFrameMatch(previous, next, { minOverlap: 2, maxOverlap: 4 })).toMatchObject({
      overlap: 3,
    });
  });

  it('recognizes small scroll steps whose overlap is nearly an entire viewport', () => {
    const previous = frameFromRows(Array.from({ length: 100 }, (_, index) => index));
    const next = frameFromRows(Array.from({ length: 100 }, (_, index) => index + 1));

    expect(findVerticalFrameMatch(previous, next)).toMatchObject({ overlap: 99 });
  });

  it('treats an unchanged capture as the end of the scrollable content', () => {
    const frame = frameFromRows([10, 20, 30, 40]);

    expect(areFramesEquivalent(frame, frameFromRows([10, 20, 30, 40]))).toBe(true);
    expect(areFramesEquivalent(frame, frameFromRows([10, 20, 31, 40]))).toBe(false);
  });

  it('scales a too-tall capture while retaining every non-overlapping row in one image', () => {
    const plan = createVerticalStitchPlan(
      [
        { width: 100, height: 80 },
        { width: 100, height: 80 },
      ],
      [20],
      100,
    );

    expect(plan).toMatchObject({ rawHeight: 140, width: 71, height: 100 });
    expect(plan.segments).toEqual([
      { sourceIndex: 0, sourceY: 0, height: 80, destinationY: 0 },
      { sourceIndex: 1, sourceY: 20, height: 60, destinationY: 80 },
    ]);
  });
});
