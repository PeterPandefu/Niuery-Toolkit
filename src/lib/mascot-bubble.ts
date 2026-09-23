const INSET = 8;

export interface BubbleBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 把已经画出的气泡挪回区域内。比区域还宽时贴住左边，保证开头不被裁掉。 */
export function resolveBubbleShift(
  arena: { width: number; height: number },
  bubble: BubbleBox,
  inset = INSET,
): { x: number; y: number } {
  if (arena.width <= inset * 2 || arena.height <= inset * 2 || bubble.width <= 0 || bubble.height <= 0) {
    return { x: 0, y: 0 };
  }
  const right = bubble.left + bubble.width;
  const bottom = bubble.top + bubble.height;
  let x = 0;
  let y = 0;
  if (bubble.width >= arena.width - inset * 2 || bubble.left < inset) {
    x = inset - bubble.left;
  } else if (right > arena.width - inset) {
    x = arena.width - inset - right;
  }
  if (bubble.height >= arena.height - inset * 2 || bubble.top < inset) {
    y = inset - bubble.top;
  } else if (bottom > arena.height - inset) {
    y = arena.height - inset - bottom;
  }
  return {
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
  };
}
