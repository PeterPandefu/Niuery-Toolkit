import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FileDropzone, OptionRow } from './common';
import {
  compressLossless,
  getPdfPageCount,
  mergePdfs,
  splitBySegments,
  splitEveryPage,
  applyImageWatermark,
} from '@/lib/pdf-utils';
import { rasterCompressPdf, renderPdfPages, renderWatermarkPng, extractEmbeddedImages } from '@/lib/pdf-render';
import { saveBytes, saveResults } from '@/lib/file-save';
import { formatBytes } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const log = createLogger('pdf-toolkit:panels');

const PDF_FILTER = { name: 'PDF 文件', extensions: ['pdf'] };

/** 运行包装：统一 busy / 进度 / 错误提示 */
function useBusyRun() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProgress(null);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处理失败');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return { busy, progress, setProgress, run };
}

/** 带日志的运行包装：失败时记录错误并透传给 toast */
function useLoggedRun(operation: string) {
  const { busy, progress, setProgress, run } = useBusyRun();

  const loggedRun = async (fn: () => Promise<void>) => {
    await run(async () => {
      try {
        await fn();
      } catch (e) {
        log.error('处理失败', { operation, error: e });
        throw e;
      }
    });
  };

  return { busy, progress, setProgress, run: loggedRun };
}

/** 单 PDF 文件加载 */
function useSinglePdf() {
  const [files, setFiles] = useState<File[]>([]);
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [pageCount, setPageCount] = useState(0);

  const handleChange = async (next: File[]) => {
    setFiles(next);
    const file = next[0];
    if (!file) {
      setBuffer(null);
      setPageCount(0);
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const pages = await getPdfPageCount(buf);
      setBuffer(buf);
      setPageCount(pages);
      log.info('PDF 加载', { name: file.name, size: file.size, pageCount: pages });
    } catch (e) {
      setBuffer(null);
      setPageCount(0);
      log.warn('PDF 加载失败', { name: file.name, size: file.size, error: e });
      toast.error('PDF 读取失败，文件可能已损坏或加密');
    }
  };

  return { files, handleChange, buffer, pageCount };
}

