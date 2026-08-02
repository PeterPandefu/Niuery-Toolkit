import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type Konva from 'konva';
import { SelectionBox } from './SelectionBox';
import { AnnotationLayer } from './AnnotationLayer';
import { EditToolbar } from './EditToolbar';
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
  screenImage: HTMLImageElement;
  screenW: number;
  screenH: number;
}

export function ScreenshotOverlay({ screenImage, screenW, screenH }: ScreenshotOverlayProps) {
  const [phase, setPhase] = useState<ScreenshotPhase>('idle');
  const [mode, setMode] = useState<SelectionMode>('freehand');
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[]>([]);
  const [tool, setTool] = useState<ScreenshotTool>('arrow');
  const [color, setColor] = useState('#ff4444');
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [fontSize, setFontSize] = useState(20);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [history, setHistory] = useState<AnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationItem[][]>([]);
  const [numberCounter, setNumberCounter] = useState(1);

  const stageRef = useRef<Konva.Stage | null>(null);
  const selStart = useRef<{ x: number; y: number } | null>(null);
  const isDrawing = useRef(false);

  // ── 裁剪选区图片（用于标注画布背景 & 马赛克取色）──────────
  const { croppedImage, croppedCanvas } = useMemo(() => {
    if (!selection || selection.width < 1 || selection.height < 1) return { croppedImage: null, croppedCanvas: null };
    const c = document.createElement('canvas');
    c.width = Math.round(selection.width);
    c.height = Math.round(selection.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(
      screenImage,
      selection.x, selection.y, selection.width, selection.height,
      0, 0, selection.width, selection.height,
    );
    // canvas 立即可用于 getImageData（同步）
    const img = new Image();
    img.src = c.toDataURL('image/png');
    return { croppedImage: img, croppedCanvas: c };
  }, [screenImage, selection]);

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

  const handleCopy = useCallback(async () => {
    const b64 = exportBase64();
    if (b64) {
      try { await invoke('copy_image_to_clipboard', { base64Data: b64 }); }
      catch (e) { console.error('复制失败', e); }
    }
    await invoke('close_screenshot_window');
  }, [exportBase64]);

  const handleSave = useCallback(async () => {
    const b64 = exportBase64();
    if (b64) {
      try { await invoke('save_image_dialog', { base64Data: b64 }); }
      catch (e) { console.error('保存失败', e); }
    }
    await invoke('close_screenshot_window');
  }, [exportBase64]);

  const handleCancel = useCallback(() => {
    invoke('close_screenshot_window');
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
    setFreehandPoints([]);
    setPhase('selected');
  }, [freehandPoints]);

  const confirmFreehandRef = useRef(confirmFreehand);
  confirmFreehandRef.current = confirmFreehand;

  // ── 初始框选 / 手绘（idle 阶段）──────────────────────────
  const handleBgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // 点击选区外部 → 重新框选
      if (phase === 'selected') {
        setAnnotations([]);
        setHistory([]);
        setRedoStack([]);
        setNumberCounter(1);
      }

      if (mode === 'freehand') {
        // 手绘模式：开始绘制轨迹
        isDrawing.current = true;
        setFreehandPoints([{ x: e.clientX, y: e.clientY }]);
        setPhase('drawing');
      } else {
        // 矩形模式
        selStart.current = { x: e.clientX, y: e.clientY };
        setSelection({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
        setPhase('selecting');
      }
    },
    [phase, mode],
  );

  // ── 手绘模式事件（drawing 阶段）─────────────────────────
  useEffect(() => {
    if (phase !== 'drawing') return;
    const onMove = (e: MouseEvent) => {
      if (!isDrawing.current) return;
      setFreehandPoints((pts) => [...pts, { x: e.clientX, y: e.clientY }]);
    };
    const onUp = () => {
      isDrawing.current = false;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [phase]);

  // ── 矩形模式事件（selecting 阶段）─────────────────────────
  useEffect(() => {
    if (phase !== 'selecting') return;
    const onMove = (e: MouseEvent) => {
      const s = selStart.current;
      if (!s) return;
      setSelection({
        x: Math.min(s.x, e.clientX),
        y: Math.min(s.y, e.clientY),
        width: Math.abs(e.clientX - s.x),
        height: Math.abs(e.clientY - s.y),
      });
    };
    const onUp = (e: MouseEvent) => {
      const s = selStart.current;
      selStart.current = null;
      if (!s) return;
      const w = Math.abs(e.clientX - s.x);
      const h = Math.abs(e.clientY - s.y);
      if (w < MIN_SELECTION_SIZE && h < MIN_SELECTION_SIZE) {
        setPhase('idle');
        setSelection(null);
      } else {
        setPhase('selected');
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [phase]);

  // ── 全局快捷键 ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 当焦点在输入框内时，不拦截键盘事件（由 textarea 自行处理）
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (e.key === 'Escape') {
        if (phase === 'drawing') {
          // 手绘阶段：清空轨迹回到 idle
          setFreehandPoints([]);
          isDrawing.current = false;
          setPhase('idle');
        } else {
          invoke('close_screenshot_window');
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
        else if (phase === 'selected') { copyRef.current(); }
        return;
      }
      // M 键切换模式（仅 idle 阶段）
      if ((e.key === 'm' || e.key === 'M') && phase === 'idle') {
        e.preventDefault();
        setMode((m) => (m === 'freehand' ? 'rect' : 'freehand'));
        setFreehandPoints([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, undo, redo]);

  // ── 工具栏位置（选区下方，空间不足则上方）────────────────
  const toolbarPos = useMemo(() => {
    if (!selection) return { x: 0, y: 0 };
    const TW = 530, TH = 42;
    const tx = Math.max(4, Math.min(selection.x + selection.width / 2 - TW / 2, screenW - TW - 4));
    const below = selection.y + selection.height + 8;
    const ty = below + TH < screenH ? below : Math.max(4, selection.y - TH - 8);
    return { x: tx, y: ty };
  }, [selection, screenW, screenH]);

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
            onSelectionChange={setSelection}
            onDoubleClick={handleCopy}
          />

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
        </>
      )}

      {/* 空闲 / 手绘提示 */}
      {phase === 'idle' && (
        <div className="pointer-events-none fixed inset-x-0 top-10 z-10 flex justify-center">
          <span className="rounded-full bg-black/65 px-5 py-2 text-sm text-white/90 select-none">
            {mode === 'freehand'
              ? '按住鼠标绘制截图区域\u2002·\u2002Enter 确认\u2002·\u2002M 切换矩形\u2002·\u2002Esc 取消'
              : '拖动鼠标框选截图区域\u2002·\u2002M 切换手绘\u2002·\u2002Esc 取消'}
          </span>
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
