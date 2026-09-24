import { describe, expect, it } from 'vitest';
import { followMascotBounds, mascotHomeX, REST_MASCOT_PLACEMENT, resolveMascotDrag } from '@/lib/mascot-bounds';

const room = { maxX: 68, maxY: 90 };

describe('吉祥物拖动边界', () => {
  it('在区域中间拖动时不挤压', () => {
    expect(resolveMascotDrag(20, -12, room)).toMatchObject({
      x: 20,
      y: -12,
      scaleX: 1,
      scaleY: 1,
    });
  });

  it('不能拖出左右墙，贴墙时横向挤扁', () => {
    const right = resolveMascotDrag(180, 0, room);
    expect(right.x).toBe(68);
    expect(right.scaleX).toBeLessThan(1);
    expect(right.scaleY).toBeGreaterThan(1);
    expect(right.originX).toBe('100%');

    const left = resolveMascotDrag(-180, 0, room);
    expect(left.x).toBe(-68);
    expect(left.scaleX).toBeLessThan(1);
    expect(left.originX).toBe('0%');
  });

  it('不能拖出上下墙，贴墙时纵向挤扁', () => {
    const floor = resolveMascotDrag(0, 240, room);
    expect(floor.y).toBe(90);
    expect(floor.scaleY).toBeLessThan(1);
    expect(floor.originY).toBe('100%');

    const ceiling = resolveMascotDrag(0, -240, room);
    expect(ceiling.y).toBe(-90);
    expect(ceiling.scaleY).toBeLessThan(1);
    expect(ceiling.originY).toBe('0%');
  });

  it('靠近墙但还没推出区域时已经开始挤压', () => {
    const near = resolveMascotDrag(60, 0, room);
    expect(near.x).toBe(60);
    expect(near.scaleX).toBeLessThan(1);
  });

  it('松手后即使贴着墙也恢复原始宽高', () => {
    const released = resolveMascotDrag(180, 240, room, false);
    expect(released).toMatchObject({ x: 68, y: 90, scaleX: 1, scaleY: 1 });
  });

  it('窄活动区的休息点仍在中心，变宽后留在右侧车道', () => {
    expect(mascotHomeX(256, 144)).toBe(0);
    expect(mascotHomeX(712, 144)).toBe(212);
  });

  it('活动区变大时保持离右墙和地板的距离', () => {
    const next = followMascotBounds(
      { ...REST_MASCOT_PLACEMENT, x: 20, y: 40 },
      { maxX: 68, maxY: 90 },
      { maxX: 200, maxY: 240 },
    );
    expect(next).toMatchObject({ x: 152, y: 190, scaleX: 1, scaleY: 1 });
  });

  it('活动区变小时把已经越界的位置夹回来', () => {
    const next = followMascotBounds(
      { ...REST_MASCOT_PLACEMENT, x: -60, y: -80 },
      { maxX: 68, maxY: 90 },
      { maxX: 20, maxY: 30 },
    );
    expect(next).toMatchObject({ x: -20, y: -30 });
  });
});