function RunButton({ busy, disabled, onClick, children }: { busy: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button onClick={onClick} disabled={busy || disabled}>
      {busy && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}

function ProgressText({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

/* ==================== 合并 ==================== */
export function MergePanel() {
  const [files, setFiles] = useState<File[]>([]);
  const { busy, run } = useLoggedRun('合并');

  const handleRun = () =>
    run(async () => {
      if (files.length < 2) {
        log.warn('合并文件数不足', { count: files.length });
        toast.error('请至少选择两个 PDF 文件');
        return;
      }
      log.info('合并开始', {
        count: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
      });
      const buffers: ArrayBuffer[] = [];
      for (const file of files) buffers.push(await file.arrayBuffer());
      const bytes = await mergePdfs(buffers);
      const path = await saveBytes('合并.pdf', bytes, PDF_FILTER.name, PDF_FILTER.extensions);
      if (path) toast.success('合并完成并已保存');
      log.info('合并成功', { count: files.length, sizeBytes: bytes.byteLength, path });
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={setFiles} multiple hint="选择多个 PDF，按列表顺序合并" />
      <RunButton busy={busy} disabled={files.length < 2} onClick={handleRun}>
        开始合并
      </RunButton>
    </div>
  );
}

/* ==================== 拆分 ==================== */
export function SplitPanel() {
  const { files, handleChange, buffer, pageCount } = useSinglePdf();
  const [mode, setMode] = useState<'segments' | 'every'>('segments');
  const [segments, setSegments] = useState('1-1');
  const { busy, run } = useLoggedRun('拆分');

  const handleRun = () =>
    run(async () => {
      if (!buffer) return;
      log.info('拆分开始', { mode, pageCount, sizeBytes: buffer.byteLength });
      const outputs =
        mode === 'every'
          ? await splitEveryPage(buffer)
          : await splitBySegments(buffer, segments, pageCount);
      const path = await saveResults(
        '拆分结果.zip',
        outputs.map((o) => ({ name: o.name, blob: new Blob([o.bytes]) })),
        PDF_FILTER
      );
      if (path) toast.success(`拆分完成，共 ${outputs.length} 个文件`);
      log.info('拆分成功', { mode, count: outputs.length, path });
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={(f) => void handleChange(f)} />
      {pageCount > 0 && <p className="text-xs text-muted-foreground">共 {pageCount} 页</p>}
      <OptionRow label="拆分方式">
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'segments' | 'every')}
          options={[
            { value: 'segments', label: '按页范围分段' },
            { value: 'every', label: '每页拆为独立文件' },
          ]}
          className="h-8"
        />
      </OptionRow>
      {mode === 'segments' && (
        <OptionRow label="页范围">
          <Input
            value={segments}
            onChange={(e) => setSegments(e.target.value)}
            placeholder="如 1-3,5,8-  每段输出一个文件"
            className="h-8 text-xs"
          />
        </OptionRow>
      )}
      <RunButton busy={busy} disabled={!buffer} onClick={handleRun}>
        开始拆分
      </RunButton>
    </div>
  );
}

/* ==================== 水印 ==================== */
export function WatermarkPanel() {
  const { files, handleChange, buffer } = useSinglePdf();
  const [text, setText] = useState('Niuery Toolkit');
  const [fontSize, setFontSize] = useState(36);
  const [opacity, setOpacity] = useState(30);
  const [rotation, setRotation] = useState(45);
  const [tiled, setTiled] = useState(true);
  const { busy, run } = useLoggedRun('水印');

  const handleRun = () =>
    run(async () => {
      if (!buffer) return;
      if (!text.trim()) {
        log.warn('水印文字为空');
        toast.error('请输入水印文字');
        return;
      }
      log.info('水印开始', { sizeBytes: buffer.byteLength, tiled });
      const png = renderWatermarkPng(text.trim(), { fontSize, opacity: opacity / 100, color: '#808080' });
      const bytes = await applyImageWatermark(buffer, png, { rotation, tiled, scale: tiled ? 0.35 : 0.6 });
      const path = await saveBytes('已加水印.pdf', bytes, PDF_FILTER.name, PDF_FILTER.extensions);
      if (path) toast.success('水印已添加并保存');
      log.info('水印成功', { sizeBytes: bytes.byteLength, path });
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={(f) => void handleChange(f)} />
      <OptionRow label="水印文字">
        <Input value={text} onChange={(e) => setText(e.target.value)} className="h-8 text-xs" />
      </OptionRow>
      <OptionRow label={`字号 ${fontSize}`}>
        <input type="range" min={16} max={96} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label={`不透明度 ${opacity}%`}>
        <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label={`旋转角度 ${rotation}°`}>
        <input type="range" min={-180} max={180} step={15} value={rotation} onChange={(e) => setRotation(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label="平铺整页">
        <button
          type="button"
          onClick={() => setTiled(!tiled)}
          className={`h-5 w-9 rounded-full transition-colors ${tiled ? 'bg-primary' : 'bg-muted'}`}
          aria-pressed={tiled}
        >
          <span className={`block h-4 w-4 rounded-full bg-background transition-transform ${tiled ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
      </OptionRow>
      <RunButton busy={busy} disabled={!buffer} onClick={handleRun}>
        添加水印
      </RunButton>
    </div>
  );
}

/* ==================== 压缩 ==================== */
export function CompressPanel() {
  const { files, handleChange, buffer } = useSinglePdf();
  const [mode, setMode] = useState<'lossless' | 'raster'>('lossless');
  const [dpi, setDpi] = useState(150);
  const [quality, setQuality] = useState(70);
  const [result, setResult] = useState<{ original: number; compressed: number; bytes: Uint8Array } | null>(null);
  const { busy, progress, setProgress, run } = useLoggedRun('压缩');

  const handleRun = () =>
    run(async () => {
      if (!buffer) return;
      setResult(null);
      const original = buffer.byteLength;
      log.info('压缩开始', { mode, original });
      const bytes =
        mode === 'lossless'
          ? await compressLossless(buffer)
          : await rasterCompressPdf(buffer, { dpi, quality: quality / 100 }, (done, total) =>
              setProgress(`正在渲染第 ${done}/${total} 页…`)
            );
      setResult({ original, compressed: bytes.byteLength, bytes });
      log.info('压缩成功', { mode, original, compressed: bytes.byteLength });
    });

  const handleSave = () =>
    run(async () => {
      if (!result) return;
      const path = await saveBytes('已压缩.pdf', result.bytes, PDF_FILTER.name, PDF_FILTER.extensions);
      if (path) toast.success('已保存压缩结果');
      log.info('压缩结果已保存', { path, sizeBytes: result.compressed });
    });

  const saved = result ? Math.round((1 - result.compressed / result.original) * 100) : 0;

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={(f) => void handleChange(f)} />
      <OptionRow label="压缩模式">
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'lossless' | 'raster')}
          options={[
            { value: 'lossless', label: '无损（保留文本层）' },
            { value: 'raster', label: '激进（转图片，体积更小）' },
          ]}
          className="h-8"
        />
      </OptionRow>
      {mode === 'raster' && (
        <>
          <OptionRow label="渲染 DPI">
            <Select
              value={String(dpi)}
              onChange={(e) => setDpi(parseInt(e.target.value))}
              options={[72, 100, 150, 200].map((v) => ({ value: String(v), label: `${v} DPI` }))}
              className="h-8"
            />
          </OptionRow>
          <OptionRow label={`JPEG 质量 ${quality}%`}>
            <input type="range" min={30} max={95} value={quality} onChange={(e) => setQuality(parseInt(e.target.value))} className="w-full" />
          </OptionRow>
          <p className="text-xs text-amber-600">激进模式会将页面转为图片，文本将无法选中/搜索</p>
        </>
      )}
      <RunButton busy={busy} disabled={!buffer} onClick={handleRun}>
        开始压缩
      </RunButton>
      <ProgressText text={progress} />
      {result && (
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div className="rounded-lg border border-border p-3">
            <div className="font-mono text-sm font-semibold">{formatBytes(result.original)}</div>
            <div className="mt-1 text-muted-foreground">原始大小</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="font-mono text-sm font-semibold">{formatBytes(result.compressed)}</div>
            <div className="mt-1 text-muted-foreground">压缩后</div>
          </div>
          <div className={`rounded-lg border p-3 ${saved > 0 ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border'}`}>
            <div className={`font-mono text-sm font-semibold ${saved > 0 ? 'text-emerald-500' : ''}`}>
              {saved > 0 ? `-${saved}%` : '+0%'}
            </div>
            <div className="mt-1 text-muted-foreground">节省</div>
          </div>
        </div>
      )}
      {result && (
        <Button variant="outline" onClick={() => void handleSave()} disabled={busy}>
          保存压缩结果
        </Button>
      )}
    </div>
  );
}

/* ==================== PDF 转图片 ==================== */
export function ToImagesPanel() {
  const { files, handleChange, buffer } = useSinglePdf();
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [dpi, setDpi] = useState(150);
  const { busy, progress, setProgress, run } = useLoggedRun('转图片');

  const handleRun = () =>
    run(async () => {
      if (!buffer) return;
      log.info('转图片开始', { format, dpi, sizeBytes: buffer.byteLength });
      const images = await renderPdfPages(buffer, { format, dpi, quality: 0.9 }, (done, total) =>
        setProgress(`正在渲染第 ${done}/${total} 页…`)
      );
      const path = await saveResults(
        'PDF转图片.zip',
        images,
        format === 'png' ? { name: 'PNG 图片', extensions: ['png'] } : { name: 'JPEG 图片', extensions: ['jpg'] }
      );
      if (path) toast.success(`转换完成，共 ${images.length} 张图片`);
      log.info('转图片成功', { format, count: images.length, path });
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={(f) => void handleChange(f)} />
      <OptionRow label="输出格式">
        <Select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}
          options={[
            { value: 'png', label: 'PNG（无损）' },
            { value: 'jpeg', label: 'JPEG（更小）' },
          ]}
          className="h-8"
        />
      </OptionRow>
      <OptionRow label="渲染 DPI">
        <Select
          value={String(dpi)}
          onChange={(e) => setDpi(parseInt(e.target.value))}
          options={[72, 150, 300].map((v) => ({ value: String(v), label: `${v} DPI` }))}
          className="h-8"
        />
      </OptionRow>
      <RunButton busy={busy} disabled={!buffer} onClick={handleRun}>
        开始转换
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 提取图片 ==================== */
export function ExtractImagesPanel() {
  const { files, handleChange, buffer } = useSinglePdf();
  const { busy, progress, setProgress, run } = useLoggedRun('提取图片');

  const handleRun = () =>
    run(async () => {
      if (!buffer) return;
      log.info('提取图片开始', { sizeBytes: buffer.byteLength });
      const images = await extractEmbeddedImages(buffer, (done, total) =>
        setProgress(`正在扫描第 ${done}/${total} 页…`)
      );
      if (images.length === 0) {
        log.warn('未提取到内嵌图片');
        toast.error('未提取到内嵌图片（矢量图形不在提取范围内）');
        return;
      }
      const path = await saveResults('提取图片.zip', images, { name: 'PNG 图片', extensions: ['png'] });
      if (path) toast.success(`提取完成，共 ${images.length} 张图片`);
      log.info('提取图片成功', { count: images.length, path });
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={(f) => void handleChange(f)} />
      <RunButton busy={busy} disabled={!buffer} onClick={handleRun}>
        提取图片
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}
