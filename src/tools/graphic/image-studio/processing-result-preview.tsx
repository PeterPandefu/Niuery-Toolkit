import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { ImageViewer } from '@/components/media/image-viewer';
import { saveBytes, saveResults, type SaveFile } from '@/lib/file-save';
import { formatBytes } from '@/lib/utils';
import { IMAGE_FILTER, type ImageProcessingResult } from './common';

const EMPTY_PREVIEW_ITEMS: Array<Blob | SaveFile> = [];

function useObjectUrls(items: Array<Blob | SaveFile>) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const nextUrls = items.map((item) => URL.createObjectURL(item instanceof Blob ? item : item.blob));
    setUrls(nextUrls);
    return () => nextUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [items]);
  return urls;
}

function ResultLightbox({ files, initialIndex, onClose }: { files: SaveFile[]; initialIndex: number; onClose: () => void }) {
  const urls = useObjectUrls(files);
  const [index, setIndex] = useState(initialIndex);
  const canNavigate = files.length > 1;
  const file = files[index];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && canNavigate) setIndex((value) => (value - 1 + files.length) % files.length);
      if (event.key === 'ArrowRight' && canNavigate) setIndex((value) => (value + 1) % files.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canNavigate, files.length, onClose]);

  useEffect(() => {
  }, [index]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="处理结果预览">
      <button className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-label="关闭预览" onClick={onClose} />
      <section className="relative flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{file.name}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.blob.size)} · {index + 1} / {files.length}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} title="关闭预览（Esc）" aria-label="关闭预览"><X /></Button>
        </header>
        <div className="relative flex min-h-0 flex-1">
          {canNavigate && <Button variant="secondary" size="icon" className="absolute left-4 top-1/2 z-10 -translate-y-1/2" onClick={() => setIndex((value) => (value - 1 + files.length) % files.length)} title="上一张（←）"><ChevronLeft /></Button>}
          {urls[index] ? (
            <ImageViewer source={urls[index]} alt={`${file.name} 处理结果预览`} mode="inline" wheelZoom="always" />
          ) : <span className="text-sm text-white/70">正在加载预览…</span>}
          {canNavigate && <Button variant="secondary" size="icon" className="absolute right-4 top-1/2 z-10 -translate-y-1/2" onClick={() => setIndex((value) => (value + 1) % files.length)} title="下一张（→）"><ChevronRight /></Button>}
        </div>
      </section>
    </div>
  );
}

export function ProcessingResultPreview({ sourceFiles, result }: { sourceFiles: File[]; result: ImageProcessingResult | null }) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const sourceUrls = useObjectUrls(sourceFiles.length === 1 ? sourceFiles : EMPTY_PREVIEW_ITEMS);
  const resultUrls = useObjectUrls(result?.files ?? EMPTY_PREVIEW_ITEMS);
  const isSingleComparison = sourceFiles.length === 1 && result?.files.length === 1;
  const filter = result?.filter ?? IMAGE_FILTER;

  const saveAll = async () => {
    if (!result) return;
    try {
      const path = await saveResults(result.zipName, result.files, filter);
      if (path) toast.success(result.files.length === 1 ? '已保存处理结果' : `已保存全部 ${result.files.length} 个结果`);
      else toast.message('已取消保存，结果仍可继续预览');
    } catch (error) {
      toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const saveOne = async (file: SaveFile) => {
    try {
      const path = await saveBytes(file.name, file.blob, filter.name, filter.extensions);
      if (path) toast.success(`已保存 ${file.name}`);
      else toast.message('已取消保存，结果仍可继续预览');
    } catch (error) {
      toast.error(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resultLabel = useMemo(() => result?.files.length === 1 ? '处理结果' : `处理结果（${result?.files.length ?? 0} 个）`, [result?.files.length]);
  if (!result || resultUrls.length !== result.files.length) return null;

  return (
    <section className="space-y-3 rounded-xl border border-primary/25 bg-primary/5 p-3" aria-label="处理结果预览">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{resultLabel}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">结果仅保存在当前界面，确认后再选择保存位置</p>
        </div>
        <LoadingButton size="sm" onClick={saveAll}><Download />{result.files.length === 1 ? '保存结果' : '保存全部'}</LoadingButton>
      </div>

      {isSingleComparison ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <figure className="overflow-hidden rounded-lg border border-border bg-card p-2">
            <figcaption className="mb-2 text-xs text-muted-foreground">原图</figcaption>
            <img src={sourceUrls[0]} alt="原图预览" className="max-h-72 w-full rounded object-contain" loading="lazy" />
          </figure>
          <figure className="overflow-hidden rounded-lg border border-primary/40 bg-card p-2">
            <figcaption className="mb-2 text-xs text-muted-foreground">处理结果 · {formatBytes(result.files[0].blob.size)}</figcaption>
            <button type="button" className="block w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPreviewIndex(0)} title="放大查看处理结果">
              <img src={resultUrls[0]} alt="处理结果预览，点击放大" className="max-h-72 w-full rounded object-contain" loading="lazy" />
            </button>
          </figure>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {result.files.map((file, index) => (
            <figure key={`${file.name}-${index}`} className="overflow-hidden rounded-lg border border-border bg-card p-2">
              <button type="button" className="block w-full rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setPreviewIndex(index)} title={`放大查看 ${file.name}`}>
                <img src={resultUrls[index]} alt={`${file.name} 处理结果预览`} className="h-28 w-full rounded object-contain" loading="lazy" />
              </button>
              <figcaption className="mt-1 truncate text-[11px] text-muted-foreground" title={file.name}>{file.name}</figcaption>
              <div className="mt-2 flex items-center justify-between gap-1">
                <span className="text-[11px] text-muted-foreground">{formatBytes(file.blob.size)}</span>
                <LoadingButton variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => saveOne(file)}><Download />保存</LoadingButton>
              </div>
            </figure>
          ))}
        </div>
      )}
      {previewIndex !== null && <ResultLightbox files={result.files} initialIndex={previewIndex} onClose={() => setPreviewIndex(null)} />}
    </section>
  );
}
