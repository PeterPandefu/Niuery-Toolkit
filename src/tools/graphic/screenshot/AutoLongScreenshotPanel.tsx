import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Check, LoaderCircle, Monitor, RefreshCw, Rows3, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  LongCaptureAlignmentError,
  LongCaptureRecoverableError,
  runAutoLongCapture,
} from './autoLongCaptureRunner';
import {
  areFramesEquivalent,
  createVerticalStitchPlan,
  type PixelFrame,
} from './longScreenshotStitch';

const LONG_SCREENSHOT_MAX_HEIGHT = 16_384;
const MIN_SELECTION_SIZE = 80;
const SCROLL_DELTA = -720;
const STABILITY_ATTEMPTS = 12;
const STABILITY_DELAY_MS = 160;

interface LongScreenshotSource {
  sourceType: 'window' | 'monitor';
  id: number;
  title: string;
  appName: string;
  processId: number | null;
  width: number;
  height: number;
}

interface NativeScreenshotFrame {
  image: string;
  width: number;
  height: number;
  coordinateWidth: number;
  coordinateHeight: number;
  x: number;
  y: number;
}

interface PreparedSource {
  activeWindowId: number;
  activeProcessId: number;
  pointerX: number;
  pointerY: number;
}

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CroppedFrame {
  image: HTMLImageElement;
  pixels: PixelFrame;
}

interface SourcePreview {
  source: LongScreenshotSource;
  frame: NativeScreenshotFrame;
  image: HTMLImageElement;
}

interface AutoLongScreenshotPanelProps {
  onComplete: (image: HTMLImageElement, wasScaled: boolean) => void;
  onCancel: () => void;
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图画面解码失败'));
    image.src = `data:image/png;base64,${base64}`;
  });
}

function rectangleFromPoints(start: { x: number; y: number }, end: { x: number; y: number }): SelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

