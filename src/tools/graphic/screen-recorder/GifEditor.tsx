import { useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { Crop, Download, FileImage, Maximize2, MousePointer2, Pause, Play, RotateCcw, Square, Type, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { GifAnnotation, GifProject, RecorderAction } from './types';
import { decodeGif, encodeGif, type DecodedGif, type GifWorkerResponse } from './gif-worker';
import { Timeline } from './Timeline';
import { createLogger } from '@/lib/logger';
import { saveBytesWithFeedback } from '@/lib/file-save';

const log = createLogger('screen-recorder:gif-editor');

interface GifEditorProps {
  project: GifProject;
  dispatch: Dispatch<RecorderAction>;
  onBack: () => void;
}

type MarkupTool = 'select' | 'rect' | 'arrow' | 'text' | 'mosaic';

export function GifEditor({ project, dispatch, onBack }: GifEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<MarkupTool>('select');
  const [annotationText, setAnnotationText] = useState('标注');
  const [annotationColor, setAnnotationColor] = useState('#ff3b30');
  const [applyToAll, setApplyToAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loopCount, setLoopCount] = useState(project.loopCount);
  const [resizeW, setResizeW] = useState(String(project.width || ''));
  const [resizeH, setResizeH] = useState(String(project.height || ''));
  const [cropX, setCropX] = useState('0');
  const [cropY, setCropY] = useState('0');
  const [cropW, setCropW] = useState(String(project.width || ''));
  const [cropH, setCropH] = useState(String(project.height || ''));
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedFrame = project.frames[project.selectedIndex];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedFrame) return;
    canvas.width = selectedFrame.width;
    canvas.height = selectedFrame.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(selectedFrame.rgba), selectedFrame.width, selectedFrame.height), 0, 0);
    selectedFrame.annotations.forEach((annotation) => drawAnnotation(ctx, annotation));
  }, [selectedFrame]);

  useEffect(() => {
    if (!playing || project.frames.length === 0) return;
    const delay = Math.max(30, project.frames[project.selectedIndex]?.delayMs ?? 100);
    const timer = window.setTimeout(() => {
      const next = (project.selectedIndex + 1) % project.frames.length;
      dispatch({ type: 'gifSelected', index: next });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [dispatch, playing, project.frames.length, project.selectedIndex, project.frames]);

  const loadGif = async (file: File) => {
    setBusy(true);
    try {
      log.info('GIF 加载开始', { name: file.name, size: file.size });
      const decoded = await decodeGifInWorker(await file.arrayBuffer());
      dispatch({ type: 'gifLoaded', ...decoded });
      setResizeW(String(decoded.width));
      setResizeH(String(decoded.height));
      setCropW(String(decoded.width));
      setCropH(String(decoded.height));
      log.info('GIF 解析成功', {
        name: file.name,
        width: decoded.width,
        height: decoded.height,
        frames: decoded.frames.length,
      });
    } catch (e) {
      log.error('GIF 加载失败', { name: file.name, error: e });
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedFrame || tool === 'select') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * selectedFrame.width;
    const y = ((event.clientY - rect.top) / rect.height) * selectedFrame.height;
    const annotation: GifAnnotation = {
      id: `annotation-${Date.now()}`,
      type: tool,
      x,
      y,
      width: tool === 'rect' || tool === 'mosaic' ? Math.min(160, selectedFrame.width - x) : undefined,
      height: tool === 'rect' || tool === 'mosaic' ? Math.min(90, selectedFrame.height - y) : undefined,
      text: tool === 'text' ? annotationText : undefined,
      color: annotationColor,
      points: tool === 'arrow' ? [Math.max(0, x - 80), Math.max(0, y - 40), x, y] : undefined,
    };
    dispatch({ type: 'gifAnnotationAdded', annotation, applyToAll });
  };

  const handleResize = () => {
    const width = Math.max(1, Number(resizeW));
    const height = Math.max(1, Number(resizeH));
    if (!selectedFrame || width === selectedFrame.width && height === selectedFrame.height) return;
    const frames = project.frames.map((frame) => {
      const source = document.createElement('canvas');
      source.width = frame.width;
      source.height = frame.height;
      source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
      const target = document.createElement('canvas');
      target.width = width;
      target.height = height;
      const ctx = target.getContext('2d');
      ctx?.drawImage(source, 0, 0, width, height);
      return { ...frame, width, height, rgba: ctx?.getImageData(0, 0, width, height).data ?? frame.rgba };
    });
    dispatch({ type: 'gifLoaded', frames, width, height, loopCount: project.loopCount });
    log.info('GIF 缩放完成', { width, height, frames: frames.length });
  };

  const exportGif = async () => {
    if (!project.frames.length) return;
    setBusy(true);
    try {
      log.info('GIF 导出开始', { frames: project.frames.length, loopCount });
      const blob = encodeGif(project.frames, loopCount, 800);
      const filename = `edited-${new Date().toISOString().replace(/[:.]/g, '-')}.gif`;
      await saveBytesWithFeedback(filename, blob, 'GIF 动图', ['gif']);
      dispatch({ type: 'gifLoopChanged', loopCount });
      log.info('GIF 导出完成', { size: blob.size, frames: project.frames.length });
    } catch (e) {
      log.error('GIF 导出失败', e);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const handleCrop = () => {
    if (!selectedFrame) return;
    const x = Math.max(0, Math.min(selectedFrame.width - 1, Number(cropX)));
    const y = Math.max(0, Math.min(selectedFrame.height - 1, Number(cropY)));
    const width = Math.max(1, Math.min(selectedFrame.width - x, Number(cropW)));
    const height = Math.max(1, Math.min(selectedFrame.height - y, Number(cropH)));
    const frames = project.frames.map((frame) => {
      const source = document.createElement('canvas');
      source.width = frame.width;
      source.height = frame.height;
      source.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
      const ctx = source.getContext('2d');
      return { ...frame, width, height, rgba: ctx?.getImageData(x, y, width, height).data ?? frame.rgba };
    });
    dispatch({ type: 'gifLoaded', frames, width, height, loopCount: project.loopCount });
    log.info('GIF 裁剪完成', { width, height, frames: frames.length });
    setResizeW(String(width));
    setResizeH(String(height));
    setCropX('0');
    setCropY('0');
    setCropW(String(width));
    setCropH(String(height));
  };

  if (!project.frames.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FileImage className="h-12 w-12 text-muted-foreground/50" />
        <div>
          <h2 className="font-heading text-lg font-semibold">GIF 编辑器</h2>
          <p className="mt-1 text-sm text-muted-foreground">导入 GIF 后即可删帧、排序、加标注并导出。</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => fileInputRef.current?.click()}><FileImage className="h-4 w-4" />导入 GIF</Button>
          <Button variant="outline" onClick={onBack}>返回录屏</Button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/gif,.gif" className="hidden" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void loadGif(file);
          event.target.value = '';
        }} />
        {busy && <span className="text-xs text-muted-foreground">正在解析 GIF…</span>}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border/70 px-4 py-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}><RotateCcw className="h-4 w-4" />返回录屏</Button>
          <span className="text-sm font-semibold">GIF 编辑器</span>
          <span className="text-xs text-muted-foreground">{project.width} × {project.height} · {project.frames.length} 帧</span>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept="image/gif,.gif" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void loadGif(file);
            event.target.value = '';
          }} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><FileImage className="h-4 w-4" />打开 GIF</Button>
          <Button size="sm" onClick={exportGif} disabled={busy}><Download className="h-4 w-4" />导出 GIF</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-6">
          <div className="relative max-h-full max-w-full rounded-lg border border-border bg-checkerboard p-2 shadow-tinted-sm">
            <canvas ref={canvasRef} onDoubleClick={handleCanvasDoubleClick} className="block max-h-[58vh] max-w-full cursor-crosshair" aria-label="GIF 画布，双击添加标注" />
            {tool !== 'select' && <div className="pointer-events-none absolute left-4 top-4 rounded bg-black/65 px-2 py-1 text-[10px] text-white">双击画布添加{tool === 'text' ? '文字' : '标注'}</div>}
          </div>
        </div>

        <aside className="w-64 shrink-0 overflow-y-auto border-l border-border/70 bg-card/60 p-4">
          <div className="space-y-4">
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">播放</p>
              <Button variant="outline" className="w-full" onClick={() => setPlaying((value) => !value)}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? '暂停预览' : '播放预览'}
              </Button>
            </section>
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">画布标注</p>
              <div className="grid grid-cols-2 gap-1.5">
                <Button variant={tool === 'select' ? 'secondary' : 'outline'} size="sm" onClick={() => setTool('select')}><MousePointer2 className="h-3.5 w-3.5" />选择</Button>
                <Button variant={tool === 'rect' ? 'secondary' : 'outline'} size="sm" onClick={() => setTool('rect')}><Square className="h-3.5 w-3.5" />矩形</Button>
                <Button variant={tool === 'arrow' ? 'secondary' : 'outline'} size="sm" onClick={() => setTool('arrow')}><Wand2 className="h-3.5 w-3.5" />箭头</Button>
                <Button variant={tool === 'text' ? 'secondary' : 'outline'} size="sm" onClick={() => setTool('text')}><Type className="h-3.5 w-3.5" />文字</Button>
                <Button variant={tool === 'mosaic' ? 'secondary' : 'outline'} size="sm" onClick={() => setTool('mosaic')}><Crop className="h-3.5 w-3.5" />马赛克</Button>
              </div>
              <div className="mt-2 space-y-2">
                <Input value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} placeholder="标注文字" />
                <div className="flex items-center gap-2">
                  <input type="color" value={annotationColor} onChange={(event) => setAnnotationColor(event.target.value)} className="h-8 w-10 rounded border border-input bg-transparent" aria-label="标注颜色" />
                  <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} />应用到全部帧</label>
                </div>
              </div>
            </section>
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">画布尺寸</p>
              <div className="flex items-center gap-2">
                <Input type="number" min={1} value={resizeW} onChange={(event) => setResizeW(event.target.value)} aria-label="画布宽度" />
                <span className="text-xs text-muted-foreground">×</span>
                <Input type="number" min={1} value={resizeH} onChange={(event) => setResizeH(event.target.value)} aria-label="画布高度" />
              </div>
              <Button variant="outline" className="mt-2 w-full" onClick={handleResize}><Maximize2 className="h-4 w-4" />应用缩放</Button>
            </section>
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">裁剪全部帧</p>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" min={0} value={cropX} onChange={(event) => setCropX(event.target.value)} aria-label="裁剪 X" placeholder="X" />
                <Input type="number" min={0} value={cropY} onChange={(event) => setCropY(event.target.value)} aria-label="裁剪 Y" placeholder="Y" />
                <Input type="number" min={1} value={cropW} onChange={(event) => setCropW(event.target.value)} aria-label="裁剪宽度" placeholder="宽度" />
                <Input type="number" min={1} value={cropH} onChange={(event) => setCropH(event.target.value)} aria-label="裁剪高度" placeholder="高度" />
              </div>
              <Button variant="outline" className="mt-2 w-full" onClick={handleCrop}><Crop className="h-4 w-4" />应用裁剪</Button>
            </section>
            <section>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">循环</p>
              <Select
                value={String(loopCount)}
                onChange={(event) => setLoopCount(Number(event.target.value))}
                options={[{ value: '0', label: '无限循环' }, { value: '1', label: '播放 1 次' }, { value: '2', label: '播放 2 次' }]}
              />
            </section>
          </div>
        </aside>
      </div>

      <Timeline
        frames={project.frames}
        selectedIndex={project.selectedIndex}
        onSelect={(index) => dispatch({ type: 'gifSelected', index })}
        onDelete={(index) => dispatch({ type: 'gifDeleted', index })}
        onDuplicate={(index) => dispatch({ type: 'gifDuplicated', index })}
        onReorder={(from, to) => dispatch({ type: 'gifReordered', from, to })}
        onDelayChange={(index, delayMs) => dispatch({ type: 'gifDelayChanged', index, delayMs })}
      />
    </div>
  );
}

