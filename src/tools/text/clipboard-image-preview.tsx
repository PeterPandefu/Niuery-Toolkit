import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize, Minimize, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export interface ClipboardImagePreviewEntry {
  id: string;
  preview: string;
  timestamp: number;
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

/** 使用历史中保存的完整 PNG 预览，避免把 200px 缩略图放大后失真。 */
export function ClipboardImagePreview({ entries, initialId, onClose }: { entries: ClipboardImagePreviewEntry[]; initialId: string; onClose: () => void }) {
  const [currentEntry, setCurrentEntry] = useState(() => entries.find((entry) => entry.id === initialId));
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [fitToWindow, setFitToWindow] = useState(true);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const index = currentEntry ? entries.findIndex((entry) => entry.id === currentEntry.id) : -1;
  const entry = currentEntry;
  const canNavigate = entries.length > 1;

  useEffect(() => {
    if (!entry) {
      onClose();
      return;
    }
    let cancelled = false;
    setImageUrl(null);
    setDimensions(null);
    setZoom(1);
    setFitToWindow(true);
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<string>('get_clipboard_image', { id: entry.id }))
      .then((base64) => {
        if (!cancelled) setImageUrl(`data:image/png;base64,${base64}`);
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(`读取历史图片失败：${error instanceof Error ? error.message : String(error)}`);
          onClose();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entry, onClose]);

  const navigate = useCallback((direction: -1 | 1) => {
    if (!currentEntry || entries.length === 0) return;
    const currentIndex = entries.findIndex((candidate) => candidate.id === currentEntry.id);
    const targetIndex = currentIndex === -1
      ? direction === 1 ? 0 : entries.length - 1
      : (currentIndex + direction + entries.length) % entries.length;
    setCurrentEntry(entries[targetIndex]);
  }, [currentEntry, entries]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && canNavigate) navigate(-1);
      if (event.key === 'ArrowRight' && canNavigate) navigate(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canNavigate, navigate, onClose]);

  const imageLabel = useMemo(() => `剪贴板历史图片 ${index >= 0 ? index + 1 : '已删除'} / ${entries.length}`, [entries.length, index]);
  const previous = () => navigate(-1);
  const next = () => navigate(1);

  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="图片预览">
      <button className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-label="关闭预览" onClick={onClose} />
      <section className="relative flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{entry.preview}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dimensions ? `${dimensions.width} × ${dimensions.height}` : '加载图片信息中'} · {formatRelativeTime(entry.timestamp)} · {index >= 0 ? `${index + 1} / ${entries.length}` : '该记录已删除'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => { setFitToWindow(true); setZoom(1); }} title="适应窗口">
              <Minimize /> 适应窗口
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setFitToWindow(false); setZoom(1); }} title="原始大小">
              <Maximize /> 原始大小
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose} title="关闭预览（Esc）"><X /></Button>
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/90 p-5">
          {canNavigate && <Button variant="secondary" size="icon" className="absolute left-4 top-1/2 z-10 -translate-y-1/2" onClick={previous} title="上一张（←）"><ChevronLeft /></Button>}
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={imageLabel}
              className={fitToWindow ? 'max-h-full max-w-full select-none object-contain' : 'max-w-none select-none'}
              style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 100ms ease-out' }}
              onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              onWheel={(event) => {
                event.preventDefault();
                setZoom((value) => Math.min(4, Math.max(0.25, value + (event.deltaY < 0 ? 0.15 : -0.15))));
              }}
            />
          ) : <span className="text-sm text-white/70">正在读取原图…</span>}
          {canNavigate && <Button variant="secondary" size="icon" className="absolute right-4 top-1/2 z-10 -translate-y-1/2" onClick={next} title="下一张（→）"><ChevronRight /></Button>}
        </div>
        <footer className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">滚轮缩放 · ← / → 切换 · Esc 关闭</footer>
      </section>
    </div>
  );
}
