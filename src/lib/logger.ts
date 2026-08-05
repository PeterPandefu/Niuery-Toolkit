/**
 * 统一日志核心库
 * 各工具通过 createLogger('工具ID') 获取日志实例，
 * 日志写入全局 log-store，可在应用内日志面板查看/导出，便于排查问题。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  /** 自增 ID */
  id: number;
  /** 时间戳（毫秒） */
  timestamp: number;
  level: LogLevel;
  /** 日志来源：工具 ID 或模块名 */
  source: string;
  /** 日志消息 */
  message: string;
  /** 附加详情（序列化后的数据） */
  details?: string;
  /** 相同日志连续出现次数（节流合并） */
  count: number;
}

export interface Logger {
  debug: (message: string, details?: unknown) => void;
  info: (message: string, details?: unknown) => void;
  warn: (message: string, details?: unknown) => void;
  error: (message: string, details?: unknown) => void;
  /** 创建带子前缀的日志实例，如 createLogger('socket').child('client') */
  child: (suffix: string) => Logger;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** 最低记录级别（低于该级别的日志被忽略） */
let minLevel: LogLevel = 'debug';

export function setMinLogLevel(level: LogLevel) {
  minLevel = level;
}

export function getMinLogLevel(): LogLevel {
  return minLevel;
}

/** 安全序列化任意值为字符串，超长截断 */
export function serializeDetails(value: unknown, maxLength = 800): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  try {
    if (value instanceof Error) {
      text = `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    } else if (typeof value === 'string') {
      text = value;
    } else {
      text = JSON.stringify(value);
    }
  } catch {
    text = String(value);
  }
  if (text.length > maxLength) {
    text = `${text.slice(0, maxLength)}… (已截断, 共 ${text.length} 字符)`;
  }
  return text;
}

/**
 * 日志写入器。默认写入控制台；
 * log-store 初始化后会通过 setLogSink 注入 store 写入逻辑，避免循环依赖。
 */
type LogSink = (entry: Omit<LogEntry, 'id' | 'count'>) => void;

let sink: LogSink = (entry) => {
  const prefix = `[${entry.source}]`;
  switch (entry.level) {
    case 'debug':
      console.debug(prefix, entry.message, entry.details ?? '');
      break;
    case 'info':
      console.info(prefix, entry.message, entry.details ?? '');
      break;
    case 'warn':
      console.warn(prefix, entry.message, entry.details ?? '');
      break;
    case 'error':
      console.error(prefix, entry.message, entry.details ?? '');
      break;
  }
};

export function setLogSink(next: LogSink) {
  sink = next;
}

/** 节流记录：source+level+message 相同且间隔 < 400ms 时合并计数，防止实时转换刷爆日志 */
const throttleMap = new Map<string, number>();
const THROTTLE_INTERVAL = 400;

function emitLog(source: string, level: LogLevel, message: string, details?: unknown) {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) return;

  const key = `${source}|${level}|${message}`;
  const now = Date.now();
  const last = throttleMap.get(key);
  if (last !== undefined && now - last < THROTTLE_INTERVAL) {
    // 高频重复日志直接丢弃（查看器端对最近条目计数）
    throttleMap.set(key, now);
    return;
  }
  throttleMap.set(key, now);
  // 防止节流表无限增长
  if (throttleMap.size > 500) throttleMap.clear();

  sink({
    timestamp: now,
    level,
    source,
    message,
    details: serializeDetails(details),
  });
}

/** 创建指定来源的日志实例 */
export function createLogger(source: string): Logger {
  return {
    debug: (message, details) => emitLog(source, 'debug', message, details),
    info: (message, details) => emitLog(source, 'info', message, details),
    warn: (message, details) => emitLog(source, 'warn', message, details),
    error: (message, details) => emitLog(source, 'error', message, details),
    child: (suffix) => createLogger(`${source}:${suffix}`),
  };
}

/** 应用级日志实例 */
export const appLogger = createLogger('app');
