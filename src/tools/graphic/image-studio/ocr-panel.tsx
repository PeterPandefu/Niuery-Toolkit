import { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { saveBytesWithFeedback } from '@/lib/file-save';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { copyToClipboard } from '@/lib/utils';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { OptionRow } from '@/tools/pdf/common';
import { createOcrWorker, OcrInitializationTimeoutError, type OcrLanguage, type OcrWorker } from './ocr-engine';
import { preprocessOcrImage } from './ocr-preprocess';
import { postprocessOcrText } from './ocr-postprocess';
import { ImagePreview } from './image-preview';
import { ImageFileDropzone } from './image-file-dropzone';

const LANGUAGE_OPTIONS: { value: OcrLanguage; label: string }[] = [
  { value: 'chi_sim+eng', label: '简体中文 + 英文' },
  { value: 'chi_sim', label: '简体中文' },
  { value: 'eng', label: '英文' },
];

function getProgressText(status: string, progress: number) {
  const percentage = Math.round(progress * 100);
  if (status === 'loading tesseract core') return `正在加载 OCR 引擎 ${percentage}%`;
  if (status === 'loading language traineddata') return `正在加载语言模型 ${percentage}%`;
  if (status === 'initializing tesseract') return '正在初始化识别模型…';
  if (status === 'recognizing text') return `正在识别文字 ${percentage}%`;
  return '正在处理图片…';
}

export function OcrPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [language, setLanguage] = useState<OcrLanguage>('chi_sim+eng');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const log = useToolLogger('image-studio:ocr');
  const mountedRef = useRef(true);
  const runIdRef = useRef(0);
  const workerRef = useRef<OcrWorker | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      const worker = workerRef.current;
      workerRef.current = null;
      if (worker) void worker.terminate().catch(() => undefined);
    };
  }, []);

  const handleRecognize = async () => {
    const file = files[0];
    if (!file) return;
    const runId = ++runIdRef.current;
    const isCurrentRun = () => mountedRef.current && runIdRef.current === runId;

    setBusy(true);
    setProgress('正在准备 OCR 引擎…');
    setResult('');
    log.info('OCR 识别开始', { name: file.name, size: file.size, language });

    try {
      const worker = await createOcrWorker(language, (status, value) => {
        if (isCurrentRun()) setProgress(getProgressText(status, value));
      });
      if (!isCurrentRun()) {
        await worker.terminate();
        return;
      }
      workerRef.current = worker;

      try {
        setProgress('正在优化图片…');
        const image = await preprocessOcrImage(file);
        const { data } = await worker.recognize(image);
        if (!isCurrentRun()) return;
        const text = postprocessOcrText(data.text, language).trim();
        setResult(text);
        log.info('OCR 识别完成', { name: file.name, language, textLength: text.length, confidence: data.confidence });
        toast.success(text ? '文字识别完成' : '未识别到文字');
      } finally {
        if (workerRef.current === worker) {
          workerRef.current = null;
          await worker.terminate();
        }
      }
    } catch (error) {
      if (!isCurrentRun()) return;
      log.error('OCR 识别失败', { error, name: file.name, language });
      toast.error(error instanceof OcrInitializationTimeoutError ? 'OCR 引擎初始化失败，请检查本地 OCR 资源' : error instanceof Error ? `识别失败：${error.message}` : '识别失败，请重试');
    } finally {
      if (isCurrentRun()) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    if (await copyToClipboard(result)) {
      log.info('OCR 结果已复制', { textLength: result.length });
      toast.success('识别结果已复制');
      return;
    }
    toast.error('复制失败，请手动复制');
  };

  const handleDownload = async () => {
    if (!result) return;
    await saveBytesWithFeedback('OCR识别结果.txt', new Blob([result], { type: 'text/plain;charset=utf-8' }), '文本文件', ['txt']);
    log.info('OCR 结果已导出', { textLength: result.length });
  };

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} accept="image/png,image/jpeg,image/webp,image/bmp" hint="支持 PNG、JPEG、WebP、BMP；单次识别一张图片" />
      <ImagePreview files={files} />
      <OptionRow label="识别语言">
        <Select value={language} onChange={(event) => setLanguage(event.target.value as OcrLanguage)} options={LANGUAGE_OPTIONS} className="h-8" />
      </OptionRow>
      <Button onClick={handleRecognize} disabled={busy || files.length === 0}>
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
        开始识别
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">识别结果</span>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCopy}>
                <Clipboard className="h-3.5 w-3.5" />
                复制
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleDownload}>
                <Download className="h-3.5 w-3.5" />
                导出文本
              </Button>
            </div>
          </div>
          <textarea
            value={result}
            onChange={(event) => setResult(event.target.value)}
            className="min-h-64 w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-sm leading-6 outline-none focus:ring-1 focus:ring-ring"
            aria-label="识别结果"
          />
        </div>
      )}
    </div>
  );
}
