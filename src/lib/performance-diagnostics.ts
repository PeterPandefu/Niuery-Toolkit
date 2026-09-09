import { createLogger } from '@/lib/logger';

const log = createLogger('performance');
const marks = new Map<string, number>();

/** 记录应用启动与工具加载阶段，供日志面板和现场反馈定位首开卡顿。 */
export function markPerformance(name: string) {
  const timestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
  marks.set(name, timestamp);
  return timestamp;
}

export function measurePerformance(name: string, startMark: string, details?: Record<string, unknown>) {
  const start = marks.get(startMark);
  if (start === undefined) return null;
  const timestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const durationMs = Math.max(0, timestamp - start);
  log.info(`${name} 完成`, { durationMs: Math.round(durationMs * 100) / 100, ...details });
  return durationMs;
}

export function clearPerformanceMark(name: string) {
  marks.delete(name);
}
