import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createLogger, serializeDetails, setMinLogLevel } from '@/lib/logger';
import { useLogStore, exportLogsAsText } from '@/store/log-store';

describe('logger', () => {
  beforeEach(() => {
    useLogStore.getState().clearLogs();
    vi.useFakeTimers();
    setMinLogLevel('debug');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createLogger 写入 log-store', () => {
    const log = createLogger('test-tool');
    log.info('测试消息', { key: 'value' });

    const entries = useLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe('test-tool');
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('测试消息');
    expect(entries[0].details).toBe('{"key":"value"}');
    expect(entries[0].count).toBe(1);
  });

  it('child logger 使用 source:suffix 作为来源', () => {
    const log = createLogger('socket').child('client');
    log.warn('连接失败');

    const entries = useLogStore.getState().entries;
    expect(entries[0].source).toBe('socket:client');
    expect(entries[0].level).toBe('warn');
  });

  it('相同消息 400ms 内节流只记录一条', () => {
    const log = createLogger('throttle-tool');
    log.info('重复消息');
    vi.advanceTimersByTime(100);
    log.info('重复消息');
    vi.advanceTimersByTime(100);
    log.info('重复消息');

    expect(useLogStore.getState().entries).toHaveLength(1);

    // 超过节流间隔后允许再次记录；store 对连续相同消息合并计数
    vi.advanceTimersByTime(500);
    log.info('重复消息');
    const entries = useLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(2);
  });

  it('不同级别不受节流互相影响', () => {
    const log = createLogger('level-tool');
    log.info('同一消息');
    log.warn('同一消息');
    log.error('同一消息');

    expect(useLogStore.getState().entries).toHaveLength(3);
  });

  it('低于最低级别的日志被忽略', () => {
    setMinLogLevel('warn');
    const log = createLogger('min-level-tool');
    log.debug('调试信息');
    log.info('普通信息');
    log.warn('警告信息');

    const entries = useLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('warn');
  });

  it('serializeDetails 处理 Error 并截断超长内容', () => {
    const err = new Error('boom');
    const text = serializeDetails(err);
    expect(text).toContain('Error: boom');

    const long = 'x'.repeat(2000);
    const truncated = serializeDetails(long, 800);
    expect(truncated!.length).toBeLessThan(900);
    expect(truncated).toContain('已截断');

    expect(serializeDetails(undefined)).toBeUndefined();
    expect(serializeDetails(null)).toBeUndefined();
    expect(serializeDetails({ a: 1 })).toBe('{"a":1}');
  });
});

describe('log-store', () => {
  beforeEach(() => {
    useLogStore.getState().clearLogs();
  });

  it('连续相同日志合并计数', () => {
    const { addLog } = useLogStore.getState();
    const base = { timestamp: 1, level: 'info' as const, source: 'a' };
    addLog({ ...base, message: '相同' });
    addLog({ ...base, timestamp: 2, message: '相同' });
    addLog({ ...base, timestamp: 3, message: '相同' });

    const entries = useLogStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(3);
  });

  it('不同消息不合并', () => {
    const { addLog } = useLogStore.getState();
    addLog({ timestamp: 1, level: 'info', source: 'a', message: '一' });
    addLog({ timestamp: 2, level: 'info', source: 'a', message: '二' });

    expect(useLogStore.getState().entries).toHaveLength(2);
  });

  it('面板打开时未读数清零，关闭时累计', () => {
    const store = useLogStore.getState();
    store.setPanelOpen(true);
    expect(useLogStore.getState().unreadCount).toBe(0);

    store.addLog({ timestamp: 1, level: 'info', source: 'a', message: 'x' });
    expect(useLogStore.getState().unreadCount).toBe(0);

    store.setPanelOpen(false);
    useLogStore.getState().addLog({ timestamp: 2, level: 'info', source: 'a', message: 'y' });
    expect(useLogStore.getState().unreadCount).toBe(1);
  });

  it('exportLogsAsText 包含时间/级别/来源/消息/计数', () => {
    const { addLog } = useLogStore.getState();
    addLog({ timestamp: Date.now(), level: 'error', source: 'demo', message: '出错了' });
    addLog({ timestamp: Date.now(), level: 'error', source: 'demo', message: '出错了' });

    const text = exportLogsAsText(useLogStore.getState().entries);
    expect(text).toContain('[ERROR]');
    expect(text).toContain('[demo]');
    expect(text).toContain('出错了');
    expect(text).toContain('×2');
  });
});