function decodeGifInWorker(buffer: ArrayBuffer): Promise<DecodedGif> {
  if (typeof Worker === 'undefined') return Promise.resolve(decodeGif(buffer));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<GifWorkerResponse>) => {
      worker.terminate();
      if (event.data.type === 'decoded' && event.data.payload && !(event.data.payload instanceof ArrayBuffer)) {
        resolve(event.data.payload);
      } else {
        reject(new Error(event.data.error ?? 'GIF 解析失败'));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('GIF 解析线程发生错误'));
    };
    worker.postMessage({ type: 'decode', id: `decode-${Date.now()}`, buffer }, [buffer]);
  });
}

function drawAnnotation(ctx: CanvasRenderingContext2D, annotation: GifAnnotation) {
  ctx.strokeStyle = annotation.color ?? '#ff3b30';
  ctx.fillStyle = annotation.color ?? '#ff3b30';
  ctx.lineWidth = 4;
  if (annotation.type === 'rect') ctx.strokeRect(annotation.x, annotation.y, annotation.width ?? 0, annotation.height ?? 0);
  if (annotation.type === 'mosaic') {
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(annotation.x, annotation.y, annotation.width ?? 40, annotation.height ?? 40);
  }
  if (annotation.type === 'text') {
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(annotation.text ?? '', annotation.x, annotation.y);
  }
  if (annotation.type === 'arrow' && annotation.points && annotation.points.length >= 4) {
    ctx.beginPath();
    ctx.moveTo(annotation.points[0], annotation.points[1]);
    ctx.lineTo(annotation.points[2], annotation.points[3]);
    ctx.stroke();
  }
}
