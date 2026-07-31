import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Check, X } from 'lucide-react';
import type { CanvasSize, CropRatio } from './types';
import { CROP_RATIOS } from './types';

interface CropOverlayProps {
  canvasSize: CanvasSize;
  scale: number;
  position: { x: number; y: number };
  onConfirm: (cropRect: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}

type HandlePosition = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br';

const HANDLES: { pos: HandlePosition; cursor: string; style: string }[] = [
  { pos: 'tl', cursor: 'nwse-resize', style: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2' },
  { pos: 'tc', cursor: 'ns-resize', style: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2' },
  { pos: 'tr', cursor: 'nesw-resize', style: 'right-0 top-0 translate-x-1/2 -translate-y-1/2' },
  { pos: 'ml', cursor: 'ew-resize', style: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2' },
  { pos: 'mr', cursor: 'ew-resize', style: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2' },
  { pos: 'bl', cursor: 'nesw-resize', style: 'left-0 bottom-0 -translate-x-1/2 translate-y-1/2' },
  { pos: 'bc', cursor: 'ns-resize', style: 'left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2' },
  { pos: 'br', cursor: 'nwse-resize', style: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2' },
];

export function CropOverlay({ canvasSize, scale, position, onConfirm, onCancel }: CropOverlayProps) {
  const { t } = useTranslation();
  const [ratio, setRatio] = useState<CropRatio>('free');
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [resizing, setResizing] = useState<HandlePosition | null>(null);
  const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, rect: { x: 0, y: 0, width: 0, height: 0 } });
  const containerRef = useRef<HTMLDivElement>(null);

  const getLocalPos = useCallback(
    (e: React.MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (e.clientX - rect.left - position.x) / scale,
        y: (e.clientY - rect.top - position.y) / scale,
      };
    },
    [position, scale]
  );

  const clampRect = useCallback(
    (r: { x: number; y: number; width: number; height: number }) => ({
      x: Math.max(0, Math.min(r.x, canvasSize.width - 10)),
      y: Math.max(0, Math.min(r.y, canvasSize.height - 10)),
      width: Math.max(10, Math.min(r.width, canvasSize.width - r.x)),
      height: Math.max(10, Math.min(r.height, canvasSize.height - r.y)),
    }),
    [canvasSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (resizing) return;
      const pos = getLocalPos(e);
      setDragging(true);
      setDragStart(pos);
      setCropRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
    },
    [getLocalPos, resizing]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = getLocalPos(e);

      if (resizing) {
        const dx = pos.x - resizeStart.x;
        const dy = pos.y - resizeStart.y;
        const sr = resizeStart.rect;
        const newRect = { ...sr };

        // 根据控制点位置调整
        if (resizing.includes('l')) {
          newRect.x = sr.x + dx;
          newRect.width = sr.width - dx;
        }
        if (resizing.includes('r')) {
          newRect.width = sr.width + dx;
        }
        if (resizing.includes('t')) {
          newRect.y = sr.y + dy;
          newRect.height = sr.height - dy;
        }
        if (resizing.includes('b')) {
          newRect.height = sr.height + dy;
        }

        // 固定比例约束
        const ratioConfig = CROP_RATIOS.find((r) => r.value === ratio);
        if (ratioConfig?.ratio && newRect.width > 10) {
          newRect.height = newRect.width / ratioConfig.ratio;
        }

        // 防止负尺寸
        if (newRect.width < 10) { newRect.width = 10; }
        if (newRect.height < 10) { newRect.height = 10; }

        setCropRect(clampRect(newRect));
        return;
      }

      if (!dragging) return;
      const width = pos.x - dragStart.x;
      let height = pos.y - dragStart.y;

      const ratioConfig = CROP_RATIOS.find((r) => r.value === ratio);
      if (ratioConfig?.ratio) {
        height = width / ratioConfig.ratio;
      }

      const x = width >= 0 ? dragStart.x : dragStart.x + width;
      const y = height >= 0 ? dragStart.y : dragStart.y + height;

      setCropRect(clampRect({
        x,
        y,
        width: Math.abs(width),
        height: Math.abs(height),
      }));
    },
    [dragging, resizing, getLocalPos, dragStart, ratio, clampRect, resizeStart]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(false);
    setResizing(null);
  }, []);

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent, handlePos: HandlePosition) => {
      e.stopPropagation();
      e.preventDefault();
      const pos = getLocalPos(e);
      setResizing(handlePos);
      setResizeStart({ x: pos.x, y: pos.y, rect: { ...cropRect } });
    },
    [getLocalPos, cropRect]
  );

  const handleConfirm = useCallback(() => {
    if (cropRect.width > 5 && cropRect.height > 5) {
      onConfirm(cropRect);
    }
  }, [cropRect, onConfirm]);

  return (
    <div className="absolute inset-0 z-20">
      {/* 裁剪交互区域 */}
      <div
        ref={containerRef}
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* 半透明遮罩 */}
        <div className="absolute inset-0 bg-black/40" />

        {/* 裁剪选区 */}
        {cropRect.width > 0 && cropRect.height > 0 && (
          <div
            className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.4)]"
            style={{
              left: position.x + cropRect.x * scale,
              top: position.y + cropRect.y * scale,
              width: cropRect.width * scale,
              height: cropRect.height * scale,
            }}
          >
            {/* 三分线 */}
            <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
            <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
            <div className="absolute top-1/3 left-0 w-full h-px bg-white/30" />
            <div className="absolute top-2/3 left-0 w-full h-px bg-white/30" />

            {/* 8个控制点 */}
            {HANDLES.map(({ pos, cursor, style }) => (
              <div
                key={pos}
                className={cn(
                  'absolute h-2.5 w-2.5 rounded-sm border border-white bg-primary/80 hover:bg-primary',
                  style
                )}
                style={{ cursor }}
                onMouseDown={(e) => handleHandleMouseDown(e, pos)}
              />
            ))}

            {/* 尺寸标签 */}
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white whitespace-nowrap">
              {Math.round(cropRect.width)} × {Math.round(cropRect.height)}
            </div>
          </div>
        )}
      </div>

      {/* 控制面板 */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-background/95 px-3 py-2 shadow-lg backdrop-blur">
        {/* 比例选择 */}
        <div className="flex items-center gap-1">
          {CROP_RATIOS.map((r) => (
            <Button
              key={r.value}
              variant={ratio === r.value ? 'secondary' : 'ghost'}
              size="sm"
              className={cn('h-6 px-2 text-xs', ratio === r.value && 'bg-primary/15 text-primary')}
              onClick={() => setRatio(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>

        <div className="h-4 w-px bg-border" />

        {/* 确认/取消 */}
        <Button
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={handleConfirm}
          disabled={cropRect.width < 5}
        >
          <Check className="h-3 w-3" />
          {t('screenshotEditor.cropConfirm', '确认')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          onClick={onCancel}
        >
          <X className="h-3 w-3" />
          {t('screenshotEditor.cropCancel', '取消')}
        </Button>
      </div>
    </div>
  );
}
