const EDGE = 28;

export interface MascotBounds {
  maxX: number;
  maxY: number;
}

export interface MascotPlacement {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  originX: string;
  originY: string;
}

export const REST_MASCOT_PLACEMENT: MascotPlacement = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  originX: '50%',
  originY: '72%',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** 离墙越近、往墙外推得越狠，挤压越强。0 表示还没碰到墙。 */
function wallPressure(distance: number, overflow: number) {
  const proximity = distance <= 0 ? 1 : distance < EDGE ? (EDGE - distance) / EDGE : 0;
  const push = Math.min(1, Math.abs(overflow) / 56);
  return Math.min(1, proximity * 0.7 + push);
}

/**
 * 把拖动目标限制在区域内。挤压只在按住并推向墙时出现；
 * 松手后比例必须回到 1，避免贴墙停留时一直偏瘦或偏矮。
 */
export function resolveMascotDrag(
  desiredX: number,
  desiredY: number,
  bounds: MascotBounds,
  pressing = true,
): MascotPlacement {
  const maxX = Math.max(0, bounds.maxX);
  const maxY = Math.max(0, bounds.maxY);
  const x = clamp(desiredX, -maxX, maxX);
  const y = clamp(desiredY, -maxY, maxY);
  if (!pressing) {
    return { x: round(x), y: round(y), scaleX: 1, scaleY: 1, originX: '50%', originY: '72%' };
  }
  const horizontal = wallPressure(maxX - Math.abs(x), desiredX - x);
  const vertical = wallPressure(maxY - Math.abs(y), desiredY - y);

  let scaleX = 1;
  let scaleY = 1;
  let originX = '50%';
  let originY = '72%';

  if (horizontal > 0) {
    scaleX *= 1 - horizontal * 0.28;
    scaleY *= 1 + horizontal * 0.12;
    originX = desiredX < 0 ? '0%' : '100%';
  }
  if (vertical > 0) {
    scaleY *= 1 - vertical * 0.26;
    scaleX *= 1 + vertical * 0.1;
    originY = desiredY < 0 ? '0%' : '100%';
  }

  return {
    x: round(x),
    y: round(y),
    scaleX: round(scaleX),
    scaleY: round(scaleY),
    originX,
    originY,
  };
}
