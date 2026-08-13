import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { OptionRow } from '@/tools/pdf/common';
import { calcCenterCrop, calcRatioCrop, calcResizeSize, canvasToBlob, fileToCanvas } from '@/lib/image-utils';
import { baseName, saveImageResults, useBusyRun } from './common';
import { ImagePreview } from './image-preview';
import { ImageFileDropzone } from './image-file-dropzone';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { createLogger } from '@/lib/logger';

const log = createLogger('image-studio:edit');

type PerFile = (file: File) => Promise<{ blob: Blob; ext: string }>;

/** 批量处理模板：逐文件处理 → 保存结果 */
function useBatch(files: File[]) {
  const { busy, progress, setProgress, run } = useBusyRun();

  useEffect(() => {
    if (files.length === 0) return;
    log.info('图片加载', {
      count: files.length,
      files: files.map((f) => ({ name: f.name, size: f.size })),
    });
  }, [files]);

  const runBatch = (perFile: PerFile, zipName: string, operation: string) =>
    run(async () => {
      try {
        if (files.length === 0) {
          log.warn('未选择图片', { operation });
          toast.error('请先选择图片');
          return;
        }
        log.info('操作开始', { operation, count: files.length });
        const results = [];
        for (let i = 0; i < files.length; i++) {
          setProgress(files.length > 1 ? `正在处理 ${i + 1}/${files.length}…` : null);
          const { blob, ext } = await perFile(files[i]);
          results.push({ name: `${baseName(files[i].name)}-处理.${ext}`, blob });
        }
        await saveImageResults(results, zipName);
        log.info('操作成功', { operation, count: files.length });
      } catch (e) {
        log.error('操作失败', { operation, error: e });
        throw e;
      }
    });

  return { busy, progress, runBatch };
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

/* ==================== 图片压缩 ==================== */
export function CompressPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(80);
  const [targetKB, setTargetKB] = useState('');
  const [format, setFormat] = useState<'image/jpeg' | 'image/webp'>('image/jpeg');
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      const { canvas, ctx, img } = await fileToCanvas(file);
      ctx.drawImage(img, 0, 0);
      const target = parseInt(targetKB, 10) || 0;
      const q = quality / 100;
      let blob = await canvasToBlob(canvas, format, q);
      if (target > 0 && blob.size > target * 1024) {
        let lo = 0.05;
        let hi = q;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          const candidate = await canvasToBlob(canvas, format, mid);
          if (candidate.size <= target * 1024) {
            lo = mid;
            blob = candidate;
          } else {
            hi = mid;
          }
        }
      }
      return { blob, ext: format === 'image/webp' ? 'webp' : 'jpg' };
    }, '压缩结果.zip', '压缩');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label={`压缩质量 ${quality}`}>
        <div>
          <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(parseInt(e.target.value))} className="w-full" />
          <p className="mt-1 text-xs text-muted-foreground">值越高越清晰，文件也越大</p>
        </div>
      </OptionRow>
      <OptionRow label="目标大小 (KB)">
        <Input type="number" value={targetKB} onChange={(e) => setTargetKB(e.target.value)} placeholder="可选，自动逼近目标体积" className="h-8 text-xs" />
      </OptionRow>
      <OptionRow label="输出格式">
        <Select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'image/jpeg' | 'image/webp')}
          options={[
            { value: 'image/jpeg', label: 'JPEG' },
            { value: 'image/webp', label: 'WebP' },
          ]}
          className="h-8"
        />
      </OptionRow>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 格式转换 ==================== */
