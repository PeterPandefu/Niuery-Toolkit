const FIGURE_HALF = 80;
const WINDOW_NEED = 200;

/** 牛儿贴底、头顶留出空档时才显示。飘起来或气泡会挡住时收起。 */
export function mascotCornerVisible(
  arenaHeight: number,
  mascotY: number,
  lifted: boolean,
  bubbleOn: boolean,
) {
  if (lifted || arenaHeight < 320) return false;
  const figureTop = arenaHeight / 2 + mascotY - FIGURE_HALF;
  const reserve = bubbleOn ? 104 : 24;
  return figureTop - reserve >= WINDOW_NEED;
}
