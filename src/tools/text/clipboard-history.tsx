import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Type,
  Image,
  FileText,
  Copy,
  Trash2,
  Check,
  ClipboardList,
  Eye,
  Search,
  Monitor,
} from 'lucide-react';
import { toast } from 'sonner';
import { isTauri } from '@/lib/api-client';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { ClipboardImagePreview } from './clipboard-image-preview';

interface ClipboardEntryView {
  id: string;
  content_type: 'text' | 'image' | 'files';
  text: string | null;
  file_paths: string[] | null;
  image_thumbnail: string | null;
  preview: string;
  timestamp: number;
}

function ClipboardThumbnail({ entry, onPreview }: { entry: ClipboardEntryView; onPreview: () => void }) {
  const [thumbnail, setThumbnail] = useState(entry.image_thumbnail);
  const [shouldLoad, setShouldLoad] = useState(Boolean(entry.image_thumbnail));
  const targetRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (thumbnail || shouldLoad) return;
    const target = targetRef.current;
    if (!target) return;

    if (typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(([intersection]) => {
      if (!intersection?.isIntersecting) return;
      setShouldLoad(true);
      observer.disconnect();
    }, { rootMargin: '240px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoad, thumbnail]);

  useEffect(() => {
    if (!shouldLoad || thumbnail) return;
    let cancelled = false;
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<string | null>('get_clipboard_thumbnail', { id: entry.id }))
      .then((result) => {
        if (!cancelled && result) setThumbnail(result);
      })
      .catch(() => {
        // 缩略图加载失败时保留文字占位，不影响历史记录操作。
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id, shouldLoad, thumbnail]);

  return (
    <button
      ref={targetRef}
      type="button"
      className="block min-h-[48px] min-w-[80px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onPreview}
      title="预览原图"
    >
      {thumbnail ? (
        <img
          src={`data:image/png;base64,${thumbnail}`}
          alt="剪贴板图片，点击预览原图"
          loading="lazy"
          className="max-h-[120px] max-w-[200px] rounded-md border border-border/50 object-contain"
        />
      ) : (
        <span className="block px-2 py-3 text-left text-sm text-muted-foreground">{entry.preview}</span>
      )}
    </button>
  );
}

type FilterType = 'all' | 'text' | 'image' | 'files';

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}

const TYPE_CONFIG = {
  text: { icon: Type, label: '文本', color: 'text-blue-500' },
  image: { icon: Image, label: '图片', color: 'text-emerald-500' },
  files: { icon: FileText, label: '文件', color: 'text-amber-500' },
} as const;

export default function ClipboardHistory() {
  const [entries, setEntries] = useState<ClipboardEntryView[]>([]);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const log = useToolLogger('clipboard-history');

  // 加载历史记录
  const loadHistory = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const history = await invoke<ClipboardEntryView[]>('get_clipboard_history');
      setEntries(history);
      log.info('历史加载完成', { count: history.length });
    } catch (e) {
      log.error('加载剪贴板历史失败', e);
      toast.error(`加载剪贴板历史失败: ${e}`);
    } finally {
      setLoading(false);
    }
  }, [log]);

  // 监听新条目事件
  useEffect(() => {
    if (!isTauri) return;

    let cancelled = false;

    async function setup() {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ClipboardEntryView>('clipboard-new-entry', (event) => {
        if (cancelled) return;
        setEntries((prev) => [event.payload, ...prev].slice(0, 200));
      });
      unlistenRef.current = unlisten;
    }

    setup();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // 复制操作
  const handleCopy = useCallback(async (entry: ClipboardEntryView) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');

      switch (entry.content_type) {
        case 'text':
          if (entry.text) {
            await invoke('copy_text_to_clipboard', { text: entry.text });
          }
          break;
        case 'image':
          await invoke('copy_image_from_history', { id: entry.id });
          break;
        case 'files':
          if (entry.file_paths) {
            await invoke('copy_files_to_clipboard', { paths: entry.file_paths });
          }
          break;
      }

      setCopiedId(entry.id);
      log.info('已复制历史条目', { id: entry.id, type: entry.content_type });
      toast.success('已复制到剪贴板');
      setTimeout(() => setCopiedId(null), 2000);
    } catch (e) {
      log.warn('复制历史条目失败', e);
      toast.error(`复制失败: ${e}`);
    }
  }, [log]);

  // 删除单条
  const handleDelete = useCallback(async (id: string) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('delete_clipboard_entry', { id });
      setEntries((prev) => prev.filter((e) => e.id !== id));
      log.info('已删除历史条目', { id });
      toast.success('已删除');
    } catch (e) {
      log.warn('删除历史条目失败', e);
      toast.error(`删除失败: ${e}`);
    }
  }, [log]);

  // 清空全部
  const handleClearAll = useCallback(async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('clear_clipboard_history');
      setEntries([]);
      log.info('已清空全部历史');
      toast.success('已清空所有记录');
    } catch (e) {
      log.warn('清空历史失败', e);
      toast.error(`清空失败: ${e}`);
    }
  }, [log]);

  // 非 Tauri 环境提示
  if (!isTauri) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <Monitor className="h-12 w-12 mx-auto text-muted-foreground/50" />
          <p className="text-muted-foreground">剪贴板历史功能仅在桌面端可用</p>
          <p className="text-sm text-muted-foreground/70">请使用 Tauri 桌面应用体验此功能</p>
        </div>
      </div>
    );
  }

  // 筛选 + 搜索
  const filtered = entries.filter((entry) => {
    if (filter !== 'all' && entry.content_type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchPreview = entry.preview.toLowerCase().includes(q);
      const matchText = entry.text?.toLowerCase().includes(q) ?? false;
      const matchFiles = entry.file_paths?.some((p) => p.toLowerCase().includes(q)) ?? false;
      if (!matchPreview && !matchText && !matchFiles) return false;
    }
    return true;
  });

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'text', label: '文本' },
    { key: 'image', label: '图片' },
    { key: 'files', label: '文件' },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2">
        <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
          {filterButtons.map(({ key, label }) => (
            <Button
              key={key}
              variant={filter === key ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="relative ml-auto flex-1 max-w-[240px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索记录..."
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={handleClearAll}
          title="清空所有记录"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            加载中...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground">
              {entries.length === 0 ? '暂无剪贴板记录' : '没有匹配的记录'}
            </p>
            {entries.length === 0 && (
              <p className="mt-1 text-sm text-muted-foreground/60">
                复制文本、图片或文件后，记录将自动出现在这里
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((entry) => {
              const config = TYPE_CONFIG[entry.content_type];
              const Icon = config.icon;
              const isCopied = copiedId === entry.id;

              return (
                <div
                  key={entry.id}
                  className="group flex items-start gap-3 rounded-lg border border-border/60 bg-card p-3 transition-colors hover:border-border hover:bg-accent/30"
                >
                  {/* 类型图标 */}
                  <div className={`mt-0.5 shrink-0 ${config.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>

                  {/* 内容预览 */}
                  <div className="min-w-0 flex-1">
                    {entry.content_type === 'text' && (
                      <p className="whitespace-pre-wrap break-all text-sm leading-relaxed line-clamp-3">
                        {entry.preview}
                        {(entry.text?.length ?? 0) > 100 && '...'}
                      </p>
                    )}

                    {entry.content_type === 'image' && (
                      <div className="space-y-1">
                        <ClipboardThumbnail entry={entry} onPreview={() => setPreviewId(entry.id)} />
                      </div>
                    )}

                    {entry.content_type === 'files' && (
                      <div className="space-y-0.5">
                        {entry.file_paths?.map((path, i) => (
                          <p key={i} className="truncate text-sm font-mono text-muted-foreground">
                            {path}
                          </p>
                        ))}
                      </div>
                    )}

                    <span className="mt-1 block text-xs text-muted-foreground/60">
                      {formatRelativeTime(entry.timestamp)}
                    </span>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    {entry.content_type === 'image' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setPreviewId(entry.id)} title="预览原图">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleCopy(entry)}
                      title="复制"
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 hover:text-destructive"
                      onClick={() => handleDelete(entry.id)}
                      title="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {previewId && (
        <ClipboardImagePreview
          entries={entries.filter((entry) => entry.content_type === 'image')}
          initialId={previewId}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}
