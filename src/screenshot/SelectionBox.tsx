import { useEffect, useRef } from 'react';
import { type SelectionRect } from './types';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface SelectionBoxProps {
  selection: SelectionRect;
  screenW: number;
  screenH: number;
  onSelectionChange: (rect: SelectionRect) => void;
  /** 双击选区内部（复制并关闭） */
  onDoubleClick: () => void;
}

const HS = 8; // 手柄尺寸

const HANDLES: { id: HandleId; cursor: string }[] = [
  { id: 'nw', cursor: 'nwse-resize' },
  { id: 'n', cursor: 'ns-resize' },
  { id: 'ne', cursor: 'nesw-resize' },
  { id: 'e', cursor: 'ew-resize' },
  { id: 'se', cursor: 'nwse-resize' },
  { id: 's', cursor: 'ns-resize' },
  { id: 'sw', cursor: 'nesw-resize' },
  { id: 'w', cursor: 'ew-resize' },
];

function handleStyle(id: HandleId, sel: SelectionRect): React.CSSProperties {
  const { x, y, width: w, height: h } = sel;
  const pos: Record<HandleId, { left: number; top: number }> = {
    nw: { left: x - HS / 2, top: y - HS / 2 },
    n: { left: x + w / 2 - HS / 2, top: y - HS / 2 },
    ne: { left: x + w - HS / 2, top: y - HS / 2 },
    e: { left: x + w - HS / 2, top: y + h / 2 - HS / 2 },
    se: { left: x + w - HS / 2, top: y + h - HS / 2 },
    s: { left: x + w / 2 - HS / 2, top: y + h - HS / 2 },
    sw: { left: x - HS / 2, top: y + h - HS / 2 },
    w: { left: x - HS / 2, top: y + h / 2 - HS / 2 },
  };
  return { position: 'fixed', ...pos[id], width: HS, height: HS };
}

function resizeSel(
  init: SelectionRect,
  handle: HandleId,
  dx: number,
  dy: number,
  sw: number,
  sh: number,
): SelectionRect {
  let { x, y, width: w, height: h } = init;
  if (handle.includes('w')) { x += dx; w -= dx; }
  if (handle.includes('e')) { w += dx; }
  if (handle.includes('n')) { y += dy; h -= dy; }
  if (handle.includes('s')) { h += dy; }
  const MIN = 10;
  if (w < MIN) { w = MIN; if (handle.includes('w')) x = init.x + init.width - MIN; }
  if (h < MIN) { h = MIN; if (handle.includes('n')) y = init.y + init.height - MIN; }
  x = Math.max(0, x);
  y = Math.max(0, y);
  if (x + w > sw) w = sw - x;
  if (y + h > sh) h = sh - y;
  return { x, y, width: w, height: h };
}

export function SelectionBox({
  selection,
  screenW,
  screenH,
  onSelectionChange,
  onDoubleClick,
}: SelectionBoxProps) {
  const drag = useRef<{
    type: 'move' | 'resize';
    handle?: HandleId;
    sx: number;
    sy: number;
    init: SelectionRect;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (d.type === 'move') {
        const nx = Math.max(0, Math.min(d.init.x + dx, screenW - d.init.width));
        const ny = Math.max(0, Math.min(d.init.y + dy, screenH - d.init.height));
        onSelectionChange({ ...d.init, x: nx, y: ny });
      } else if (d.handle) {
        onSelectionChange(resizeSel(d.init, d.handle, dx, dy, screenW, screenH));
      }
    };
    const onUp = () => { drag.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [screenW, screenH, onSelectionChange]);

  const startMove = (e: React.MouseEvent) => {
    e.stopPropagation();
    drag.current = { type: 'move', sx: e.clientX, sy: e.clientY, init: { ...selection } };
  };

  const startResize = (e: React.MouseEvent, handle: HandleId) => {
    e.stopPropagation();
    drag.current = { type: 'resize', handle, sx: e.clientX, sy: e.clientY, init: { ...selection } };
  };

  const { x, y, width: w, height: h } = selection;
  const showAbove = y > 28;
  const B = 6; // 边框拖拽宽度
  
  // 四条边框拖拽条（用于移动选区，在标注画布之上）
  const borders: { style: React.CSSProperties }[] = [
    { style: { left: x, top: y - B / 2, width: w, height: B } },           // 上
    { style: { left: x, top: y + h - B / 2, width: w, height: B } },       // 下
    { style: { left: x - B / 2, top: y, width: B, height: h } },           // 左
    { style: { left: x + w - B / 2, top: y, width: B, height: h } },       // 右
  ];
  
  return (
    <>
      {/* 尺寸提示 */}
      <div
        className="pointer-events-none fixed z-40 rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs text-white select-none"
        style={{ left: x, top: showAbove ? y - 24 : y + 4 }}
      >
        {Math.round(w)} × {Math.round(h)}
      </div>
  
      {/* 选区過罩（纯视觉，不拦截鼠标事件） */}
      <div
        data-testid="selection-outside-mask"
        className="pointer-events-none fixed z-10"
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
          outline: '1.5px solid rgba(255,255,255,0.85)',
        }}
      />
  
      {/* 四条边框拖拽条（移动选区） */}
      {borders.map(({ style }, i) => (
        <div
          key={i}
          className="fixed z-30 cursor-move"
          style={style}
          onMouseDown={startMove}
          onDoubleClick={(e) => { e.stopPropagation(); onDoubleClick(); }}
        />
      ))}
  
      {/* 8 个缩放手柄 */}
      {HANDLES.map(({ id, cursor }) => (
        <div
          key={id}
          className="fixed z-40 rounded-sm bg-white shadow"
          style={{ ...handleStyle(id, selection), cursor, border: '1px solid #999' }}
          onMouseDown={(e) => startResize(e, id)}
        />
      ))}
    </>
  );
}
