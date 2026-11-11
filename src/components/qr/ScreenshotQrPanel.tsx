import { useEffect, useState } from 'react';
import { Copy, ExternalLink, Loader2, QrCode, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { classifyQrValue, type QrDecodeResult } from '@/lib/qr-decoder';

export interface ScreenshotQrPanelProps {
  source: Blob;
  result: QrDecodeResult | null;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
  onCopy: () => void;
  onOpenUrl: (url: URL) => void;
  onCancel: () => void;
  onClose: () => void;
}

export function ScreenshotQrPanel({
  source,
  result,
  busy,
  error,
  onRetry,
  onCopy,
  onOpenUrl,
  onCancel,
  onClose,
}: ScreenshotQrPanelProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const classification = result ? classifyQrValue(result.rawValue) : null;

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return undefined;
    const url = URL.createObjectURL(source);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl('');
    };
  }, [source]);

  const handleOpenUrl = () => {
    if (!classification || classification.kind !== 'url') return;
    const confirmed = window.confirm(`即将打开外部网页：\n${classification.url.toString()}\n\n是否继续？`);
    if (confirmed) onOpenUrl(classification.url);
  };

  return (
    <section className="flex min-h-0 flex-col gap-3 border-t border-border bg-muted/20 p-3" aria-label="截图二维码识别">
      <div className="flex items-center gap-2">
        <QrCode className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">二维码识别</h2>
          <p className="text-xs text-muted-foreground">识别在本机完成，结果不会上传。</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭二维码识别" aria-label="关闭二维码识别">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <div className="flex min-h-32 items-center justify-center overflow-auto rounded-md border border-input bg-background p-2">
          {previewUrl ? <img src={previewUrl} alt="待识别二维码截图预览" className="block max-h-64 max-w-full object-contain" /> : <span className="text-xs text-muted-foreground">截图预览</span>}
        </div>
        <div className="flex min-h-40 min-w-0 flex-col gap-2">
          {busy && <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />正在识别二维码…</div>}
          {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
          {result && (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{classification?.kind === 'url' ? '网页链接' : '文本'}</span>
                {classification?.kind === 'url' && <span className="truncate">{classification.hostname}</span>}
              </div>
              <textarea value={result.rawValue} readOnly aria-label="二维码识别结果" className="min-h-32 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring/50" />
            </>
          )}
          {!busy && !error && !result && <p className="text-sm text-muted-foreground">尚未识别二维码。</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onCopy} disabled={!result || busy}>
          <Copy />复制结果
        </Button>
        {classification?.kind === 'url' && (
          <Button size="sm" onClick={handleOpenUrl} disabled={busy}>
            <ExternalLink />在浏览器打开
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onRetry} disabled={busy}>
          <RotateCcw />重新识别
        </Button>
        {busy && <Button size="sm" variant="outline" onClick={onCancel}><X />取消识别</Button>}
        {result && !busy && <span className="text-xs text-muted-foreground">引擎：{result.engine === 'barcode-detector' ? '系统识别' : '本地回退'} · {result.durationMs} ms</span>}
      </div>
    </section>
  );
}