async function cropFrame(frame: NativeScreenshotFrame, selection: SelectionRect): Promise<CroppedFrame> {
  const image = await loadImage(frame.image);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(selection.width);
  canvas.height = Math.round(selection.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建截图画布');
  context.drawImage(
    image,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const croppedImage = await loadImage(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''));
  return {
    image: croppedImage,
    pixels: { width: pixels.width, height: pixels.height, data: pixels.data },
  };
}

async function stitchFrames(frames: CroppedFrame[], overlaps: number[]) {
  const plan = createVerticalStitchPlan(
    frames.map((frame) => ({ width: frame.pixels.width, height: frame.pixels.height })),
    overlaps,
    LONG_SCREENSHOT_MAX_HEIGHT,
  );
  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建长截图画布');

  for (const segment of plan.segments) {
    const destinationTop = Math.round(segment.destinationY * plan.scale);
    const destinationBottom = Math.round((segment.destinationY + segment.height) * plan.scale);
    context.drawImage(
      frames[segment.sourceIndex].image,
      0,
      segment.sourceY,
      frames[segment.sourceIndex].pixels.width,
      segment.height,
      0,
      destinationTop,
      plan.width,
      Math.max(1, destinationBottom - destinationTop),
    );
  }

  return { image: await loadImage(canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')), wasScaled: plan.scale < 1 };
}

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return String(error);
}

export function AutoLongScreenshotPanel({ onComplete, onCancel }: AutoLongScreenshotPanelProps) {
  const [sources, setSources] = useState<LongScreenshotSource[]>([]);
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [phase, setPhase] = useState<'sources' | 'selection' | 'countdown' | 'capturing' | 'paused'>('sources');
  const [busy, setBusy] = useState(true);
  const [countdown, setCountdown] = useState(3);
  const [frameCount, setFrameCount] = useState(0);
  const [message, setMessage] = useState('正在查找可截取窗口…');
  const [partialCapture, setPartialCapture] = useState<{ frames: CroppedFrame[]; overlaps: number[] } | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null);
  const cancelledRef = useRef(false);

  const refreshSources = useCallback(async () => {
    setBusy(true);
    setMessage('正在查找可截取窗口…');
    try {
      const next = await invoke<LongScreenshotSource[]>('list_long_screenshot_sources');
      setSources(next);
      if (next.length === 0) setMessage('没有发现可截取的窗口或显示器');
    } catch (error) {
      setMessage(`无法读取截图来源：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshSources();
  }, [refreshSources]);

  const chooseSource = useCallback(async (source: LongScreenshotSource) => {
    setBusy(true);
    setMessage('正在读取目标窗口画面…');
    try {
      const frame = await invoke<NativeScreenshotFrame>('capture_long_screenshot_source', {
        sourceType: source.sourceType,
        sourceId: source.id,
        expectedProcessId: source.processId,
      });
      const image = await loadImage(frame.image);
      setPreview({ source, frame, image });
      setSelection(null);
      setPhase('selection');
      setMessage('拖拽框选需要连续滚动保存的内容区域');
    } catch (error) {
      setMessage(`无法捕获目标窗口：${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const pointForEvent = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const image = imageRef.current;
    if (!image || !preview) return null;
    const bounds = image.getBoundingClientRect();
    const x = Math.max(0, Math.min(preview.frame.width, Math.round((event.clientX - bounds.left) * preview.frame.width / bounds.width)));
    const y = Math.max(0, Math.min(preview.frame.height, Math.round((event.clientY - bounds.top) * preview.frame.height / bounds.height)));
    return { x, y };
  }, [preview]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const point = pointForEvent(event);
    if (!point || phase !== 'selection') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    selectionStartRef.current = point;
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  }, [phase, pointForEvent]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const point = pointForEvent(event);
    const start = selectionStartRef.current;
    if (!point || !start) return;
    setSelection(rectangleFromPoints(start, point));
  }, [pointForEvent]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLImageElement>) => {
    const point = pointForEvent(event);
    const start = selectionStartRef.current;
    selectionStartRef.current = null;
    if (!point || !start) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setSelection(rectangleFromPoints(start, point));
  }, [pointForEvent]);

  const cancelCapture = useCallback(() => {
    cancelledRef.current = true;
    if (phase === 'countdown' || phase === 'capturing') {
      setPhase('selection');
      setMessage('长截图已取消，临时画面已释放');
      return;
    }
    if (phase === 'paused') {
      setPhase('selection');
      setMessage('可调整范围后重试');
      return;
    }
    onCancel();
  }, [onCancel, phase]);

  const startCapture = useCallback(async () => {
    if (!preview || !selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) return;
    cancelledRef.current = false;
    setPartialCapture(null);
    setFrameCount(0);
    setPhase('countdown');
    for (let second = 3; second > 0; second -= 1) {
      setCountdown(second);
      setMessage(`${second} 秒后自动滚动，请勿操作目标窗口`);
      await sleep(1_000);
      if (cancelledRef.current) return;
    }

    setPhase('capturing');
    setMessage('正在自动滚动并采集画面…');
    try {
      const prepared = await invoke<PreparedSource>('prepare_long_screenshot_source', {
        sourceType: preview.source.sourceType,
        sourceId: preview.source.id,
        selectionX: Math.round(selection.x + selection.width / 2),
        selectionY: Math.round(selection.y + selection.height / 2),
        captureWidth: preview.frame.width,
        captureHeight: preview.frame.height,
        expectedProcessId: preview.source.processId,
      });
      if (cancelledRef.current) return;

      const captureSlice = async () => {
        const frame = await invoke<NativeScreenshotFrame>('capture_long_screenshot_source', {
          sourceType: preview.source.sourceType,
          sourceId: preview.source.id,
          expectedProcessId: preview.source.processId,
        });
        return cropFrame(frame, selection);
      };
      const captureStableSlice = async () => {
        let candidate = await captureSlice();
        for (let attempt = 0; attempt < STABILITY_ATTEMPTS; attempt += 1) {
          await sleep(STABILITY_DELAY_MS);
          if (cancelledRef.current) return candidate;
          const next = await captureSlice();
          if (areFramesEquivalent(candidate.pixels, next.pixels, 3)) return next;
          candidate = next;
        }
        throw new Error('滚动后的内容未稳定，请关闭动画或悬浮提示后重试');
      };

      const result = await runAutoLongCapture({
        captureInitial: async () => {
          const initial = await captureSlice();
          setFrameCount(1);
          return initial;
        },
        captureAfterScroll: captureStableSlice,
        scroll: () => invoke('scroll_long_screenshot_source', {
          activeWindowId: prepared.activeWindowId,
          activeProcessId: prepared.activeProcessId,
          pointerX: prepared.pointerX,
          pointerY: prepared.pointerY,
          wheelDelta: SCROLL_DELTA,
        }),
        toPixels: (frame) => frame.pixels,
        shouldStop: () => cancelledRef.current,
        onFrameAccepted: setFrameCount,
      });
      if (result.endedBy === 'cancelled') {
        setPhase('selection');
        setMessage('长截图已取消，临时画面已释放');
        return;
      }
      const stitched = await stitchFrames(result.frames, result.overlaps);
      onComplete(stitched.image, stitched.wasScaled);
    } catch (error) {
      const alignmentError = error instanceof LongCaptureAlignmentError;
      const recoverableError = error instanceof LongCaptureRecoverableError;
      if (recoverableError) {
        setPartialCapture({ frames: error.frames, overlaps: error.overlaps });
      }
      setPhase('paused');
      setMessage(alignmentError
        ? '相邻画面无法可靠对齐：可重新开始、结束并保留已成功部分，或取消。'
        : recoverableError
          ? `${error.message}：可结束并保留已成功部分，或取消。`
          : errorMessage(error));
    }
  }, [onComplete, preview, selection]);

  const finishWithVerifiedFrames = useCallback(async () => {
    if (!partialCapture) return;
    try {
      const stitched = await stitchFrames(partialCapture.frames, partialCapture.overlaps);
      onComplete(stitched.image, stitched.wasScaled);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [onComplete, partialCapture]);

  const canStart = !!selection && selection.width >= MIN_SELECTION_SIZE && selection.height >= MIN_SELECTION_SIZE;
  const isCapturing = phase === 'countdown' || phase === 'capturing';

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Rows3 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">自动长截图</h2>
          <p className="mt-1 text-sm text-muted-foreground">选择窗口并框选滚动区域后，工具会自动滚动、识别重叠并生成一张完整长图。</p>
          <p className="mt-1 text-xs text-muted-foreground">全程本地处理；采集期间请勿移动鼠标、点击或切换目标窗口。</p>
        </div>
        <Button variant="ghost" size="icon" onClick={cancelCapture} aria-label="取消长截图"><X className="h-4 w-4" /></Button>
      </div>

      {phase === 'sources' && (
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h3 className="font-medium">选择截图来源</h3><p className="text-xs text-muted-foreground">默认选择应用窗口；整屏仅作为备用来源。</p></div>
            <Button variant="outline" size="sm" onClick={() => void refreshSources()} disabled={busy}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />刷新</Button>
          </div>
          {busy ? <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />{message}</div> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sources.map((source) => (
                <button key={`${source.sourceType}-${source.id}`} className="flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/60 hover:bg-primary/5" onClick={() => void chooseSource(source)}>
                  <span className="rounded-md bg-muted p-2 text-muted-foreground"><Monitor className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{source.title}</span><span className="block truncate text-xs text-muted-foreground">{source.appName} · {source.width} × {source.height}</span></span>
                </button>
              ))}
              {sources.length === 0 && <p className="py-8 text-sm text-muted-foreground">{message}</p>}
            </div>
          )}
        </section>
      )}

      {preview && phase !== 'sources' && (
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0"><h3 className="truncate font-medium">{preview.source.title}</h3><p className="text-xs text-muted-foreground">{message}</p></div>
            {!isCapturing && <Button variant="outline" size="sm" onClick={() => { setPhase('sources'); setPreview(null); setSelection(null); }}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />换一个窗口</Button>}
          </div>
          <div className="overflow-auto rounded-lg bg-muted/40 p-3">
            <div className="relative mx-auto w-fit">
              <img
                ref={imageRef}
                src={preview.image.src}
                alt="目标窗口预览"
                className="max-h-[55vh] max-w-full select-none rounded border"
                draggable={false}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              />
              {selection && selection.width > 0 && selection.height > 0 && (
                <div className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: `${selection.x / preview.frame.width * 100}%`, top: `${selection.y / preview.frame.height * 100}%`, width: `${selection.width / preview.frame.width * 100}%`, height: `${selection.height / preview.frame.height * 100}%` }}>
                  <span className="absolute -top-6 left-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground whitespace-nowrap">{selection.width} × {selection.height}</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">只框选会滚动的内容，避免包含地址栏、侧栏和悬浮控件。</span>
            <div className="flex gap-2">
              {phase === 'paused' && partialCapture && <Button variant="outline" size="sm" onClick={() => void finishWithVerifiedFrames()}>结束并保留 {partialCapture.frames.length} 段</Button>}
              {phase === 'paused' && <Button variant="outline" size="sm" onClick={() => void startCapture()} disabled={!canStart}>重新开始</Button>}
              <Button size="sm" onClick={() => void startCapture()} disabled={!canStart || isCapturing}>
                {phase === 'countdown' ? `${countdown} 秒后开始` : phase === 'capturing' ? <><LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />已采集 {frameCount} 段</> : <><Check className="mr-1.5 h-3.5 w-3.5" />开始自动长截图</>}
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
