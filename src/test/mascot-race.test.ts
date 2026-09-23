import { describe, expect, it } from 'vitest';
import { createRace, raceCheer, racePlayerBox, raceScore, stepRace, type RaceInput } from '@/lib/mascot-race';

const still: RaceInput = { pointerX: null, left: false, right: false };

describe('冲栏', () => {
  it('把栏杆往下送，并始终留出能躲开的空隙', () => {
    let state = createRace(220);
    for (let step = 0; step < 80 && state.obstacles.length === 0; step += 1) {
      state = stepRace(state, 0.034, still, 220, 360, () => 0);
    }
    const rail = state.obstacles[0];
    expect(rail).toBeDefined();
    expect(rail.kind).toBe('rail');
    expect(rail.w).toBeLessThanOrEqual(220 * 0.42);
    expect(rail.x).toBeGreaterThanOrEqual(10);
    expect(rail.x + rail.w).toBeLessThanOrEqual(210);
    expect(220 - rail.w).toBeGreaterThanOrEqual(48);

    const later = stepRace(state, 0.034, still, 220, 360, () => 0);
    expect(later.obstacles.find((item) => item.id === rail.id)?.y).toBeGreaterThan(rail.y);
    expect(raceScore(later)).toBeGreaterThan(0);
  });

  it('跟着指针走，但不会冲出赛道', () => {
    const start = createRace(220);
    const next = stepRace(start, 0.05, { pointerX: 4, left: false, right: false }, 220, 360, () => 0);
    expect(next.playerX).toBeLessThan(start.playerX);
    expect(next.playerX).toBeGreaterThanOrEqual(27);
  });

  it('撞上栏杆就结束，擦边则继续', () => {
    const start = createRace(220);
    const player = racePlayerBox(start.playerX, 360);
    const dead = stepRace({
      ...start,
      spawnIn: 9999,
      obstacles: [{ id: 7, x: player.x - 6, y: player.y - 4, w: player.w + 16, h: player.h + 12, kind: 'rail' }],
    }, 0.016, still, 220, 360, () => 0);
    expect(dead.alive).toBe(false);
    expect(stepRace(dead, 0.016, still, 220, 360, () => 0)).toBe(dead);

    const missed = stepRace({
      ...start,
      spawnIn: 9999,
      obstacles: [{ id: 8, x: 10, y: player.y, w: 18, h: 12, kind: 'bale' }],
    }, 0.016, still, 220, 360, () => 0);
    expect(missed.alive).toBe(true);
  });

  it('越跑越快，障碍也会成组出现', () => {
    const early = stepRace({ ...createRace(220), spawnIn: 0 }, 0.034, still, 220, 360, () => 0);
    const late = stepRace({ ...createRace(220), elapsed: 28, spawnIn: 0 }, 0.034, still, 220, 360, () => 0);
    expect(late.speed).toBeGreaterThan(early.speed + 150);
    expect(early.obstacles).toHaveLength(1);
    expect(late.obstacles.length).toBeGreaterThan(early.obstacles.length);
    for (const obstacle of late.obstacles) {
      expect(220 - obstacle.w).toBeGreaterThanOrEqual(48);
      expect(obstacle.x).toBeGreaterThanOrEqual(10);
    }
  });

  it('按跑过的距离换一句激励', () => {
    expect(raceCheer(0)).toBe(0);
    expect(raceCheer(40)).toBe(1);
    expect(raceCheer(100)).toBe(2);
    expect(raceCheer(200)).toBe(3);
    expect(raceScore({ ...createRace(220), distance: 80 })).toBe(10);
  });
});
