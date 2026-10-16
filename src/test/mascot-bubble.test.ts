import { describe, expect, it } from 'vitest';
import { resolveBubbleShift } from '@/lib/mascot-bubble';

describe('吉祥物气泡贴边', () => {
  it('左侧被裁时向右挪，保证开头看得见', () => {
    expect(resolveBubbleShift(
      { width: 220, height: 480 },
      { left: -18, top: 40, width: 200, height: 52 },
    )).toEqual({ x: 26, y: 0 });
  });

  it('右侧被裁时向左收', () => {
    expect(resolveBubbleShift(
      { width: 220, height: 480 },
      { left: 40, top: 40, width: 200, height: 52 },
    )).toEqual({ x: -28, y: 0 });
  });

  it('比区域更宽时贴住左边', () => {
    expect(resolveBubbleShift(
      { width: 180, height: 400 },
      { left: 20, top: 12, width: 200, height: 40 },
    ).x).toBe(-12);
  });

  it('顶部被裁时往下移', () => {
    expect(resolveBubbleShift(
      { width: 240, height: 360 },
      { left: 20, top: -12, width: 160, height: 48 },
    )).toEqual({ x: 0, y: 20 });
  });
});
