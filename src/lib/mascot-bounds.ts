const EDGE = 28;

/** 活动区边缘留白，和拖动边界用同一套，避免休息点算到墙外。 */
export const MASCOT_EDGE_INSET = 6;

/** 时钟和默认休息点所在的右侧车道。比这更宽的空间都算可拖动的扩展区。 */
export const MASCOT_HOME_LANE = 288;

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

export function mascotAxisLimit(span: number, figure: number, inset = MASCOT_EDGE_INSET) {
  return Math.max(0, (span - figure) / 2 - inset);
}

/**
 * 活动区变宽时，休息点留在右侧车道中心，而不是被拉到整个区域正中。
 * 车道比区域还宽时回到 0，窄窗口的构图不变。
 */
export function mascotHomeX(
  arenaWidth: number,
  figureWidth: number,
  homeLane = MASCOT_HOME_LANE,
  inset = MASCOT_EDGE_INSET,
) {
  const maxX = mascotAxisLimit(arenaWidth, figureWidth, inset);
  const lane = Math.min(Math.max(arenaWidth, 0), homeLane);
  const homeMaxX = mascotAxisLimit(lane, figureWidth, inset);
  return round(clamp(maxX - homeMaxX, -maxX, maxX));
}

/**
 * 区域变大或变小时，保持离右墙和地板的距离，再夹回新边界。
 * 这样全屏只是把虚拟边框向外推，吉祥物不会跳到新的中心。
 */
export function followMascotBounds(
  placement: MascotPlacement,
  previous: MascotBounds,
  next: MascotBounds,
): MascotPlacement {
  const maxX = Math.max(0, next.maxX);
  const maxY = Math.max(0, next.maxY);
  const x = clamp(maxX - (previous.maxX - placement.x), -maxX, maxX);
  const y = clamp(maxY - (previous.maxY - placement.y), -maxY, maxY);
  return { ...placement, x: round(x), y: round(y) };
}
