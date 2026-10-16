export const MASCOT_LINE_KEYS = [
  'app.mascotLineJson',
  'app.mascotLinePlay',
  'app.mascotLineCalc',
  'app.mascotLineCodec',
  'app.mascotLineSecret',
  'app.mascotLineText',
  'app.mascotLineFormat',
  'app.mascotLineMake',
  'app.mascotLineFile',
  'app.mascotLineCanvas',
  'app.mascotLineCapture',
  'app.mascotLineApi',
  'app.mascotLineSystem',
  'app.mascotLineTranslate',
  'app.mascotLineSearch',
] as const;

export const MASCOT_PLAY_LINE = 'app.mascotLinePlay';
export const MASCOT_BUBBLE_MS = 5000;

/** 从其余句子里随机抽一句，不按固定顺序轮播，也不连着重复同一句。 */
export function pickMascotLine(length: number, current: number | null, random: () => number = Math.random) {
  if (length <= 1) return 0;
  if (current == null || current < 0 || current >= length) return Math.floor(random() * length);
  const offset = 1 + Math.floor(random() * (length - 1));
  return (current + offset) % length;
}
