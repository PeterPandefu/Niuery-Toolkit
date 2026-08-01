import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Stage,
  Layer,
  Arrow,
  Rect,
  Ellipse,
  Line,
  Text,
  Circle,
  Image as KonvaImage,
  Group,
} from 'react-konva';
import type Konva from 'konva';
import { nanoid } from 'nanoid';
import {
  type AnnotationItem,
  type ScreenshotTool,
  MOSAIC_BLOCK_SIZE,
} from './types';

interface AnnotationLayerProps {
  width: number;
  height: number;
  croppedImage: HTMLImageElement | null;
  croppedCanvas: HTMLCanvasElement | null;
  tool: ScreenshotTool;
  color: string;
  strokeWidth: number;
  fontSize: number;
  annotations: AnnotationItem[];
  onAnnotationsChange: (items: AnnotationItem[]) => void;
  numberCounter: number;
  onNumberCounterChange: (n: number) => void;
  stageRef: React.MutableRefObject<Konva.Stage | null>;
}

/** 从 ImageData 中取某个方块区域的平均颜色 */
function blockColor(data: ImageData, bx: number, by: number, size: number): string {
  let r = 0, g = 0, b = 0, cnt = 0;
  const x1 = Math.min(bx + size, data.width);
  const y1 = Math.min(by + size, data.height);
  for (let y = by; y < y1; y++) {
    for (let x = bx; x < x1; x++) {
      const i = (y * data.width + x) * 4;
      r += data.data[i];
      g += data.data[i + 1];
      b += data.data[i + 2];
      cnt++;
    }
  }
  if (!cnt) return '#888888';
  return `rgb(${Math.round(r / cnt)},${Math.round(g / cnt)},${Math.round(b / cnt)})`;
}

/** 在两点之间插值，返回中间点列表（用于消除快速移动时的间隙） */
function interpolatePoints(
  x0: number, y0: number, x1: number, y1: number, step: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const count = Math.max(1, Math.floor(dist / step));
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    pts.push({ x: x0 + dx * t, y: y0 + dy * t });
  }
  return pts;
}

/** 将马赛克方块列表绘制到 canvas 上 */
function drawMosaicToCanvas(
  canvas: HTMLCanvasElement,
  blocks: { x: number; y: number; color: string }[],
  blockSize: number,
) {
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const b of blocks) {
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, blockSize, blockSize);
  }
}

