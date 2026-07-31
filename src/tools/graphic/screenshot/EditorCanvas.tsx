import { useRef, useState, useCallback, useEffect } from 'react';
import { Stage, Layer, Image as KonvaImage, Rect, Ellipse, Line, Arrow, Text, Transformer, Group } from 'react-konva';
import Konva from 'konva';
import { nanoid } from 'nanoid';
import type { AnnotationData, ToolType, ToolSettings, CanvasSize } from './types';
import { useHistory } from './HistoryProvider';

interface EditorCanvasProps {
  image: HTMLImageElement | null;
  canvasSize: CanvasSize;
  tool: ToolType;
  settings: ToolSettings;
  annotations: AnnotationData[];
  selectedIds: string[];
  numberCounter: number;
  onAnnotationsChange: (annotations: AnnotationData[]) => void;
  onSelectChange: (ids: string[]) => void;
  onNumberCounterChange: (n: number) => void;
  stageRef: React.MutableRefObject<Konva.Stage | null>;
}

export function EditorCanvas({
  image,
  canvasSize,
  tool,
  settings,
  annotations,
  selectedIds,
  numberCounter,
  onAnnotationsChange,
  onSelectChange,
  onNumberCounterChange,
  stageRef,
}: EditorCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [drawing, setDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState({ x: 0, y: 0 });
  const [currentPoints, setCurrentPoints] = useState<number[]>([]);
  const [tempShape, setTempShape] = useState<Record<string, unknown> | null>(null);
  const { execute } = useHistory();

  // 自适应容器大小
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setStageSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // 图片加载后适配缩放
  useEffect(() => {
    if (!image || !canvasSize.width) return;
    const padding = 40;
    const availW = stageSize.width - padding;
    const availH = stageSize.height - padding;
    const s = Math.min(availW / canvasSize.width, availH / canvasSize.height, 1);
    setScale(s);
    setPosition({
      x: (stageSize.width - canvasSize.width * s) / 2,
      y: (stageSize.height - canvasSize.height * s) / 2,
    });
  }, [image, canvasSize, stageSize]);

  // 更新 Transformer 选中节点
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer || !layerRef.current) return;
    const nodes = selectedIds
      .map((id) => layerRef.current!.findOne(`#${id}`))
      .filter(Boolean) as Konva.Node[];
    transformer.nodes(nodes);
    transformer.getLayer()?.batchDraw();
  }, [selectedIds, annotations]);

  const getPointerPosition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const pointer = stage.getPointerPosition();
    if (!pointer) return { x: 0, y: 0 };
    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  }, [position, scale, stageRef]);

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (tool === 'select') {
        // 点击空白取消选中
        const clickedOnEmpty = e.target === e.target.getStage() ||
          e.target.getClassName() === 'Image';
        if (clickedOnEmpty) {
          onSelectChange([]);
        }
        return;
      }
      if (tool === 'crop') return;

      const pos = getPointerPosition();
      setDrawing(true);
      setDrawStart(pos);

      if (tool === 'pen' || tool === 'highlight') {
        setCurrentPoints([pos.x, pos.y]);
      } else if (tool === 'text') {
        // 文字工具：点击即创建
        const id = nanoid(8);
        const annotation: AnnotationData = {
          id,
          type: 'text',
          name: `文字 ${annotations.filter((a) => a.type === 'text').length + 1}`,
          visible: true,
          props: {
            x: pos.x,
            y: pos.y,
            text: '双击编辑',
            fontSize: settings.fontSize,
            fill: settings.color,
            fontFamily: 'sans-serif',
          },
        };
        const prevAnnotations = [...annotations];
        execute({
          label: '添加文字',
          execute: () => onAnnotationsChange([...prevAnnotations, annotation]),
          undo: () => onAnnotationsChange(prevAnnotations),
        });
        setDrawing(false);
        onSelectChange([id]);
      } else if (tool === 'number') {
        const id = nanoid(8);
        const annotation: AnnotationData = {
          id,
          type: 'number',
          name: `序号 ${numberCounter}`,
          visible: true,
          props: {
            x: pos.x,
            y: pos.y,
            number: numberCounter,
            radius: 14,
            fill: settings.color,
          },
        };
        const prevAnnotations = [...annotations];
        const prevCounter = numberCounter;
        execute({
          label: '添加序号',
          execute: () => {
            onAnnotationsChange([...prevAnnotations, annotation]);
            onNumberCounterChange(prevCounter + 1);
          },
          undo: () => {
            onAnnotationsChange(prevAnnotations);
            onNumberCounterChange(prevCounter);
          },
        });
        setDrawing(false);
      } else if (tool === 'mosaic') {
        setTempShape({ x: pos.x, y: pos.y, width: 0, height: 0 });
      } else {
        setTempShape({ x: pos.x, y: pos.y, width: 0, height: 0 });
      }
    },
    [tool, getPointerPosition, settings, annotations, execute, onAnnotationsChange, onSelectChange, numberCounter, onNumberCounterChange]
  );

  const handleMouseMove = useCallback(() => {
    if (!drawing) return;
    const pos = getPointerPosition();

    if (tool === 'pen' || tool === 'highlight') {
      setCurrentPoints((prev) => [...prev, pos.x, pos.y]);
      return;
    }

    if (tool === 'arrow' || tool === 'line') {
      setTempShape({ x1: drawStart.x, y1: drawStart.y, x2: pos.x, y2: pos.y });
      return;
    }

    // rect, ellipse, mosaic
    const x = Math.min(drawStart.x, pos.x);
    const y = Math.min(drawStart.y, pos.y);
    const width = Math.abs(pos.x - drawStart.x);
    const height = Math.abs(pos.y - drawStart.y);
    setTempShape({ x, y, width, height });
  }, [drawing, getPointerPosition, tool, drawStart]);

  const handleMouseUp = useCallback(() => {
    if (!drawing) return;
    setDrawing(false);

    const pos = getPointerPosition();

    if (tool === 'pen' || tool === 'highlight') {
      if (currentPoints.length < 4) {
        setCurrentPoints([]);
        return;
      }
      const id = nanoid(8);
      const type = tool === 'pen' ? 'pen' : 'highlight';
      const annotation: AnnotationData = {
        id,
        type,
        name: tool === 'pen' ? `画笔 ${annotations.filter((a) => a.type === 'pen').length + 1}` : `高亮 ${annotations.filter((a) => a.type === 'highlight').length + 1}`,
        visible: true,
        props: {
          points: [...currentPoints],
          stroke: settings.color,
          strokeWidth: tool === 'highlight' ? settings.strokeWidth * 3 : settings.strokeWidth,
          opacity: tool === 'highlight' ? settings.opacity : 1,
          tension: 0.5,
          lineCap: 'round',
          lineJoin: 'round',
        },
      };
      const prevAnnotations = [...annotations];
      execute({
        label: `添加${tool === 'pen' ? '画笔' : '高亮'}`,
        execute: () => onAnnotationsChange([...prevAnnotations, annotation]),
        undo: () => onAnnotationsChange(prevAnnotations),
      });
      setCurrentPoints([]);
      return;
    }

    if (tool === 'arrow' || tool === 'line') {
      const dist = Math.hypot(pos.x - drawStart.x, pos.y - drawStart.y);
      if (dist < 5) { setTempShape(null); return; }
      const id = nanoid(8);
      const type = tool;
      const annotation: AnnotationData = {
        id,
        type,
        name: tool === 'arrow' ? `箭头 ${annotations.filter((a) => a.type === 'arrow').length + 1}` : `直线 ${annotations.filter((a) => a.type === 'line').length + 1}`,
        visible: true,
        props: {
          points: [drawStart.x, drawStart.y, pos.x, pos.y],
          stroke: settings.color,
          strokeWidth: settings.strokeWidth,
        },
      };
      const prevAnnotations = [...annotations];
      execute({
        label: `添加${tool === 'arrow' ? '箭头' : '直线'}`,
        execute: () => onAnnotationsChange([...prevAnnotations, annotation]),
        undo: () => onAnnotationsChange(prevAnnotations),
      });
      setTempShape(null);
      return;
    }

    if (tool === 'rect' || tool === 'ellipse' || tool === 'mosaic') {
      const x = Math.min(drawStart.x, pos.x);
      const y = Math.min(drawStart.y, pos.y);
      const width = Math.abs(pos.x - drawStart.x);
      const height = Math.abs(pos.y - drawStart.y);
      if (width < 5 && height < 5) { setTempShape(null); return; }

      const id = nanoid(8);
      let annotation: AnnotationData;

      if (tool === 'mosaic') {
        // 生成真实像素化图像
        const pixelSize = 10;
        const mCanvas = document.createElement('canvas');
        mCanvas.width = Math.round(width);
        mCanvas.height = Math.round(height);
        const mCtx = mCanvas.getContext('2d')!;
        if (image) {
          // 先缩小再放大实现像素化
          const smallW = Math.max(1, Math.round(width / pixelSize));
          const smallH = Math.max(1, Math.round(height / pixelSize));
          mCtx.imageSmoothingEnabled = false;
          // 绘制缩小版本
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = smallW;
          tempCanvas.height = smallH;
          const tempCtx = tempCanvas.getContext('2d')!;
          tempCtx.drawImage(image, x, y, width, height, 0, 0, smallW, smallH);
          // 放大回原始尺寸
          mCtx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, width, height);
        } else {
          mCtx.fillStyle = '#888888';
          mCtx.fillRect(0, 0, width, height);
        }
        const mosaicImg = new Image();
        mosaicImg.src = mCanvas.toDataURL('image/png');
        annotation = {
          id,
          type: 'mosaic',
          name: `马赛克 ${annotations.filter((a) => a.type === 'mosaic').length + 1}`,
          visible: true,
          props: { x, y, width, height, pixelSize, mosaicSrc: mCanvas.toDataURL('image/png') },
        };
      } else if (tool === 'rect') {
        annotation = {
          id,
          type: 'rect',
          name: `矩形 ${annotations.filter((a) => a.type === 'rect').length + 1}`,
          visible: true,
          props: {
            x, y, width, height,
            stroke: settings.color,
            strokeWidth: settings.strokeWidth,
            fill: settings.filled ? settings.fillColor : undefined,
            opacity: settings.filled ? 0.3 : 1,
          },
        };
      } else {
        annotation = {
          id,
          type: 'ellipse',
          name: `椭圆 ${annotations.filter((a) => a.type === 'ellipse').length + 1}`,
          visible: true,
          props: {
            x: x + width / 2,
            y: y + height / 2,
            radiusX: width / 2,
            radiusY: height / 2,
            stroke: settings.color,
            strokeWidth: settings.strokeWidth,
            fill: settings.filled ? settings.fillColor : undefined,
            opacity: settings.filled ? 0.3 : 1,
          },
        };
      }

      const prevAnnotations = [...annotations];
      const label = tool === 'mosaic' ? '添加马赛克' : tool === 'rect' ? '添加矩形' : '添加椭圆';
      execute({
        label,
        execute: () => onAnnotationsChange([...prevAnnotations, annotation]),
        undo: () => onAnnotationsChange(prevAnnotations),
      });
      setTempShape(null);
    }
  }, [drawing, getPointerPosition, tool, currentPoints, drawStart, settings, annotations, execute, onAnnotationsChange]);

  // 滚轮缩放
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = scale;
    const pointer = stage.getPointerPosition()!;
    const mousePointTo = {
      x: (pointer.x - position.x) / oldScale,
      y: (pointer.y - position.y) / oldScale,
    };
    const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
    const clampedScale = Math.max(0.1, Math.min(5, newScale));
    setScale(clampedScale);
    setPosition({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  }, [scale, position, stageRef]);

  // 节点拖拽结束
  const handleDragEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      const prevAnnotations = [...annotations];
      const idx = annotations.findIndex((a) => a.id === id);
      if (idx === -1) return;
      const oldProps = { ...annotations[idx].props };
      const newProps = { ...oldProps, x: node.x(), y: node.y() };
      const updated = prevAnnotations.map((a) => (a.id === id ? { ...a, props: newProps } : a));
      execute({
        label: '移动对象',
        execute: () => onAnnotationsChange(updated),
        undo: () => onAnnotationsChange(prevAnnotations),
      });
    },
    [annotations, execute, onAnnotationsChange]
  );

  // 节点变换结束
  const handleTransformEnd = useCallback(
    (id: string, e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const prevAnnotations = [...annotations];
      const idx = annotations.findIndex((a) => a.id === id);
      if (idx === -1) return;
      const oldProps = { ...annotations[idx].props };
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      const newProps: Record<string, unknown> = {
        ...oldProps,
        x: node.x(),
        y: node.y(),
        rotation: node.rotation(),
      };
      // 对 Rect/Image 应用缩放到宽高
      if (oldProps.width !== undefined) {
        newProps.width = Math.max(5, (oldProps.width as number) * scaleX);
        newProps.height = Math.max(5, (oldProps.height as number) * scaleY);
        node.scaleX(1);
        node.scaleY(1);
      }
      const updated = prevAnnotations.map((a) => (a.id === id ? { ...a, props: newProps } : a));
      execute({
        label: '变换对象',
        execute: () => onAnnotationsChange(updated),
        undo: () => onAnnotationsChange(prevAnnotations),
      });
    },
    [annotations, execute, onAnnotationsChange]
  );

  // 双击编辑文字
  const handleTextDblClick = useCallback(
    (id: string) => {
      const annotation = annotations.find((a) => a.id === id);
      if (!annotation || annotation.type !== 'text') return;
      const newText = window.prompt('编辑文字:', annotation.props.text as string);
      if (newText === null) return;
      const prevAnnotations = [...annotations];
      const updated = annotations.map((a) =>
        a.id === id ? { ...a, props: { ...a.props, text: newText } } : a
      );
      execute({
        label: '编辑文字',
        execute: () => onAnnotationsChange(updated),
        undo: () => onAnnotationsChange(prevAnnotations),
      });
    },
    [annotations, execute, onAnnotationsChange]
  );

  const renderAnnotation = (annotation: AnnotationData) => {
    if (!annotation.visible) return null;
    const { id, type, props } = annotation;
    const commonProps = {
      id,
      draggable: tool === 'select',
      onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool !== 'select') return;
        e.cancelBubble = true;
        if (e.evt.shiftKey) {
          onSelectChange(
            selectedIds.includes(id)
              ? selectedIds.filter((sid) => sid !== id)
              : [...selectedIds, id]
          );
        } else {
          onSelectChange([id]);
        }
      },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => handleDragEnd(id, e),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) => handleTransformEnd(id, e),
    };

    switch (type) {
      case 'rect':
        return <Rect key={id} {...commonProps} {...(props as Record<string, number | string>)} />;
      case 'ellipse':
        return (
          <Ellipse
            key={id}
            {...commonProps}
            x={props.x as number}
            y={props.y as number}
            radiusX={props.radiusX as number}
            radiusY={props.radiusY as number}
            stroke={props.stroke as string}
            strokeWidth={props.strokeWidth as number}
            fill={props.fill as string | undefined}
            opacity={props.opacity as number | undefined}
          />
        );
      case 'line':
        return <Line key={id} {...commonProps} {...(props as Record<string, unknown>)} />;
      case 'arrow':
        return (
          <Arrow
            key={id}
            {...commonProps}
            points={props.points as number[]}
            stroke={props.stroke as string}
            strokeWidth={props.strokeWidth as number}
            fill={props.stroke as string}
            pointerLength={10}
            pointerWidth={10}
          />
        );
      case 'pen':
      case 'highlight':
        return (
          <Line
            key={id}
            {...commonProps}
            points={props.points as number[]}
            stroke={props.stroke as string}
            strokeWidth={props.strokeWidth as number}
            opacity={props.opacity as number}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
          />
        );
      case 'text':
        return (
          <Text
            key={id}
            {...commonProps}
            x={props.x as number}
            y={props.y as number}
            text={props.text as string}
            fontSize={props.fontSize as number}
            fill={props.fill as string}
            fontFamily="sans-serif"
            onDblClick={() => handleTextDblClick(id)}
          />
        );
      case 'number':
        return (
          <Group key={id} {...commonProps} x={props.x as number} y={props.y as number}>
            <Ellipse
              radiusX={props.radius as number}
              radiusY={props.radius as number}
              fill={props.fill as string}
            />
            <Text
              text={String(props.number)}
              fontSize={14}
              fill="#ffffff"
              fontStyle="bold"
              align="center"
              verticalAlign="middle"
              width={(props.radius as number) * 2}
              height={(props.radius as number) * 2}
              x={-(props.radius as number)}
              y={-(props.radius as number)}
            />
          </Group>
        );
      case 'mosaic': {
        // 使用缓存的马赛克图像或回退到灰色矩形
        const mosaicSrc = props.mosaicSrc as string | undefined;
        if (mosaicSrc) {
          const mosaicImg = new Image();
          mosaicImg.src = mosaicSrc;
          return (
            <KonvaImage
              key={id}
              {...commonProps}
              x={props.x as number}
              y={props.y as number}
              width={props.width as number}
              height={props.height as number}
              image={mosaicImg}
            />
          );
        }
        return (
          <Rect
            key={id}
            {...commonProps}
            x={props.x as number}
            y={props.y as number}
            width={props.width as number}
            height={props.height as number}
            fill="#888888"
            opacity={0.8}
          />
        );
      }
      default:
        return null;
    }
  };

  const cursorStyle = tool === 'select' ? 'default' : tool === 'crop' ? 'crosshair' : 'crosshair';

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-muted/30" style={{ cursor: cursorStyle }}>
      <Stage
        ref={stageRef as React.Ref<Konva.Stage>}
        width={stageSize.width}
        height={stageSize.height}
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        <Layer ref={layerRef}>
          {/* 背景图片 */}
          {image && (
            <KonvaImage image={image} width={canvasSize.width} height={canvasSize.height} />
          )}

          {/* 已完成的标注 */}
          {annotations.map(renderAnnotation)}

          {/* 绘制中的临时形状 */}
          {drawing && tempShape && (tool === 'rect' || tool === 'mosaic') && (
            <Rect
              x={tempShape.x as number}
              y={tempShape.y as number}
              width={tempShape.width as number}
              height={tempShape.height as number}
              stroke={settings.color}
              strokeWidth={settings.strokeWidth}
              dash={[5, 5]}
              fill={tool === 'mosaic' ? '#888888' : undefined}
              opacity={tool === 'mosaic' ? 0.5 : 1}
            />
          )}
          {drawing && tempShape && tool === 'ellipse' && (
            <Ellipse
              x={(tempShape.x as number) + (tempShape.width as number) / 2}
              y={(tempShape.y as number) + (tempShape.height as number) / 2}
              radiusX={(tempShape.width as number) / 2}
              radiusY={(tempShape.height as number) / 2}
              stroke={settings.color}
              strokeWidth={settings.strokeWidth}
              dash={[5, 5]}
            />
          )}
          {drawing && tempShape && (tool === 'arrow' || tool === 'line') && (
            tool === 'arrow' ? (
              <Arrow
                points={[tempShape.x1 as number, tempShape.y1 as number, tempShape.x2 as number, tempShape.y2 as number]}
                stroke={settings.color}
                strokeWidth={settings.strokeWidth}
                fill={settings.color}
                pointerLength={10}
                pointerWidth={10}
                dash={[5, 5]}
              />
            ) : (
              <Line
                points={[tempShape.x1 as number, tempShape.y1 as number, tempShape.x2 as number, tempShape.y2 as number]}
                stroke={settings.color}
                strokeWidth={settings.strokeWidth}
                dash={[5, 5]}
              />
            )
          )}
          {drawing && (tool === 'pen' || tool === 'highlight') && currentPoints.length > 2 && (
            <Line
              points={currentPoints}
              stroke={settings.color}
              strokeWidth={tool === 'highlight' ? settings.strokeWidth * 3 : settings.strokeWidth}
              opacity={tool === 'highlight' ? settings.opacity : 1}
              tension={0.5}
              lineCap="round"
              lineJoin="round"
            />
          )}

          {/* Transformer */}
          {tool === 'select' && (
            <Transformer
              ref={transformerRef}
              rotateEnabled={true}
              boundBoxFunc={(oldBox, newBox) => {
                if (newBox.width < 5 || newBox.height < 5) return oldBox;
                return newBox;
              }}
            />
          )}
        </Layer>
      </Stage>

      {/* 缩放指示器 */}
      <div className="absolute bottom-2 left-2 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur">
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
