import { describe, expect, it } from 'vitest';
import { mascotCornerVisible } from '@/lib/mascot-corner';

describe('吉祥物角落', () => {
  it('贴在底部、头顶有空档时才露出来', () => {
    expect(mascotCornerVisible(640, 214, false, true)).toBe(true);
    expect(mascotCornerVisible(640, 0, false, true)).toBe(false);
    expect(mascotCornerVisible(640, 214, true, false)).toBe(false);
    expect(mascotCornerVisible(280, 40, false, false)).toBe(false);
  });
});
