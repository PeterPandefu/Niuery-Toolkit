import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import type Konva from 'konva';
import { SelectionBox } from './SelectionBox';
import { toast } from 'sonner';
import { AnnotationLayer } from './AnnotationLayer';
import { EditToolbar } from './EditToolbar';
import { ScreenshotOcrPanel } from '@/components/ocr/ScreenshotOcrPanel';
import { saveBytesWithFeedback } from '@/lib/file-save';
import {
  type ScreenshotPhase,
  type SelectionMode,
  type ScreenshotTool,
  type SelectionRect,
  type AnnotationItem,
  MIN_SELECTION_SIZE,
  MOSAIC_BLOCK_SIZE,
  FREEHAND_MIN_POINTS,
} from './types';

interface ScreenshotOverlayProps {
  generation: number;
  screenImage: HTMLImageElement;
  screenW: number;
  screenH: number;
  /** 长截图模式：框选可滚动区域后发送给主窗口，不做标注 */
  longshotMode?: boolean;
}

export function ScreenshotOverlay({ generation, screenImage, screenW, screenH, longshotMode = false }: ScreenshotOverlayProps) {
  const [phase, setPhase] = useState<ScreenshotPhase>('idle');
  const [mode, setMode] = useState<SelectionMode>('rect');
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[]>([]);
  const [freehandSelection, setFreehandSelection] = useState<{ x: number; y: number }[]>([]);
  const [tool, setTool] = useState<ScreenshotTool>('arrow');
  const [color, setColor] = useState('#ff4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fontSize, setFontSize] = useState(20);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [history, setHistory] = useState<AnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationItem[][]>([]);
  const [numberCounter, setNumberCounter] = useState(1);
  const [ocrSource, setOcrSource] = useState<Blob | null>(null);
  const [ocrImageDataUrl, setOcrImageDataUrl] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [ocrAutoTranslate, setOcrAutoTranslate] = useState(false);
  /** 长截图捕获间隔（框选阶段配置，确认后锁定） */
  const [longshotIntervalMs, setLongshotIntervalMs] = useState(1000);
  /** 长截图滚动模式：自动滚动（默认）/ 手动滚动，框选阶段配置，确认后锁定 */
  const [longshotAutoScroll, setLongshotAutoScroll] = useState(true);

  const stageRef = useRef<Konva.Stage | null>(null);
  const selStart = useRef<{ x: number; y: number } | null>(null);
  const isDrawing = useRef(false);
  // 框选起始事件与 React effect 之间不能存在空档：用户按下后可在同一事件循环内
  // 完成移动和松开。该清理函数保存当前同步安装的监听器，确保任意路径都能取消它们。
  const mouseTrackingCleanup = useRef<(() => void) | null>(null);

  const stopMouseTracking = useCallback(() => {
    const cleanup = mouseTrackingCleanup.current;
    mouseTrackingCleanup.current = null;
    cleanup?.();
  }, []);

  useEffect(() => stopMouseTracking, [stopMouseTracking]);

  // ── 裁剪选区图片（用于标注画布背景 & 马赛克取色）──────────
  const { croppedImage, croppedCanvas } = useMemo(() => {
    if (!selection || selection.width < 1 || selection.height < 1) return { croppedImage: null, croppedCanvas: null };
    const c = document.createElement('canvas');
    c.width = Math.round(selection.width);
    c.height = Math.round(selection.height);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, selection.width, selection.height);
    if (freehandSelection.length) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(freehandSelection[0].x - selection.x, freehandSelection[0].y - selection.y);
      freehandSelection.slice(1).forEach((point) => {
        ctx.lineTo(point.x - selection.x, point.y - selection.y);
      });
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(
      screenImage,
      selection.x, selection.y, selection.width, selection.height,
      0, 0, selection.width, selection.height,
    );
    if (freehandSelection.length) ctx.restore();
    // canvas 立即可用于 getImageData（同步）
    const img = new Image();
    img.src = c.toDataURL('image/png');
    return { croppedImage: img, croppedCanvas: c };
  }, [freehandSelection, screenImage, selection]);

  // ── 标注变更（带历史记录）──────────────────────────────────
  const handleAnnotationsChange = useCallback(
    (items: AnnotationItem[]) => {
      setHistory((h) => [...h, annotations]);
      setRedoStack([]);
      setAnnotations(items);
    },
    [annotations],
  );

  const undo = useCallback(() => {
    if (!history.length) return;
    const prev = history[history.length - 1];
    setRedoStack((r) => [...r, annotations]);
    setAnnotations(prev);
    setHistory((h) => h.slice(0, -1));
  }, [history, annotations]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setHistory((h) => [...h, annotations]);
    setAnnotations(next);
    setRedoStack((r) => r.slice(0, -1));
  }, [redoStack, annotations]);

  // ── 复制 / 保存 / 取消 ────────────────────────────────────
  const exportBase64 = useCallback((): string | null => {
    const stage = stageRef.current;
    if (!stage || !selection) return null;
    const w = Math.round(selection.width);
    const h = Math.round(selection.height);
    // 使用 toCanvas() 同步获取 Konva 渲染结果
    const stageCanvas = stage.toCanvas({ pixelRatio: 1 });
    // 合成马赛克（因为 DOM canvas 不在 Konva 场景图中）
    const hasMosaic = annotations.some((a) => a.tool === 'mosaic' && a.mosaicBlocks?.length);
    if (!hasMosaic) {
      return stageCanvas.toDataURL('image/png').replace(/^data:image\/\w+;base64,/, '');
    }
    const composite = document.createElement('canvas');
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext('2d')!;
    ctx.drawImage(stageCanvas, 0, 0, w, h);
    for (const a of annotations) {
      if (a.tool === 'mosaic' && a.mosaicBlocks) {
        const bs = a.mosaicBlockSize || MOSAIC_BLOCK_SIZE;
        for (const b of a.mosaicBlocks) {
          ctx.fillStyle = b.color;
          ctx.fillRect(b.x, b.y, bs, bs);
        }
      }
    }
    return composite.toDataURL('image/png').replace(/^data:image\/\w+;base64,/, '');
  }, [selection, annotations]);

  const closeCurrentScreenshot = useCallback(() => {
    // 截图窗口隐藏后 WebView 会被复用而非卸载；关闭前必须同步断开本次
    // 鼠标跟踪，避免迟到的 mouseup 将已经取消的会话重新推进到 selected。
    stopMouseTracking();
    selStart.current = null;
    isDrawing.current = false;
    return invoke('close_screenshot_window', { generation });
  }, [generation, stopMouseTracking]);

  const handleCopy = useCallback(async () => {
    const b64 = exportBase64();
    if (b64) {
      try { await invoke('copy_image_to_clipboard', { base64Data: b64 }); }
      catch (e) { console.error('复制失败', e); }
    }
    await closeCurrentScreenshot();
  }, [closeCurrentScreenshot, exportBase64]);

  const handleSave = useCallback(async () => {
    const b64 = exportBase64();
    if (b64) {
      try {
        const binary = atob(b64);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        await saveBytesWithFeedback(`screenshot-${Date.now()}.png`, bytes, 'PNG 图像', ['png']);
      }
      catch (e) { console.error('保存失败', e); }
    }
    await closeCurrentScreenshot();
  }, [closeCurrentScreenshot, exportBase64]);

  const handleCancel = useCallback(() => {
    if (ocrSource && ocrText.trim() && !window.confirm('关闭截图将丢失未保存的识别文本，是否继续？')) return;
    closeCurrentScreenshot();
  }, [closeCurrentScreenshot, ocrSource, ocrText]);

  const openOcr = useCallback((autoTranslate: boolean) => {
    if (!croppedCanvas) return;
    croppedCanvas.toBlob((blob) => {
      if (!blob) {
        toast.error('识别图片生成失败，请重试');
        return;
      }
      setOcrSource(blob);
      setOcrImageDataUrl(croppedCanvas.toDataURL('image/png'));
      setOcrAutoTranslate(autoTranslate);
    }, 'image/png');
  }, [croppedCanvas]);

  const translateOcrText = useCallback(async (text: string) => {
    if (!ocrImageDataUrl) return;
    await emitTo('main', 'open-screenshot-ocr', { imageDataUrl: ocrImageDataUrl, text, translate: true });
    await closeCurrentScreenshot();
  }, [closeCurrentScreenshot, ocrImageDataUrl]);

  // ── 长截图：确认选区并发送给主窗口 ───────────────────
  const confirmLongshot = useCallback(() => {
    if (!selection || selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE) return;
    emitTo('main', 'longshot-region-selected', {
      x: Math.round(selection.x),
      y: Math.round(selection.y),
      width: Math.round(selection.width),
      height: Math.round(selection.height),
      intervalMs: longshotIntervalMs,
      autoScroll: longshotAutoScroll,
    }).catch((e) => console.error('发送长截图选区失败', e));
    closeCurrentScreenshot();
  }, [closeCurrentScreenshot, selection, longshotIntervalMs, longshotAutoScroll]);

  const confirmLongshotRef = useRef(confirmLongshot);
  confirmLongshotRef.current = confirmLongshot;

  const reselectLongshot = useCallback(() => {
    setSelection(null);
    setPhase('idle');
  }, []);

  // 用 ref 保存 handleCopy 供键盘事件使用（避免闭包过期）
  const copyRef = useRef(handleCopy);
  copyRef.current = handleCopy;

  // ── 手绘确认：计算外接矩形 ────────────────────────────────
  const confirmFreehand = useCallback(() => {
    if (freehandPoints.length < FREEHAND_MIN_POINTS) return;
    const xs = freehandPoints.map((p) => p.x);
    const ys = freehandPoints.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < MIN_SELECTION_SIZE && h < MIN_SELECTION_SIZE) return;
    setSelection({ x: minX, y: minY, width: w, height: h });
    setFreehandSelection(freehandPoints);
    setFreehandPoints([]);
    setPhase('selected');
  }, [freehandPoints]);

  const confirmFreehandRef = useRef(confirmFreehand);
  confirmFreehandRef.current = confirmFreehand;

  // ── 初始框选 / 手绘（idle 阶段）──────────────────────────
  const handleBgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      stopMouseTracking();

      // 点击选区外部 → 重新框选
      if (phase === 'selected') {
        setAnnotations([]);
        setHistory([]);
        setRedoStack([]);
        setNumberCounter(1);
        setFreehandSelection([]);
      }

      if (mode === 'freehand') {
        setFreehandSelection([]);
        // 手绘模式：开始绘制轨迹
        isDrawing.current = true;
        setFreehandPoints([{ x: e.clientX, y: e.clientY }]);
        setPhase('drawing');

        const onMove = (event: MouseEvent) => {
          if (!isDrawing.current) return;
          setFreehandPoints((points) => [...points, { x: event.clientX, y: event.clientY }]);
        };
        const onUp = () => {
          isDrawing.current = false;
          stopMouseTracking();
        };
        const onBlur = () => {
          isDrawing.current = false;
          setFreehandPoints([]);
          setPhase('idle');
          stopMouseTracking();
        };
        const cleanup = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('blur', onBlur);
        };
        mouseTrackingCleanup.current = cleanup;
        // 必须在本次 mousedown 返回前安装，不能依赖 phase 更新后的 useEffect。
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('blur', onBlur);
      } else {
        // 矩形模式
        const start = { x: e.clientX, y: e.clientY };
        selStart.current = start;
        setSelection({ x: start.x, y: start.y, width: 0, height: 0 });
        setPhase('selecting');

        const onMove = (event: MouseEvent) => {
          const selectionStart = selStart.current;
          if (!selectionStart) return;
          setSelection({
            x: Math.min(selectionStart.x, event.clientX),
            y: Math.min(selectionStart.y, event.clientY),
            width: Math.abs(event.clientX - selectionStart.x),
            height: Math.abs(event.clientY - selectionStart.y),
          });
        };
        const onUp = (event: MouseEvent) => {
          const selectionStart = selStart.current;
          selStart.current = null;
          if (!selectionStart) {
            stopMouseTracking();
            return;
          }
          const width = Math.abs(event.clientX - selectionStart.x);
          const height = Math.abs(event.clientY - selectionStart.y);
          if (width < MIN_SELECTION_SIZE && height < MIN_SELECTION_SIZE) {
            setPhase('idle');
            setSelection(null);
          } else {
            setPhase('selected');
          }
          stopMouseTracking();
        };
        const onBlur = () => {
          selStart.current = null;
          setSelection(null);
          setPhase('idle');
          stopMouseTracking();
        };
        const cleanup = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('blur', onBlur);
        };
        mouseTrackingCleanup.current = cleanup;
        // 与 mousedown 同步安装，保证快速拖拽的 move/up 不会丢失。
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('blur', onBlur);
      }
    },
    [mode, phase, stopMouseTracking],
  );

  // ── 全局快捷键 ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 当焦点在输入框内时，不拦截键盘事件（由 textarea 自行处理）
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Escape') {
        if (phase === 'drawing') {
          // 手绘阶段：清空轨迹回到 idle
          stopMouseTracking();
          setFreehandPoints([]);
          isDrawing.current = false;
          setPhase('idle');
        } else {
          closeCurrentScreenshot();
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) { redo(); } else { undo(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (phase === 'drawing') { confirmFreehandRef.current(); }
        else if (phase === 'selected') {
          if (longshotMode) { confirmLongshotRef.current(); }
          else { copyRef.current(); }
        }
        return;
      }
      // M 键切换模式（仅 idle 阶段，长截图模式仅支持矩形框选）
      if ((e.key === 'm' || e.key === 'M') && phase === 'idle' && !longshotMode) {
        e.preventDefault();
        setMode((m) => (m === 'freehand' ? 'rect' : 'freehand'));
        setFreehandPoints([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeCurrentScreenshot, phase, undo, redo, longshotMode, stopMouseTracking]);

  // ── 工具栏位置（选区下方，空间不足则上方）────────────────
  const toolbarPos = useMemo(() => {
    if (!selection) return { x: 0, y: 0 };
    const TW = longshotMode ? 570 : 530, TH = 42;
    const tx = Math.max(4, Math.min(selection.x + selection.width / 2 - TW / 2, screenW - TW - 4));
    const below = selection.y + selection.height + 8;
    const ty = below + TH < screenH ? below : Math.max(4, selection.y - TH - 8);
    return { x: tx, y: ty };
  }, [selection, screenW, screenH, longshotMode]);

  const handleSelectionChange = useCallback((nextSelection: SelectionRect) => {
    setSelection(nextSelection);
    setFreehandSelection([]);
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ cursor: phase === 'selected' ? 'default' : 'crosshair' }}
      onMouseDown={handleBgMouseDown}
    >
      {/* 背景截图 */}
      <img
        src={screenImage.src}
        className="pointer-events-none fixed left-0 top-0 select-none"
        style={{ width: screenW, height: screenH }}
        draggable={false}
        alt=""
      />

      {/* 空闲时明确标识全屏截图层，避免静态屏幕画面被误认为应用或浏览器卡死 */}
      {phase === 'idle' && (
        <div
          data-testid="screenshot-idle-mask"
          className="pointer-events-none fixed inset-0 z-10 bg-black/20"
        />
      )}

      {/* 手绘轨迹渲染 */}
      {phase === 'drawing' && freehandPoints.length > 1 && (
        <svg
          className="pointer-events-none fixed inset-0 z-30"
          width={screenW}
          height={screenH}
        >
          <polyline
            points={freehandPoints.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="#4488ff"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* 框选中的临时遮罩 */}
      {phase === 'selecting' && selection && (
        <div
          className="pointer-events-none fixed z-20"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
            outline: '1.5px solid rgba(255,255,255,0.85)',
          }}
        />
      )}

      {/* 已确认选区 */}
      {phase === 'selected' && selection && (
        <>
          {/* 选区边框 + 遮罩 + 手柄 */}
          <SelectionBox
            selection={selection}
            screenW={screenW}
            screenH={screenH}
            onSelectionChange={handleSelectionChange}
            onDoubleClick={longshotMode ? confirmLongshot : handleCopy}
          />

          {/* 长截图模式：动作按钮（代替标注工具栏） */}
          {longshotMode ? (
            <div
              className="fixed z-30 flex items-center gap-1 rounded-lg bg-[#2a2a2a]/95 px-2 py-1.5 shadow-lg"
              style={{ left: toolbarPos.x, top: toolbarPos.y }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {/* 滚动模式切换：仅在框选阶段可调，确认后锁定 */}
              <div className="flex items-center rounded bg-white/10 p-0.5 text-xs">
                <button
                  className={`rounded px-2 py-0.5 ${longshotAutoScroll ? 'bg-[#4488ff] text-white' : 'text-white/70 hover:text-white'}`}
                  onClick={() => setLongshotAutoScroll(true)}
                >
                  自动
                </button>
                <button
                  className={`rounded px-2 py-0.5 ${!longshotAutoScroll ? 'bg-[#4488ff] text-white' : 'text-white/70 hover:text-white'}`}
                  onClick={() => setLongshotAutoScroll(false)}
                >
                  手动
                </button>
              </div>
              <div className="h-4 w-px bg-white/20" />
              {/* 捕获间隔配置：仅在框选阶段可调，确认后锁定 */}
              <label className="flex items-center gap-1.5 pl-1 text-xs text-white/70">
                间隔
                <input
                  type="range"
                  min={300}
                  max={3000}
                  step={100}
                  value={longshotIntervalMs}
                  onChange={(e) => setLongshotIntervalMs(Number(e.target.value))}
                  className="h-1 w-28 accent-[#4488ff]"
                  aria-label="捕获间隔"
                />
                <span className="w-8 text-right font-mono text-white/85">
                  {(longshotIntervalMs / 1000).toFixed(1)}s
                </span>
              </label>
              <div className="h-4 w-px bg-white/20" />
              <button
                className="rounded bg-[#4488ff] px-3 py-1 text-sm text-white hover:bg-[#3377ee]"
                onClick={confirmLongshot}
              >
                开始长截图
              </button>
              <button
                className="rounded px-3 py-1 text-sm text-white/85 hover:bg-white/10"
                onClick={reselectLongshot}
              >
                重新框选
              </button>
              <button
                className="rounded px-3 py-1 text-sm text-white/85 hover:bg-white/10"
                onClick={handleCancel}
              >
                取消
              </button>
            </div>
          ) : (
            <>
              {/* 标注画布（精确覆盖选区） */}
              <div
                className="fixed z-20"
                style={{ left: selection.x, top: selection.y }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <AnnotationLayer
                  width={Math.round(selection.width)}
                  height={Math.round(selection.height)}
                  croppedImage={croppedImage}
                  croppedCanvas={croppedCanvas}
                  tool={tool}
                  color={color}
                  strokeWidth={strokeWidth}
                  fontSize={fontSize}
                  annotations={annotations}
                  onAnnotationsChange={handleAnnotationsChange}
                  numberCounter={numberCounter}
                  onNumberCounterChange={setNumberCounter}
                  stageRef={stageRef}
                />
              </div>

              {/* 微信风格工具栏 */}
              <EditToolbar
                x={toolbarPos.x}
                y={toolbarPos.y}
                tool={tool}
                color={color}
                strokeWidth={strokeWidth}
                fontSize={fontSize}
                canUndo={history.length > 0}
                canRedo={redoStack.length > 0}
                onToolChange={setTool}
                onColorChange={setColor}
                onStrokeWidthChange={setStrokeWidth}
                onFontSizeChange={setFontSize}
                onUndo={undo}
                onRedo={redo}
                onCancel={handleCancel}
                onSave={handleSave}
                onCopy={handleCopy}
              />
              <div
                className="fixed z-50 flex items-center gap-1 rounded-md bg-[#202124]/95 p-1 shadow-lg"
                style={{ left: toolbarPos.x, top: Math.max(4, toolbarPos.y - 36) }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <button type="button" className="rounded px-2 py-1 text-xs text-white hover:bg-white/15" onClick={() => openOcr(false)}>
                  识别文字
                </button>
                <button type="button" className="rounded bg-[#07c160] px-2 py-1 text-xs text-white" onClick={() => openOcr(true)}>
                  翻译文字
                </button>
              </div>
            </>
          )}
        </>
      )}

      {ocrSource && (
        <div className="fixed inset-x-4 top-4 z-[70] mx-auto max-w-5xl overflow-auto rounded-lg border border-white/20 bg-background shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <ScreenshotOcrPanel
            source={ocrSource}
            text={ocrText}
            autoRecognize={ocrAutoTranslate}
            autoTranslate={ocrAutoTranslate}
            onTextChange={setOcrText}
            onTranslate={translateOcrText}
            onClose={() => {
              if (ocrText.trim() && !window.confirm('关闭文字识别将保留截图，但未复制的识别文本会丢失，是否关闭？')) return;
              setOcrSource(null);
              setOcrAutoTranslate(false);
            }}
          />
        </div>
      )}

      {/* 空闲 / 手绘提示 */}
      {phase === 'idle' && (
        <div className="pointer-events-none fixed inset-x-0 top-8 z-50 flex justify-center px-4">
          <div
            className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/15 bg-[#202124]/95 px-4 py-2.5 text-sm text-white shadow-2xl select-none"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="font-semibold text-white">正在截图</span>
            <span className="text-white/80">
              {longshotMode
                ? '拖动框选可滚动区域 · Enter 开始长截图'
                : mode === 'freehand'
                  ? '按住鼠标绘制截图区域 · Enter 确认 · M 切换矩形'
                  : '拖动鼠标框选截图区域 · M 切换手绘'}
            </span>
            <button
              type="button"
              className="rounded-md bg-white/10 px-2.5 py-1 text-xs text-white/90 transition-colors hover:bg-white/20"
              onClick={handleCancel}
            >
              取消截图（Esc）
            </button>
          </div>
        </div>
      )}

      {/* 手绘中提示 */}
      {phase === 'drawing' && (
        <div className="pointer-events-none fixed inset-x-0 top-10 z-10 flex justify-center">
          <span className="rounded-full bg-black/65 px-5 py-2 text-sm text-white/90 select-none">
            松开结束笔画\u2002·\u2002Enter 确认选区\u2002·\u2002Esc 重画
          </span>
        </div>
      )}
    </div>
  );
}
