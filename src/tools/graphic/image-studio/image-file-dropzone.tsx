import { useState } from 'react';
import { Clipboard, History, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { isTauri } from '@/lib/api-client';
import { FileDropzone } from '@/tools/pdf/common';
import {
  formatClipboardRelativeTime,
  loadClipboardImageFile,
  loadClipboardImageHistory,
  type ClipboardImageEntry,
} from './clipboard-image-history';

interface ImageFileDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  hint?: string;
}

/** 图片工具专用上传区：保留普通选文件/拖放，并追加桌面端剪贴板历史导入。 */
export function ImageFileDropzone({ files, onChange, multiple = false, accept = 'image/*', hint }: ImageFileDropzoneProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ClipboardImageEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const importEntry = async (entry: ClipboardImageEntry, latest = false) => {
    setBusy(true);
    try {
      const file = await loadClipboardImageFile(entry.id, entry.timestamp);
      onChange(multiple ? [...files, file] : [file]);
      setHistoryOpen(false);
      toast.success(latest ? '已导入最新剪贴板图片' : '已导入剪贴板历史图片');
    } catch (error) {
      toast.error(`读取历史图片失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const importLatest = async () => {
    if (!isTauri) return;
    setBusy(true);
    try {
      const entries = await loadClipboardImageHistory();
      const latest = entries[0];
      if (!latest) {
        toast.error('暂无图片历史记录');
        return;
      }
      const file = await loadClipboardImageFile(latest.id, latest.timestamp);
      onChange(multiple ? [...files, file] : [file]);
      toast.success('已导入最新剪贴板图片');
    } catch (error) {
      toast.error(`读取历史图片失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async () => {
    if (!isTauri) return;
    setBusy(true);
    try {
      setHistory((await loadClipboardImageHistory()).slice(0, 20));
      setHistoryOpen(true);
    } catch (error) {
      toast.error(`加载图片历史失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <FileDropzone files={files} onChange={onChange} multiple={multiple} accept={accept} hint={hint} />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={importLatest} disabled={!isTauri || busy} title={isTauri ? '导入最新图片历史记录' : '仅桌面端可用'}>
          {busy ? <Loader2 className="animate-spin" /> : <Clipboard />}
          导入最新图片
        </Button>
        <Button size="sm" variant="ghost" onClick={openHistory} disabled={!isTauri || busy} title={isTauri ? '选择最近的图片历史记录' : '仅桌面端可用'}>
          <History />
          历史图片
        </Button>
        {!isTauri && <span className="text-xs text-muted-foreground">剪贴板历史仅桌面端可用</span>}
      </div>

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="选择历史图片">
          <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" aria-label="关闭历史图片" onClick={() => setHistoryOpen(false)} />
          <section className="relative flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold">历史图片</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">显示最近 20 张，点击即可导入</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setHistoryOpen(false)} title="关闭">
                <X />
              </Button>
            </header>
            <div className="grid grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 md:grid-cols-4">
              {history.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => void importEntry(entry)}
                  disabled={busy}
                  className="overflow-hidden rounded-lg border border-border bg-muted/30 p-2 text-left transition-colors hover:border-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  {entry.image_thumbnail ? (
                    <img src={`data:image/png;base64,${entry.image_thumbnail}`} alt={entry.preview} className="h-28 w-full rounded object-contain" />
                  ) : (
                    <div className="flex h-28 items-center justify-center rounded bg-muted text-xs text-muted-foreground">缩略图不可用</div>
                  )}
                  <span className="mt-1 block truncate text-xs">{entry.preview}</span>
                  <span className="block text-[11px] text-muted-foreground">{formatClipboardRelativeTime(entry.timestamp)}</span>
                </button>
              ))}
              {history.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">暂无图片历史记录</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
