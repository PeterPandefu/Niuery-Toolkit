import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { FileDropzone, OptionRow } from '@/tools/pdf/common';
import { calcMergeLayout, canvasToBlob, encodeImagesToGif, encodeImagesToPdf, fileToCanvas, loadImageElement } from '@/lib/image-utils';
import { saveBytes } from '@/lib/file-save';
import { saveImageResults, useBusyRun } from './common';
import { Eraser, Loader2, Paintbrush, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const log = createLogger('image-studio:merge');

/* ==================== 合并为图片 ==================== */
export function MergeImagePanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [direction, setDirection] = useState<'horizontal' | 'vertical' | 'grid'>('vertical');
  const [gap, setGap] = useState(0);
  const [cols, setCols] = useState('2');
  const [bg, setBg] = useState('#ffffff');
  const { busy, progress, setProgress, run } = useBusyRun();

  useEffect(() => {
    if (files.length === 0) return;
    log.info('图片加载', {
      count: files.length,
      files: files.map((f) => ({ name: f.name, size: f.size })),
    });
  }, [files]);

  const handleRun = () =>
    run(async () => {
      try {
        if (files.length < 2) throw new Error('请至少选择两张图片');
        log.info('合并为图片开始', { count: files.length, direction });
        setProgress('正在读取图片…');
        const loaded = await Promise.all(files.map((f) => fileToCanvas(f)));
        const layout = calcMergeLayout(
          loaded.map(({ canvas }) => ({ width: canvas.width, height: canvas.height })),
          { direction, gap, cols: parseInt(cols, 10) || 2 }
        );
        const out = document.createElement('canvas');
        out.width = layout.canvas.width;
        out.height = layout.canvas.height;
        const ctx = out.getContext('2d')!;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, out.width, out.height);
        loaded.forEach(({ canvas }, i) => {
          const p = layout.positions[i];
          ctx.drawImage(canvas, p.x, p.y);
        });
        const blob = await canvasToBlob(out, 'image/png');
        await saveImageResults([{ name: '合并图片.png', blob }]);
        log.info('合并为图片成功', { count: files.length, width: out.width, height: out.height, size: blob.size });
      } catch (e) {
        log.error('合并为图片失败', e);
        throw e;
      }
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={setFiles} multiple accept="image/*" />
      <OptionRow label="排列方式">
        <Select
          value={direction}
          onChange={(e) => setDirection(e.target.value as typeof direction)}
          options={[
            { value: 'vertical', label: '纵向拼接' },
            { value: 'horizontal', label: '横向拼接' },
            { value: 'grid', label: '网格排列' },
          ]}
          className="h-8"
        />
      </OptionRow>
      {direction === 'grid' && (
        <OptionRow label="每行列数">
          <Input type="number" min={1} value={cols} onChange={(e) => setCols(e.target.value)} className="h-8 w-24 text-xs" />
        </OptionRow>
      )}
      <OptionRow label={`间距 ${gap}px`}>
        <input type="range" min={0} max={100} value={gap} onChange={(e) => setGap(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label="背景颜色">
        <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-8 w-16 cursor-pointer rounded-md border border-input bg-transparent p-1" />
      </OptionRow>
      <Button onClick={handleRun} disabled={busy || files.length < 2}>
        {busy && <Loader2 className="animate-spin" />}
        开始处理
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
  );
}

/* ==================== 合并为 PDF ==================== */
export function MergePdfPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const { busy, progress, setProgress, run } = useBusyRun();

  const handleRun = () =>
    run(async () => {
      try {
        if (files.length === 0) throw new Error('请先选择图片');
        log.info('合并为 PDF 开始', {
          count: files.length,
          files: files.map((f) => ({ name: f.name, size: f.size })),
        });
        setProgress('正在生成 PDF…');
        const bytes = await encodeImagesToPdf(files);
        const path = await saveBytes('图片合并.pdf', bytes, 'PDF 文件', ['pdf']);
        if (path) toast.success(`处理完成，共 ${files.length} 页`);
        log.info('合并为 PDF 成功', { count: files.length, size: bytes.byteLength, path });
      } catch (e) {
        log.error('合并为 PDF 失败', e);
        throw e;
      }
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={setFiles} multiple accept="image/*" />
      <p className="text-xs text-muted-foreground">每张图片作为一页，页面尺寸与图片一致</p>
      <Button onClick={handleRun} disabled={busy || files.length === 0}>
        {busy && <Loader2 className="animate-spin" />}
        开始处理
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
  );
}

/* ==================== 合并为 GIF ==================== */
export function MergeGifPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [delayMs, setDelayMs] = useState(500);
  const { busy, progress, setProgress, run } = useBusyRun();

  const handleRun = () =>
    run(async () => {
      try {
        if (files.length === 0) throw new Error('请先选择图片');
        log.info('合并为 GIF 开始', { count: files.length, delayMs });
        setProgress('正在编码 GIF…');
        const blob = await encodeImagesToGif(files, delayMs);
        const path = await saveBytes('合并动图.gif', blob, 'GIF 动图', ['gif']);
        if (path) toast.success(`处理完成，共 ${files.length} 帧`);
        log.info('合并为 GIF 成功', { count: files.length, size: blob.size, path });
      } catch (e) {
        log.error('合并为 GIF 失败', e);
        throw e;
      }
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={files} onChange={setFiles} multiple accept="image/*" />
      <OptionRow label={`帧间隔 ${delayMs}ms`}>
        <input type="range" min={50} max={2000} step={50} value={delayMs} onChange={(e) => setDelayMs(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <p className="text-xs text-muted-foreground">所有帧统一缩放到首张图片的尺寸</p>
      <Button onClick={handleRun} disabled={busy || files.length === 0}>
        {busy && <Loader2 className="animate-spin" />}
        开始处理
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
  );
}

/* ==================== 手动裁剪（自由抠图） ==================== */
type CutoutTool = 'brush' | 'eraser';

export function CutoutPanel() {
  const [file, setFile] = useState<File[]>([]);
  const [tool, setTool] = useState<CutoutTool>('brush');
  const [brushSize, setBrushSize] = useState(40);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const { busy, progress, setProgress, run } = useBusyRun();

  // 加载图片 → 初始化原始分辨率 mask 画布
  useEffect(() => {
    const f = file[0];
    setImgUrl(null);
    setImgSize(null);
    maskRef.current = null;
    if (!f) return;
    const url = URL.createObjectURL(f);
    loadImageElement(url)
      .then((img) => {
        const mask = document.createElement('canvas');
        mask.width = img.naturalWidth;
        mask.height = img.naturalHeight;
        maskRef.current = mask;
        setImgSize({ width: img.naturalWidth, height: img.naturalHeight });
        setImgUrl(url);
        log.info('图片加载', {
          name: f.name,
          size: f.size,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
      })
      .catch(() => {
        URL.revokeObjectURL(url);
        log.warn('图片加载失败', { name: f.name, size: f.size });
        toast.error('图片加载失败，文件可能已损坏');
      });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /** 显示坐标 → 原始像素坐标 */
  const toImageCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = displayRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / rect.width;
    return {
      x: (e.clientX - rect.left) * scale,
      y: (e.clientY - rect.top) * scale,
    };
  };

  const paintStroke = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const mask = maskRef.current;
    if (!mask) return;
    const ctx = mask.getContext('2d')!;
    ctx.globalCompositeOperation = tool === 'brush' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = '#ff0000';
    ctx.fillStyle = '#ff0000';
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (from) {
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /** 将 mask 叠加到显示画布，供用户预览 */
  const redrawPreview = () => {
    const display = displayRef.current;
    const mask = maskRef.current;
    if (!display || !mask || !imgUrl) return;
    loadImageElement(imgUrl).then((img) => {
      const ctx = display.getContext('2d')!;
      ctx.clearRect(0, 0, display.width, display.height);
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 0.4;
      ctx.drawImage(mask, 0, 0);
      ctx.globalAlpha = 1;
    });
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!maskRef.current) return;
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImageCoords(e);
    lastPoint.current = p;
    paintStroke(null, p);
    redrawPreview();
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = toImageCoords(e);
    paintStroke(lastPoint.current, p);
    lastPoint.current = p;
    redrawPreview();
  };

  const handlePointerUp = () => {
    drawing.current = false;
    lastPoint.current = null;
  };

  const handleReset = () => {
    const mask = maskRef.current;
    if (!mask) return;
    mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
    redrawPreview();
  };

  const handleRun = () =>
    run(async () => {
      try {
        const mask = maskRef.current;
        if (!mask) throw new Error('请先选择图片');
        log.info('抠图开始', { name: file[0]?.name, width: mask.width, height: mask.height });
        const maskData = mask.getContext('2d')!.getImageData(0, 0, mask.width, mask.height).data;
        let hasMask = false;
        for (let i = 3; i < maskData.length; i += 4) {
          if (maskData[i] > 0) {
            hasMask = true;
            break;
          }
        }
        if (!hasMask) throw new Error('请先用画笔涂抹要保留的区域');
        setProgress('正在输出…');
        const { canvas, ctx, img } = await fileToCanvas(file[0]);
        ctx.drawImage(img, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(mask, 0, 0);
        const blob = await canvasToBlob(canvas, 'image/png');
        await saveImageResults([{ name: '抠图结果.png', blob }]);
        log.info('抠图成功', { size: blob.size });
      } catch (e) {
        log.error('抠图失败', e);
        throw e;
      }
    });

  return (
    <div className="space-y-4">
      <FileDropzone files={file} onChange={setFile} accept="image/*" />
      {imgUrl && imgSize && (
        <>
          <div className="flex items-center gap-2">
            <Button variant={tool === 'brush' ? 'default' : 'outline'} size="sm" onClick={() => setTool('brush')}>
              <Paintbrush /> 画笔
            </Button>
            <Button variant={tool === 'eraser' ? 'default' : 'outline'} size="sm" onClick={() => setTool('eraser')}>
              <Eraser /> 橡皮
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset}>
              <Undo2 /> 清空涂抹
            </Button>
          </div>
          <OptionRow label={`笔刷大小 ${brushSize}px`}>
            <input type="range" min={5} max={200} value={brushSize} onChange={(e) => setBrushSize(parseInt(e.target.value))} className="w-full" />
          </OptionRow>
          <p className="text-xs text-muted-foreground">红色区域为保留区域，涂抹后点击「开始处理」输出透明背景 PNG</p>
          <div className="overflow-auto rounded-md border border-border bg-muted/30 p-2">
            <canvas
              ref={displayRef}
              width={imgSize.width}
              height={imgSize.height}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              className="mx-auto block max-h-[420px] max-w-full cursor-crosshair touch-none"
              style={{ imageRendering: 'auto' }}
            />
          </div>
        </>
      )}
      <Button onClick={handleRun} disabled={busy || !imgUrl}>
        {busy && <Loader2 className="animate-spin" />}
        开始处理
      </Button>
      {progress && <p className="text-xs text-muted-foreground">{progress}</p>}
    </div>
  );
}