export function AnnotationLayer({
  width,
  height,
  croppedImage,
  croppedCanvas,
  tool,
  color,
  strokeWidth,
  fontSize,
  annotations,
  onAnnotationsChange,
  numberCounter,
  onNumberCounterChange,
  stageRef,
}: AnnotationLayerProps) {
  // 用于马赛克取色的像素数据（直接从 canvas 获取，同步无延迟）
  const imageData = useMemo(() => {
    if (!croppedCanvas || width <= 0 || height <= 0) return null;
    const ctx = croppedCanvas.getContext('2d');
    if (!ctx) return null;
    return ctx.getImageData(0, 0, width, height);
  }, [croppedCanvas, width, height]);

  const [drawing, setDrawing] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [curPt, setCurPt] = useState<{ x: number; y: number } | null>(null);
  const [penPts, setPenPts] = useState<number[]>([]);
  const [mosaicBlocks, setMosaicBlocks] = useState<{ x: number; y: number; color: string }[]>([]);
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string; editId?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // 用 ref 跟踪 textInput，避免 blur + mousedown 同一事件循环中双重提交
  const textInputRef = useRef(textInput);
  textInputRef.current = textInput;
  // 马赛克 canvas 叠加层（用于实时预览和已提交标注的渲染）
  const mosaicCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mosaicPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // 上一次马赛克绘制位置（用于插值）
  const lastMosaicPos = useRef<{ x: number; y: number } | null>(null);

  // 当 textInput 出现时，延迟聚焦确保 DOM 已渲染
  useEffect(() => {
    if (textInput && textareaRef.current) {
      const el = textareaRef.current;
      // 使用 requestAnimationFrame 确保 DOM 更新后再聚焦
      requestAnimationFrame(() => {
        el.focus();
        // 将光标移到末尾
        el.selectionStart = el.selectionEnd = el.value.length;
      });
    }
  }, [textInput !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // 将已提交的马赛克标注绘制到 canvas 叠加层
  useEffect(() => {
    const canvas = mosaicCanvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, width, height);
    for (const a of annotations) {
      if (a.tool === 'mosaic' && a.mosaicBlocks) {
        const bs = a.mosaicBlockSize || MOSAIC_BLOCK_SIZE;
        for (const b of a.mosaicBlocks) {
          ctx.fillStyle = b.color;
          ctx.fillRect(b.x, b.y, bs, bs);
        }
      }
    }
  }, [annotations, width, height]);

  // 将当前绘制中的马赛克预览绘制到 canvas
  useEffect(() => {
    const canvas = mosaicPreviewCanvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    drawMosaicToCanvas(canvas, mosaicBlocks, strokeWidth);
  }, [mosaicBlocks, width, height, strokeWidth]);

  const addAnnotation = useCallback(
    (item: AnnotationItem) => {
      onAnnotationsChange([...annotations, item]);
    },
    [annotations, onAnnotationsChange],
  );

  /** 获取光标附近的马赛克方块（5×5 笔刷，更平滑） */
  const mosaicAt = useCallback(
    (px: number, py: number) => {
      if (!imageData) return [];
      const s = strokeWidth; // 使用 strokeWidth 作为动态块大小
      const bx = Math.floor(px / s) * s;
      const by = Math.floor(py / s) * s;
      const blocks: { x: number; y: number; color: string }[] = [];
      // 5×5 笔刷（半径 2 个方块）
      for (let dy = -2 * s; dy <= 2 * s; dy += s) {
        for (let dx = -2 * s; dx <= 2 * s; dx += s) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          blocks.push({ x: nx, y: ny, color: blockColor(imageData, nx, ny, s) });
        }
      }
      return blocks;
    },
    [imageData, width, height, strokeWidth],
  );

  const commitText = useCallback(() => {
    // 使用 ref 读取当前值，避免闭包过期和双重提交
    const ti = textInputRef.current;
    if (!ti) return;
    // 立即清空 ref，防止同一事件循环中再次调用
    textInputRef.current = null;

    const val = ti.value.trim();
    if (val) {
      if (ti.editId) {
        // 编辑模式：更新已有标注
        onAnnotationsChange(
          annotations.map((a) =>
            a.id === ti.editId
              ? { ...a, text: val, color, fontSize, x: ti.x, y: ti.y }
              : a,
          ),
        );
      } else {
        // 新增模式
        addAnnotation({
          id: nanoid(),
          tool: 'text',
          color,
          strokeWidth,
          x: ti.x,
          y: ti.y,
          text: val,
          fontSize,
        });
      }
    } else if (ti.editId) {
      // 编辑模式下清空内容 → 删除该标注
      onAnnotationsChange(annotations.filter((a) => a.id !== ti.editId));
    }
    setTextInput(null);
  }, [color, fontSize, strokeWidth, addAnnotation, annotations, onAnnotationsChange]);

  // ── 鼠标事件 ──────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;

      if (tool === 'text') {
        // 如果点击的是已有文字标注，不创建新文本框（留给 dblclick 处理重新编辑）
        const clickedNode = e.target;
        if (clickedNode.getClassName() === 'Text') {
          return;
        }
        // 如果当前有正在编辑的文本框，先提交
        if (textInputRef.current) {
          commitText();
        }
        // 单击空白区域创建新文本框
        setTextInput({ x: pos.x, y: pos.y, value: '' });
        return;
      }

      if (tool === 'number') {
        addAnnotation({
          id: nanoid(),
          tool: 'number',
          color,
          strokeWidth,
          x: pos.x,
          y: pos.y,
          number: numberCounter,
        });
        onNumberCounterChange(numberCounter + 1);
        return;
      }

      // 如果点击在已有文字标注上，不开始新绘制（保留双击编辑能力）
      if (e.target.getClassName() === 'Text') {
        return;
      }

      setDrawing(true);
      setStartPt(pos);
      setCurPt(pos);
      if (tool === 'pen') setPenPts([pos.x, pos.y]);
      if (tool === 'mosaic') {
        setMosaicBlocks(mosaicAt(pos.x, pos.y));
        lastMosaicPos.current = pos;
      }
    },
    [tool, color, strokeWidth, numberCounter, addAnnotation, onNumberCounterChange, mosaicAt, commitText],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!drawing) return;
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;
      setCurPt(pos);
      if (tool === 'pen') setPenPts((p) => [...p, pos.x, pos.y]);
      if (tool === 'mosaic') {
        // 插值填充快速移动时的间隙
        const last = lastMosaicPos.current;
        const points = last
          ? interpolatePoints(last.x, last.y, pos.x, pos.y, strokeWidth / 2)
          : [pos];
        setMosaicBlocks((prev) => {
          const existing = new Set(prev.map((b) => `${b.x},${b.y}`));
          const newBlocks: { x: number; y: number; color: string }[] = [];
          for (const pt of points) {
            for (const b of mosaicAt(pt.x, pt.y)) {
              const key = `${b.x},${b.y}`;
              if (!existing.has(key)) {
                existing.add(key);
                newBlocks.push(b);
              }
            }
          }
          return [...prev, ...newBlocks];
        });
        lastMosaicPos.current = pos;
      }
    },
    [drawing, tool, mosaicAt, strokeWidth],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawing || !startPt || !curPt) return;
    setDrawing(false);

    if (tool === 'pen') {
      if (penPts.length >= 4)
        addAnnotation({ id: nanoid(), tool: 'pen', color, strokeWidth, points: penPts });
      setPenPts([]);
    } else if (tool === 'mosaic') {
      if (mosaicBlocks.length)
        addAnnotation({ id: nanoid(), tool: 'mosaic', color, strokeWidth, mosaicBlocks, mosaicBlockSize: strokeWidth });
      setMosaicBlocks([]);
      lastMosaicPos.current = null;
    } else {
      const x = Math.min(startPt.x, curPt.x);
      const y = Math.min(startPt.y, curPt.y);
      const w = Math.abs(curPt.x - startPt.x);
      const h = Math.abs(curPt.y - startPt.y);
      if (w > 3 || h > 3) {
        if (tool === 'arrow' || tool === 'line') {
          addAnnotation({
            id: nanoid(),
            tool,
            color,
            strokeWidth,
            points: [startPt.x, startPt.y, curPt.x, curPt.y],
          });
        } else if (tool === 'rect') {
          addAnnotation({ id: nanoid(), tool: 'rect', color, strokeWidth, x, y, width: w, height: h });
        } else if (tool === 'ellipse') {
          addAnnotation({
            id: nanoid(),
            tool: 'ellipse',
            color,
            strokeWidth,
            x: x + w / 2,
            y: y + h / 2,
            width: w,
            height: h,
          });
        }
      }
    }
    setStartPt(null);
    setCurPt(null);
  }, [drawing, startPt, curPt, tool, penPts, mosaicBlocks, color, strokeWidth, addAnnotation]);

  // ── 渲染标注 ──────────────────────────────────────────────

  const renderAnnotation = (a: AnnotationItem) => {
    switch (a.tool) {
      case 'arrow':
        return (
          <Arrow
            key={a.id}
            points={a.points!}
            stroke={a.color}
            strokeWidth={a.strokeWidth}
            fill={a.color}
            pointerLength={12}
            pointerWidth={12}
          />
        );
      case 'line':
        return <Line key={a.id} points={a.points!} stroke={a.color} strokeWidth={a.strokeWidth} lineCap="round" />;
      case 'pen':
        return (
          <Line
            key={a.id}
            points={a.points!}
            stroke={a.color}
            strokeWidth={a.strokeWidth}
            tension={0.3}
            lineCap="round"
            lineJoin="round"
          />
        );
      case 'rect':
        return (
          <Rect key={a.id} x={a.x} y={a.y} width={a.width} height={a.height} stroke={a.color} strokeWidth={a.strokeWidth} />
        );
      case 'ellipse':
        return (
          <Ellipse
            key={a.id}
            x={a.x}
            y={a.y}
            radiusX={a.width! / 2}
            radiusY={a.height! / 2}
            stroke={a.color}
            strokeWidth={a.strokeWidth}
          />
        );
      case 'text':
        // 编辑模式下隐藏原有文字，仅显示文本编辑框
        if (textInput?.editId === a.id) return null;
        return (
          <Text
            key={a.id}
            x={a.x}
            y={a.y}
            text={a.text}
            fontSize={a.fontSize}
            fill={a.color}
            fontFamily="sans-serif"
            onDblClick={() => {
              // 双击已有文字 → 重新编辑
              setTextInput({ x: a.x!, y: a.y!, value: a.text || '', editId: a.id });
            }}
          />
        );
      case 'number': {
        const r = 13;
        return (
          <Group key={a.id}>
            <Circle x={a.x} y={a.y} radius={r} fill={a.color} />
            <Text
              x={a.x}
              y={a.y}
              text={String(a.number)}
              fontSize={14}
              fontStyle="bold"
              fill="#fff"
              align="center"
              verticalAlign="middle"
              offsetX={String(a.number).length > 1 ? 8 : 4}
              offsetY={7}
              fontFamily="sans-serif"
            />
          </Group>
        );
      }
      case 'mosaic':
        // 马赛克由 canvas 叠加层渲染，此处不渲染 Konva 节点
        return null;
      default:
        return null;
    }
  };

  // ── 绘制预览 ──────────────────────────────────────────────

  const renderPreview = () => {
    if (!drawing || !startPt || !curPt) return null;
    const x = Math.min(startPt.x, curPt.x);
    const y = Math.min(startPt.y, curPt.y);
    const w = Math.abs(curPt.x - startPt.x);
    const h = Math.abs(curPt.y - startPt.y);
    switch (tool) {
      case 'arrow':
        return (
          <Arrow
            points={[startPt.x, startPt.y, curPt.x, curPt.y]}
            stroke={color}
            strokeWidth={strokeWidth}
            fill={color}
            pointerLength={12}
            pointerWidth={12}
          />
        );
      case 'line':
        return <Line points={[startPt.x, startPt.y, curPt.x, curPt.y]} stroke={color} strokeWidth={strokeWidth} lineCap="round" />;
      case 'pen':
        return <Line points={penPts} stroke={color} strokeWidth={strokeWidth} tension={0.3} lineCap="round" lineJoin="round" />;
      case 'rect':
        return <Rect x={x} y={y} width={w} height={h} stroke={color} strokeWidth={strokeWidth} />;
      case 'ellipse':
        return <Ellipse x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} stroke={color} strokeWidth={strokeWidth} />;
      case 'mosaic':
        // 马赛克预览由 canvas 叠加层渲染
        return null;
      default:
        return null;
    }
  };

  const cursor =
    tool === 'text' ? 'text' : tool === 'number' ? 'copy' : 'crosshair';

  return (
    <div className="absolute" style={{ left: 0, top: 0, width, height, cursor }}>
      <Stage
        width={width}
        height={height}
        ref={stageRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer>
          {/* 背景截图（用于导出） */}
          {croppedImage && <KonvaImage image={croppedImage} width={width} height={height} />}
          {/* 已有标注 */}
          {annotations.map(renderAnnotation)}
          {/* 绘制预览 */}
          {renderPreview()}
        </Layer>
      </Stage>

      {/* 马赛克 canvas 叠加层（已提交 + 预览） */}
      <canvas
        ref={mosaicCanvasRef}
        className="pointer-events-none absolute"
        style={{ left: 0, top: 0, width, height, zIndex: 5 }}
        width={width}
        height={height}
      />
      <canvas
        ref={mosaicPreviewCanvasRef}
        className="pointer-events-none absolute"
        style={{ left: 0, top: 0, width, height, zIndex: 6 }}
        width={width}
        height={height}
      />

      {/* 文字输入框（红色边框，可拖拽移动） */}
      {textInput && (
        <div
          className="absolute"
          style={{
            left: textInput.x,
            top: textInput.y,
            zIndex: 100,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {/* 拖拽条（mousedown 时 preventDefault 阻止 textarea 失焦） */}
          <div
            className="flex items-center justify-center rounded-t"
            style={{
              height: 14,
              background: '#ff4444',
              cursor: 'move',
              borderTopLeftRadius: 4,
              borderTopRightRadius: 4,
            }}
            onMouseDown={(e) => {
              e.preventDefault(); // 阻止 textarea 失焦
              e.stopPropagation();
              const startX = e.clientX;
              const startY = e.clientY;
              const origX = textInputRef.current?.x ?? textInput.x;
              const origY = textInputRef.current?.y ?? textInput.y;
              const offX = startX - origX;
              const offY = startY - origY;

              const onMove = (ev: MouseEvent) => {
                const nx = ev.clientX - offX;
                const ny = ev.clientY - offY;
                setTextInput((p) => (p ? { ...p, x: Math.max(0, nx), y: Math.max(0, ny) } : null));
              };
              const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
          >
            <div style={{ width: 24, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.7)' }} />
          </div>
          {/* 文本输入区 */}
          <textarea
            ref={textareaRef}
            className="resize-none outline-none"
            style={{
              display: 'block',
              color,
              fontSize,
              fontFamily: 'sans-serif',
              minWidth: 160,
              minHeight: 36,
              maxWidth: Math.max(100, width - textInput.x - 4),
              caretColor: color,
              lineHeight: 1.4,
              border: '2px solid #ff4444',
              borderTop: 'none',
              borderBottomLeftRadius: 4,
              borderBottomRightRadius: 4,
              background: 'rgba(0,0,0,0.15)',
              padding: '4px 8px',
            }}
            value={textInput.value}
            onChange={(e) => setTextInput((p) => (p ? { ...p, value: e.target.value } : null))}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitText();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                textInputRef.current = null;
                setTextInput(null);
              }
            }}
            onBlur={() => {
              // 点击其他空白地方 → 输入完成
              commitText();
            }}
          />
        </div>
      )}
    </div>
  );
}
