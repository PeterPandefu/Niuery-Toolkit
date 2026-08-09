import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useLogStore, exportLogsAsText } from '@/store/log-store';
import { LogLevel } from '@/lib/logger';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';
import { X, Trash2, Download, Copy, ArrowDown, ChevronRight } from 'lucide-react';

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-info',
  warn: 'text-warning',
  error: 'text-destructive',
};

const LEVEL_BADGE: Record<LogLevel, string> = {
  debug: 'bg-muted text-muted-foreground',
  info: 'bg-info/15 text-info',
  warn: 'bg-warning/15 text-warning',
  error: 'bg-destructive/15 text-destructive',
};

const LEVELS: Array<LogLevel | 'all'> = ['all', 'debug', 'info', 'warn', 'error'];
const LEVEL_LABEL: Record<LogLevel | 'all', string> = {
  all: '全部',
  debug: 'Debug',
  info: 'Info',
  warn: 'Warn',
  error: 'Error',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/** 全局日志面板：从底部滑出，支持筛选、导出、清空 */
export function LogPanel() {
  const entries = useLogStore((s) => s.entries);
  const panelOpen = useLogStore((s) => s.panelOpen);
  const setPanelOpen = useLogStore((s) => s.setPanelOpen);
  const clearLogs = useLogStore((s) => s.clearLogs);

  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (levelFilter !== 'all' && e.level !== levelFilter) return false;
      if (sourceFilter && !e.source.toLowerCase().includes(sourceFilter.toLowerCase())) return false;
      return true;
    });
  }, [entries, levelFilter, sourceFilter]);

  // 新日志自动滚动到底部
  useEffect(() => {
    if (autoScroll && panelOpen && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered, autoScroll, panelOpen]);

  // Esc 关闭
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [panelOpen, setPanelOpen]);

  if (!panelOpen) return null;

  const handleExport = async () => {
    if (entries.length === 0) {
      toast.info('暂无日志可导出');
      return;
    }
    const text = exportLogsAsText(entries);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `niuery-toolkit-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('日志已导出');
  };

  const handleCopy = async () => {
    if (entries.length === 0) return;
    const success = await copyToClipboard(exportLogsAsText(entries));
    if (success) toast.success('日志已复制到剪贴板');
  };

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="animate-rise-in flex h-[45%] min-h-[220px] shrink-0 flex-col border-t border-border bg-popover">
      {/* 面板头 */}
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5">
        <span className="text-[12px] font-semibold text-foreground">日志面板</span>
        <span className="font-mono text-[10px] text-muted-foreground">{filtered.length} 条</span>

        {/* 级别筛选 */}
        <div className="ml-3 flex items-center gap-1">
          {LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => setLevelFilter(lv)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors',
                levelFilter === lv
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {LEVEL_LABEL[lv]}
            </button>
          ))}
        </div>

        {/* 来源筛选 */}
        <input
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder="按来源筛选…"
          className="ml-2 h-6 w-36 rounded border border-border/70 bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary/50"
        />

        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              'rounded p-1 transition-colors',
              autoScroll ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
            title="自动滚动到最新日志"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleCopy}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title="复制全部日志"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleExport}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title="导出日志文件"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={clearLogs}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
            title="清空日志"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setPanelOpen(false)}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            title="关闭 (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 日志列表 */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px]">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">暂无日志</div>
        ) : (
          filtered.map((entry) => {
            const hasDetails = !!entry.details;
            const expanded = expandedIds.has(entry.id);
            return (
              <div
                key={entry.id}
                className={cn(
                  'group rounded px-1.5 py-0.5 hover:bg-accent/60',
                  hasDetails && 'cursor-pointer'
                )}
                onClick={hasDetails ? () => toggleExpand(entry.id) : undefined}
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 text-muted-foreground/70">{formatTime(entry.timestamp)}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1 text-[10px] font-semibold uppercase leading-4',
                      LEVEL_BADGE[entry.level]
                    )}
                  >
                    {entry.level}
                  </span>
                  <span className="shrink-0 text-primary/80">[{entry.source}]</span>
                  {hasDetails && (
                    <ChevronRight
                      className={cn('mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
                    />
                  )}
                  <span className={cn('min-w-0 flex-1 break-all', LEVEL_STYLES[entry.level])}>
                    {entry.message}
                    {entry.count > 1 && (
                      <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">×{entry.count}</span>
                    )}
                  </span>
                </div>
                {expanded && entry.details && (
                  <pre className="mt-1 ml-6 whitespace-pre-wrap break-all rounded bg-muted/60 p-2 text-[10.5px] text-muted-foreground">
                    {entry.details}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
