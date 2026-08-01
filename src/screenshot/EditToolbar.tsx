import { type ScreenshotTool, TOOL_COLORS, STROKE_WIDTHS } from './types';

interface EditToolbarProps {
  /** 工具栏左上角在屏幕中的坐标 */
  x: number;
  y: number;
  tool: ScreenshotTool;
  color: string;
  strokeWidth: number;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (t: ScreenshotTool) => void;
  onColorChange: (c: string) => void;
  onStrokeWidthChange: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onCancel: () => void;
  onSave: () => void;
  onCopy: () => void;
}

/** 工具按钮定义 */
const TOOLS: { id: ScreenshotTool; label: string; icon: string }[] = [
  { id: 'arrow', label: '箭头', icon: '↗' },
  { id: 'rect', label: '矩形', icon: '▭' },
  { id: 'ellipse', label: '椭圆', icon: '◯' },
  { id: 'line', label: '直线', icon: '╱' },
  { id: 'pen', label: '画笔', icon: '✏' },
  { id: 'text', label: '文字', icon: 'T' },
  { id: 'mosaic', label: '马赛克', icon: '▦' },
  { id: 'number', label: '序号', icon: '①' },
];

export function EditToolbar({
  x,
  y,
  tool,
  color,
  strokeWidth,
  canUndo,
  canRedo,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onUndo,
  onRedo,
  onCancel,
  onSave,
  onCopy,
}: EditToolbarProps) {
  return (
    <div
      className="fixed z-50 flex items-center gap-0.5 rounded-md px-1.5 py-1 shadow-lg select-none"
      style={{
        left: x,
        top: y,
        background: 'rgba(30,30,30,0.92)',
        backdropFilter: 'blur(8px)',
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 工具按钮 */}
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => onToolChange(t.id)}
          className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors"
          style={{
            color: tool === t.id ? '#fff' : 'rgba(255,255,255,0.65)',
            background: tool === t.id ? 'rgba(255,255,255,0.2)' : 'transparent',
            fontSize: t.id === 'text' ? 13 : 14,
            fontWeight: t.id === 'text' ? 700 : 400,
          }}
        >
          {t.icon}
        </button>
      ))}

      <Divider />

      {/* 颜色选择 */}
      <div className="flex items-center gap-0.5 px-0.5">
        {TOOL_COLORS.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => onColorChange(c)}
            className="h-4 w-4 rounded-full border transition-transform"
            style={{
              background: c,
              borderColor: color === c ? '#fff' : 'rgba(255,255,255,0.3)',
              transform: color === c ? 'scale(1.25)' : 'scale(1)',
              boxShadow: color === c ? '0 0 0 1px rgba(255,255,255,0.5)' : 'none',
            }}
          />
        ))}
      </div>

      <Divider />

      {/* 线宽选择 */}
      <div className="flex items-center gap-1 px-0.5">
        {STROKE_WIDTHS.map((w) => (
          <button
            key={w}
            title={`${w}px`}
            onClick={() => onStrokeWidthChange(w)}
            className="flex h-7 w-6 items-center justify-center rounded transition-colors"
            style={{ background: strokeWidth === w ? 'rgba(255,255,255,0.2)' : 'transparent' }}
          >
            <span
              className="rounded-full"
              style={{
                display: 'block',
                width: w + 2,
                height: w + 2,
                background: strokeWidth === w ? '#fff' : 'rgba(255,255,255,0.55)',
              }}
            />
          </button>
        ))}
      </div>

      <Divider />

      {/* 撤销 / 重做 */}
      <button
        title="撤销 (Ctrl+Z)"
        onClick={onUndo}
        disabled={!canUndo}
        className="flex h-7 w-7 items-center justify-center rounded text-base transition-colors disabled:opacity-30"
        style={{ color: 'rgba(255,255,255,0.75)' }}
      >
        ↩
      </button>
      <button
        title="重做 (Ctrl+Y)"
        onClick={onRedo}
        disabled={!canRedo}
        className="flex h-7 w-7 items-center justify-center rounded text-base transition-colors disabled:opacity-30"
        style={{ color: 'rgba(255,255,255,0.75)' }}
      >
        ↪
      </button>

      <Divider />

      {/* 取消 */}
      <button
        title="取消 (Esc)"
        onClick={onCancel}
        className="flex h-7 w-7 items-center justify-center rounded text-base transition-colors hover:bg-white/20"
        style={{ color: 'rgba(255,255,255,0.75)' }}
      >
        ✕
      </button>

      {/* 保存 */}
      <button
        title="保存到文件"
        onClick={onSave}
        className="flex h-7 w-7 items-center justify-center rounded text-base transition-colors hover:bg-white/20"
        style={{ color: 'rgba(255,255,255,0.75)' }}
      >
        ⬇
      </button>

      {/* 复制（完成） */}
      <button
        title="复制到剪贴板 (Enter)"
        onClick={onCopy}
        className="flex h-7 w-9 items-center justify-center rounded text-base font-bold transition-colors"
        style={{ background: '#07c160', color: '#fff' }}
      >
        ✓
      </button>
    </div>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px" style={{ background: 'rgba(255,255,255,0.2)' }} />;
}
