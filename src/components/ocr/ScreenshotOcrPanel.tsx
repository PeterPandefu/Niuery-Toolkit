import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2, ScanText, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/utils';
import { createOcrWorker, OcrInitializationTimeoutError, type OcrWorker } from '@/tools/graphic/image-studio/ocr-engine';
import { preprocessOcrImage } from '@/tools/graphic/image-studio/ocr-preprocess';
import { postprocessOcrText } from '@/tools/graphic/image-studio/ocr-postprocess';

interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenshotOcrPanelProps {
  source: Blob;
  text: string;
  autoRecognize?: boolean;
  autoTranslate?: boolean;
  onTextChange: (text: string) => void;
  onTranslate: (text: string) => void;
  onClose: () => void;
}

function progressText(status: string, progress: number) {
  const percent = Math.round(progress * 100);
  if (status === 'loading tesseract core') return `正在加载 OCR 引擎 ${percent}%`;
  if (status === 'loading language traineddata') return `正在加载语言模型 ${percent}%`;
  if (status === 'initializing tesseract') return '正在初始化识别模型…';
  if (status === 'recognizing text') return `正在识别文字 ${percent}%`;
  return '正在处理图片…';
}

async function cropImage(source: Blob, selection: Selection) {
  const url = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error('图片加载失败'));
      nextImage.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(selection.width));
    canvas.height = Math.max(1, Math.round(selection.height));
    canvas.getContext('2d')!.drawImage(
      image,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('选区图片生成失败'))), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ScreenshotOcrPanel({
  source,
  text,
  autoRecognize = false,
  autoTranslate = false,
  onTextChange,
  onTranslate,
  onClose,
}: ScreenshotOcrPanelProps) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const previewRef = useRef<HTMLImageElement>(null);
  const workerRef = useRef<OcrWorker | null>(null);
  const runIdRef = useRef(0);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    const url = URL.createObjectURL(source);
    setPreviewUrl(url);
    autoStartedRef.current = false;
    setSelection(null);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    const worker = workerRef.current;
    workerRef.current = null;
    if (worker) void worker.terminate().catch(() => undefined);
    setBusy(false);
    setProgress(null);
  }, []);

  useEffect(() => cancel, [cancel]);

  const recognize = useCallback(
    async (target: Blob) => {
      if (busy) return;
      if (text && !window.confirm('重新识别将覆盖当前编辑文本，是否继续？')) return;
      const runId = ++runIdRef.current;
      const current = () => runId === runIdRef.current;
      setBusy(true);
      setProgress('正在准备 OCR 引擎…');
      try {
        const worker = await createOcrWorker('chi_sim+eng', (status, value) => {
          if (current()) setProgress(progressText(status, value));
        });
        if (!current()) {
          await worker.terminate();
          return;
        }
        workerRef.current = worker;
        setProgress('正在优化图片…');
        const image = await preprocessOcrImage(target);
        const { data } = await worker.recognize(image);
        if (!current()) return;
        const nextText = postprocessOcrText(data.text, 'chi_sim+eng').trim();
        onTextChange(nextText);
        toast.success(nextText ? '文字识别完成' : '未识别到文字');
        if (nextText && autoTranslate) onTranslate(nextText);
      } catch (error) {
        if (!current()) return;
        toast.error(
          error instanceof OcrInitializationTimeoutError
            ? 'OCR 引擎初始化失败，请检查本地 OCR 资源'
            : error instanceof Error
              ? `识别失败：${error.message}`
              : '识别失败，请重试'
        );
      } finally {
        const worker = workerRef.current;
        workerRef.current = null;
        if (worker) await worker.terminate().catch(() => undefined);
        if (current()) {
          setBusy(false);
          setProgress(null);
        }
      }
    },
    [autoTranslate, busy, onTextChange, onTranslate, text]
  );

  useEffect(() => {
    if (!autoRecognize || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void recognize(source);
  }, [autoRecognize, recognize, source]);

  const pointerPosition = (event: React.PointerEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const image = event.currentTarget;
    return {
      x: ((event.clientX - rect.left) / rect.width) * image.naturalWidth,
      y: ((event.clientY - rect.top) / rect.height) * image.naturalHeight,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    const point = pointerPosition(event);
    setDragStart(point);
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!dragStart) return;
    const point = pointerPosition(event);
    setSelection({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    });
  };

  const handleRecognizeSelection = async () => {
    if (!selection || selection.width < 4 || selection.height < 4) {
      toast.info('请先在图片预览上拖动选择识别区域');
      return;
    }
    try {
      await recognize(await cropImage(source, selection));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '选区图片生成失败');
    }
  };

  const handleTranslate = () => {
    if (!text.trim()) {
      toast.info('请先识别或输入要翻译的文字');
      return;
    }
    onTranslate(text);
  };

  const selectionStyle = (() => {
    const image = previewRef.current;
    if (!selection || !image?.naturalWidth || !image.naturalHeight) return undefined;
    return {
      left: `${(selection.x / image.naturalWidth) * 100}%`,
      top: `${(selection.y / image.naturalHeight) * 100}%`,
      width: `${(selection.width / image.naturalWidth) * 100}%`,
      height: `${(selection.height / image.naturalHeight) * 100}%`,
    };
  })();

  return (
    <section className="flex min-h-0 flex-col gap-3 border-t border-border bg-muted/20 p-3" aria-label="截图文字识别">
      <div className="flex items-center gap-2">
        <ScanText className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">文字识别</h2>
          <p className="text-xs text-muted-foreground">识别在本机完成。可在预览上拖动框选局部文字。</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭文字识别" aria-label="关闭文字识别">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid min-h-0 gap-3 lg:grid-cols-2">
        <div className="min-h-32 overflow-auto rounded-md border border-input bg-background p-2">
          <div className="relative inline-block max-w-full select-none">
            {previewUrl && (
              <img
                ref={previewRef}
                src={previewUrl}
                alt="待识别截图预览"
                className="block max-h-64 max-w-full touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={() => setDragStart(null)}
              />
            )}
            {selectionStyle && <span className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={selectionStyle} />}
          </div>
        </div>
        <textarea
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="识别结果会显示在这里，可直接编辑"
          className="min-h-40 w-full resize-y rounded-md border border-input bg-background p-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring/50"
          aria-label="识别结果"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void recognize(source)} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <ScanText />}
          识别整图
        </Button>
        <Button size="sm" variant="outline" onClick={() => void handleRecognizeSelection()} disabled={busy}>
          识别选区
        </Button>
        <Button size="sm" variant="outline" onClick={cancel} disabled={!busy}>取消识别</Button>
        <Button size="sm" variant="outline" onClick={() => void copyToClipboard(text).then((ok) => toast[ok ? 'success' : 'error'](ok ? '识别结果已复制' : '复制失败，请手动复制'))} disabled={!text}>
          <Copy />复制文字
        </Button>
        <Button size="sm" onClick={handleTranslate} disabled={!text.trim()}>
          <Check />翻译文字
        </Button>
        {progress && <span className="text-xs text-muted-foreground" role="status">{progress}</span>}
      </div>
    </section>
  );
}