export function ConvertPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<'image/png' | 'image/jpeg' | 'image/webp'>('image/png');
  const [quality, setQuality] = useState(90);
  const { busy, progress, runBatch } = useBatch(files);

  const ext = format === 'image/png' ? 'png' : format === 'image/webp' ? 'webp' : 'jpg';

  const handleRun = () =>
    runBatch(async (file) => {
      const { canvas, ctx, img } = await fileToCanvas(file);
      if (format === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(img, 0, 0);
      const blob = await canvasToBlob(canvas, format, quality / 100);
      return { blob, ext };
    }, '转换结果.zip', '格式转换');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label="输出格式">
        <Select
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          options={[
            { value: 'image/png', label: 'PNG' },
            { value: 'image/jpeg', label: 'JPEG' },
            { value: 'image/webp', label: 'WebP' },
          ]}
          className="h-8"
        />
      </OptionRow>
      {format !== 'image/png' && (
        <OptionRow label={`质量 ${quality}`}>
          <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(parseInt(e.target.value))} className="w-full" />
        </OptionRow>
      )}
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 修改尺寸 ==================== */
export function ResizePanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [lock, setLock] = useState(true);
  const { busy, progress, runBatch } = useBatch(files);

  // 首张图片加载后初始化默认尺寸
  useEffect(() => {
    const file = files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setWidth(String(img.naturalWidth));
      setHeight(String(img.naturalHeight));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [files]);

  const handleRun = () =>
    runBatch(async (file) => {
      const w = parseInt(width, 10) || 0;
      const h = parseInt(height, 10) || 0;
      if (w <= 0 && h <= 0) throw new Error('请填写目标宽度或高度');
      const { canvas, img } = await fileToCanvas(file);
      const size = calcResizeSize(
        { width: img.naturalWidth, height: img.naturalHeight },
        { width: w, height: h },
        lock
      );
      const out = document.createElement('canvas');
      out.width = size.width;
      out.height = size.height;
      out.getContext('2d')!.drawImage(canvas, 0, 0, size.width, size.height);
      return { blob: await canvasToBlob(out, 'image/png'), ext: 'png' };
    }, '缩放结果.zip', '修改尺寸');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">宽度 (px)</span>
          <Input type="number" value={width} onChange={(e) => setWidth(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">高度 (px)</span>
          <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} className="h-8 text-xs" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
        锁定宽高比
      </label>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 添加水印 ==================== */
type WatermarkPosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'tile';

export function WatermarkPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('Niuery Toolkit');
  const [size, setSize] = useState(32);
  const [opacity, setOpacity] = useState(30);
  const [position, setPosition] = useState<WatermarkPosition>('tile');
  const [rotation, setRotation] = useState(-30);
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      if (!text.trim()) throw new Error('请输入水印文字');
      const { canvas, ctx, img } = await fileToCanvas(file);
      ctx.drawImage(img, 0, 0);
      const font = `600 ${size}px system-ui, sans-serif`;
      ctx.font = font;
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle = '#808080';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const drawStamp = (x: number, y: number) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      };

      const m = size;
      const tw = ctx.measureText(text).width;
      if (position === 'tile') {
        for (let y = m; y < canvas.height + m; y += size * 4) {
          for (let x = m; x < canvas.width + tw; x += tw + size * 3) {
            drawStamp(x, y);
          }
        }
      } else {
        const spots: Record<Exclude<WatermarkPosition, 'tile'>, [number, number]> = {
          center: [canvas.width / 2, canvas.height / 2],
          'top-left': [m + tw / 2, m],
          'top-right': [canvas.width - m - tw / 2, m],
          'bottom-left': [m + tw / 2, canvas.height - m],
          'bottom-right': [canvas.width - m - tw / 2, canvas.height - m],
        };
        const [x, y] = spots[position];
        drawStamp(x, y);
      }
      return { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' };
    }, '水印结果.zip', '水印');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label="水印文字">
        <Input value={text} onChange={(e) => setText(e.target.value)} className="h-8 text-xs" />
      </OptionRow>
      <OptionRow label={`字号 ${size}`}>
        <input type="range" min={12} max={96} value={size} onChange={(e) => setSize(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label={`不透明度 ${opacity}%`}>
        <input type="range" min={5} max={100} value={opacity} onChange={(e) => setOpacity(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label="位置">
        <Select
          value={position}
          onChange={(e) => setPosition(e.target.value as WatermarkPosition)}
          options={[
            { value: 'tile', label: '平铺整图' },
            { value: 'center', label: '居中' },
            { value: 'top-left', label: '左上' },
            { value: 'top-right', label: '右上' },
            { value: 'bottom-left', label: '左下' },
            { value: 'bottom-right', label: '右下' },
          ]}
          className="h-8"
        />
      </OptionRow>
      <OptionRow label={`旋转 ${rotation}°`}>
        <input type="range" min={-180} max={180} step={15} value={rotation} onChange={(e) => setRotation(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 添加圆角 ==================== */
export function RoundedPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [radius, setRadius] = useState(24);
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      const { canvas, ctx, img } = await fileToCanvas(file);
      const r = Math.min(radius, canvas.width / 2, canvas.height / 2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.arcTo(canvas.width, 0, canvas.width, canvas.height, r);
      ctx.arcTo(canvas.width, canvas.height, 0, canvas.height, r);
      ctx.arcTo(0, canvas.height, 0, 0, r);
      ctx.arcTo(0, 0, canvas.width, 0, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0);
      return { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' };
    }, '圆角结果.zip', '圆角');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label={`圆角半径 ${radius}px`}>
        <input type="range" min={0} max={200} value={radius} onChange={(e) => setRadius(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 补边留白 ==================== */
export function PaddingPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [padding, setPadding] = useState(24);
  const [color, setColor] = useState('#ffffff');
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      const { canvas } = await fileToCanvas(file);
      const out = document.createElement('canvas');
      out.width = canvas.width + padding * 2;
      out.height = canvas.height + padding * 2;
      const outCtx = out.getContext('2d')!;
      outCtx.fillStyle = color;
      outCtx.fillRect(0, 0, out.width, out.height);
      outCtx.drawImage(canvas, padding, padding);
      return { blob: await canvasToBlob(out, 'image/png'), ext: 'png' };
    }, '补边结果.zip', '补边留白');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label={`边宽 ${padding}px`}>
        <input type="range" min={0} max={200} value={padding} onChange={(e) => setPadding(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <OptionRow label="背景颜色">
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-16 cursor-pointer rounded-md border border-input bg-transparent p-1" />
      </OptionRow>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 裁剪 ==================== */
export function CropPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<'1:1' | '4:3' | '16:9' | '9:16' | 'custom'>('1:1');
  const [customW, setCustomW] = useState('800');
  const [customH, setCustomH] = useState('600');
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      const { canvas, img } = await fileToCanvas(file);
      const orig = { width: img.naturalWidth, height: img.naturalHeight };
      const rect =
        mode === 'custom'
          ? calcCenterCrop(orig, { width: parseInt(customW, 10) || orig.width, height: parseInt(customH, 10) || orig.height })
          : calcRatioCrop(orig, ...((mode.split(':').map(Number) as [number, number])));
      const out = document.createElement('canvas');
      out.width = rect.width;
      out.height = rect.height;
      out.getContext('2d')!.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      return { blob: await canvasToBlob(out, 'image/png'), ext: 'png' };
    }, '裁剪结果.zip', '裁剪');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label="裁剪比例">
        <Select
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
          options={[
            { value: '1:1', label: '1:1 正方形' },
            { value: '4:3', label: '4:3' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16 竖屏' },
            { value: 'custom', label: '自定义尺寸（居中）' },
          ]}
          className="h-8"
        />
      </OptionRow>
      {mode === 'custom' && (
        <div className="grid grid-cols-2 gap-3">
          <Input type="number" value={customW} onChange={(e) => setCustomW(e.target.value)} placeholder="宽 px" className="h-8 text-xs" />
          <Input type="number" value={customH} onChange={(e) => setCustomH(e.target.value)} placeholder="高 px" className="h-8 text-xs" />
        </div>
      )}
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 旋转 ==================== */
export function RotatePanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [angle, setAngle] = useState(90);
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      const { canvas } = await fileToCanvas(file);
      const rad = (angle * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const w = Math.ceil(canvas.width * cos + canvas.height * sin);
      const h = Math.ceil(canvas.width * sin + canvas.height * cos);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const outCtx = out.getContext('2d')!;
      outCtx.translate(w / 2, h / 2);
      outCtx.rotate(rad);
      outCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      return { blob: await canvasToBlob(out, 'image/png'), ext: 'png' };
    }, '旋转结果.zip', '旋转');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <OptionRow label={`旋转角度 ${angle}°`}>
        <input type="range" min={0} max={360} step={15} value={angle} onChange={(e) => setAngle(parseInt(e.target.value))} className="w-full" />
      </OptionRow>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}

/* ==================== 翻转 ==================== */
export function FlipPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [flipH, setFlipH] = useState(true);
  const [flipV, setFlipV] = useState(false);
  const { busy, progress, runBatch } = useBatch(files);

  const handleRun = () =>
    runBatch(async (file) => {
      if (!flipH && !flipV) throw new Error('请至少选择一个翻转方向');
      const { canvas, ctx, img } = await fileToCanvas(file);
      ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(img, 0, 0);
      return { blob: await canvasToBlob(canvas, 'image/png'), ext: 'png' };
    }, '翻转结果.zip', '翻转');

  return (
    <div className="space-y-4">
      <ImageFileDropzone files={files} onChange={setFiles} multiple />
      <ImagePreview files={files} />
      <div className="flex gap-4 text-xs text-muted-foreground">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} />
          水平翻转
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} />
          垂直翻转
        </label>
      </div>
      <RunButton busy={busy} disabled={files.length === 0} onClick={handleRun}>
        开始处理
      </RunButton>
      <ProgressText text={progress} />
    </div>
  );
}
