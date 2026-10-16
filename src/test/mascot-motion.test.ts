import { describe, expect, it } from 'vitest';
import { driftDuration, stepDrift, stepFall, stepFloat } from '@/lib/mascot-motion';

describe('吉祥物掉落和上飘', () => {
  it('松开后会落到区域最下端', () => {
    let y = -40;
    let velocity = 0;
    let landed = false;
    for (let i = 0; i < 80 && !landed; i += 1) {
      const next = stepFall(y, velocity, 90, 1 / 60);
      y = next.y;
      velocity = next.velocity;
      landed = next.landed;
    }
    expect(landed).toBe(true);
    expect(y).toBe(90);
  });

  it('不会掉过地板', () => {
    expect(stepFall(80, 400, 90, 1 / 30)).toMatchObject({ y: 90, landed: true });
  });

  it('太久没人理会就向天花板飘，并且停在天花板下', () => {
    let y = 90;
    let arrived = false;
    for (let i = 0; i < 400 && !arrived; i += 1) {
      const next = stepFloat(y, -30, 1 / 60);
      y = next.y;
      arrived = next.arrived;
    }
    expect(arrived).toBe(true);
    expect(y).toBe(-30);
  });

  it('炸裂后左右摇晃并平滑落到地板，落地时不再横移', () => {
    const duration = driftDuration(120);
    const start = stepDrift(-30, 90, 0, duration, 24);
    const mid = stepDrift(-30, 90, duration / 2, duration, 24);
    const end = stepDrift(-30, 90, duration, duration, 24);

    expect(start.y).toBeCloseTo(-30, 4);
    expect(start.x).toBeCloseTo(0, 4);
    expect(mid.y).toBeGreaterThan(start.y);
    expect(mid.y).toBeLessThan(90);
    expect(Math.abs(mid.x)).toBeGreaterThan(0);
    expect(end.done).toBe(true);
    expect(end.y).toBeCloseTo(90, 4);
    expect(end.x).toBeCloseTo(0, 4);
  });
});
