import { useState, useCallback, useMemo } from 'react';
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
  tool: ScreenshotTool;
  color: string;
  strokeWidth: number;
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

export function AnnotationLayer({
  width,
  height,
  croppedImage,
  tool,
  color,
  strokeWidth,
  annotations,
  onAnnotationsChange,
  numberCounter,
  onNumberCounterChange,
  stageRef,
}: AnnotationLayerProps) {
  // 用于马赛克取色的像素数据
  const imageData = useMemo(() => {
    if (!croppedImage || width <= 0 || height <= 0) return null;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(croppedImage, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height);
  }, [croppedImage, width, height]);

  const [drawing, setDrawing] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [curPt, setCurPt] = useState<{ x: number; y: number } | null>(null);
  const [penPts, setPenPts] = useState<number[]>([]);
  const [mosaicBlocks, setMosaicBlocks] = useState<{ x: number; y: number; color: string }[]>([]);
  const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

  const addAnnotation = useCallback(
    (item: AnnotationItem) => {
      onAnnotationsChange([...annotations, item]);
    },
    [annotations, onAnnotationsChange],
  );

  /** 获取光标附近的马赛克方块（3×3 笔刷） */
  const mosaicAt = useCallback(
    (px: number, py: number) => {
      if (!imageData) return [];
      const s = MOSAIC_BLOCK_SIZE;
      const bx = Math.floor(px / s) * s;
      const by = Math.floor(py / s) * s;
      const blocks: { x: number; y: number; color: string }[] = [];
      for (let dy = -s; dy <= s; dy += s) {
        for (let dx = -s; dx <= s; dx += s) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          blocks.push({ x: nx, y: ny, color: blockColor(imageData, nx, ny, s) });
        }
      }
      return blocks;
    },
    [imageData, width, height],
  );

  const commitText = useCallback(() => {
    if (!textInput) return;
    const val = textInput.value.trim();
    if (val) {
      addAnnotation({
        id: nanoid(),
        tool: 'text',
        color,
        strokeWidth,
        x: textInput.x,
        y: textInput.y,
        text: val,
        fontSize: Math.max(18, strokeWidth * 6),
      });
    }
    setTextInput(null);
  }, [textInput, color, strokeWidth, addAnnotation]);

  // ── 鼠标事件 ──────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;

      if (tool === 'text') {
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

      setDrawing(true);
      setStartPt(pos);
      setCurPt(pos);
      if (tool === 'pen') setPenPts([pos.x, pos.y]);
      if (tool === 'mosaic') setMosaicBlocks(mosaicAt(pos.x, pos.y));
    },
    [tool, color, strokeWidth, numberCounter, addAnnotation, onNumberCounterChange, mosaicAt],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!drawing) return;
      const pos = e.target.getStage()?.getPointerPosition();
      if (!pos) return;
      setCurPt(pos);
      if (tool === 'pen') setPenPts((p) => [...p, pos.x, pos.y]);
      if (tool === 'mosaic') {
        setMosaicBlocks((prev) => {
          const existing = new Set(prev.map((b) => `${b.x},${b.y}`));
          return [...prev, ...mosaicAt(pos.x, pos.y).filter((b) => !existing.has(`${b.x},${b.y}`))];
        });
      }
    },
    [drawing, tool, mosaicAt],
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
        addAnnotation({ id: nanoid(), tool: 'mosaic', color, strokeWidth, mosaicBlocks });
      setMosaicBlocks([]);
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
        return <Text key={a.id} x={a.x} y={a.y} text={a.text} fontSize={a.fontSize} fill={a.color} fontFamily="sans-serif" />;
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
        return (
          <Group key={a.id}>
            {a.mosaicBlocks?.map((b, i) => (
              <Rect key={i} x={b.x} y={b.y} width={MOSAIC_BLOCK_SIZE} height={MOSAIC_BLOCK_SIZE} fill={b.color} />
            ))}
          </Group>
        );
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
        return (
          <Group>
            {mosaicBlocks.map((b, i) => (
              <Rect key={i} x={b.x} y={b.y} width={MOSAIC_BLOCK_SIZE} height={MOSAIC_BLOCK_SIZE} fill={b.color} />
            ))}
          </Group>
        );
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

      {/* 文字输入框 */}
      {textInput && (
        <textarea
          autoFocus
          className="absolute z-10 resize-none border-none bg-transparent p-0 outline-none"
          style={{
            left: textInput.x,
            top: textInput.y,
            color,
            fontSize: Math.max(18, strokeWidth * 6),
            fontFamily: 'sans-serif',
            minWidth: 120,
            minHeight: 32,
            caretColor: color,
            lineHeight: 1.3,
          }}
          value={textInput.value}
          onChange={(e) => setTextInput((p) => (p ? { ...p, value: e.target.value } : null))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitText();
            }
            if (e.key === 'Escape') setTextInput(null);
          }}
          onBlur={commitText}
        />
      )}
    </div>
  );
}
