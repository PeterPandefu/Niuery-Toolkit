import { create } from 'zustand';
import { LogEntry, setLogSink } from '@/lib/logger';

/** 日志条目最大保留数量 */
const MAX_LOG_ENTRIES = 2000;

let nextId = 1;

interface LogStore {
  /** 全部日志（按时间升序，最新在末尾） */
  entries: LogEntry[];
  /** 日志面板是否打开 */
  panelOpen: boolean;
  /** 未读日志数（面板关闭时累计） */
  unreadCount: number;

  addLog: (entry: Omit<LogEntry, 'id' | 'count'>) => void;
  clearLogs: () => void;
  setPanelOpen: (open: boolean) => void;
}

export const useLogStore = create<LogStore>((set) => ({
  entries: [],
  panelOpen: false,
  unreadCount: 0,

  addLog: (entry) =>
    set((state) => {
      // 相同来源+级别+消息的连续日志合并计数
      const last = state.entries[state.entries.length - 1];
      if (
        last &&
        last.source === entry.source &&
        last.level === entry.level &&
        last.message === entry.message
      ) {
        const merged: LogEntry = { ...last, count: last.count + 1, timestamp: entry.timestamp };
        return {
          entries: [...state.entries.slice(0, -1), merged],
          unreadCount: state.panelOpen ? 0 : state.unreadCount + 1,
        };
      }
      const newEntry: LogEntry = { ...entry, id: nextId++, count: 1 };
      const entries =
        state.entries.length >= MAX_LOG_ENTRIES
          ? [...state.entries.slice(-MAX_LOG_ENTRIES + 1), newEntry]
          : [...state.entries, newEntry];
      return {
        entries,
        unreadCount: state.panelOpen ? 0 : state.unreadCount + 1,
      };
    }),

  clearLogs: () => set({ entries: [], unreadCount: 0 }),

  setPanelOpen: (open) =>
    set((state) => ({ panelOpen: open, unreadCount: open ? 0 : state.unreadCount })),
}));

// 将日志核心库的写入端接到 store
setLogSink((entry) => {
  useLogStore.getState().addLog(entry);
});

/** 导出全部日志为纯文本，便于用户粘贴反馈 */
export function exportLogsAsText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const time = new Date(e.timestamp).toISOString();
      const count = e.count > 1 ? ` ×${e.count}` : '';
      const details = e.details ? `\n    ${e.details.split('\n').join('\n    ')}` : '';
      return `${time} [${e.level.toUpperCase()}] [${e.source}] ${e.message}${count}${details}`;
    })
    .join('\n');
}
