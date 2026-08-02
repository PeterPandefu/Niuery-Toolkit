import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MousePointer2,
  ArrowUpRight,
  Square,
  Circle,
  Minus,
  Pencil,
  Type,
  Grid3X3,
  Highlighter,
  Hash,
  Crop,
  Undo2,
  Redo2,
  MonitorUp,
  ClipboardPaste,
  Upload,
  Rows3,
} from 'lucide-react';
import type { ToolType, ToolSettings } from './types';
import { COLOR_PRESETS } from './types';
import { useHistory } from './HistoryProvider';

interface ToolbarProps {
  tool: ToolType;
  settings: ToolSettings;
  onToolChange: (tool: ToolType) => void;
  onSettingsChange: (settings: Partial<ToolSettings>) => void;
  onCapture: () => void;
  onPaste: () => void;
  onUpload: () => void;
  onLongCapture?: () => void;
  capturing: boolean;
  longCapturing: boolean;
  hasImage: boolean;
}

const TOOLS: { type: ToolType; icon: typeof Square; labelKey: string; shortcut: string }[] = [
  { type: 'select', icon: MousePointer2, labelKey: 'screenshotEditor.tools.select', shortcut: 'V' },
  { type: 'arrow', icon: ArrowUpRight, labelKey: 'screenshotEditor.tools.arrow', shortcut: 'A' },
  { type: 'rect', icon: Square, labelKey: 'screenshotEditor.tools.rect', shortcut: 'R' },
  { type: 'ellipse', icon: Circle, labelKey: 'screenshotEditor.tools.ellipse', shortcut: 'O' },
  { type: 'line', icon: Minus, labelKey: 'screenshotEditor.tools.line', shortcut: 'L' },
  { type: 'pen', icon: Pencil, labelKey: 'screenshotEditor.tools.pen', shortcut: 'B' },
  { type: 'text', icon: Type, labelKey: 'screenshotEditor.tools.text', shortcut: 'T' },
  { type: 'highlight', icon: Highlighter, labelKey: 'screenshotEditor.tools.highlight', shortcut: 'H' },
  { type: 'mosaic', icon: Grid3X3, labelKey: 'screenshotEditor.tools.mosaic', shortcut: 'M' },
  { type: 'number', icon: Hash, labelKey: 'screenshotEditor.tools.number', shortcut: 'N' },
  { type: 'crop', icon: Crop, labelKey: 'screenshotEditor.tools.crop', shortcut: 'C' },
];

export function Toolbar({
  tool,
  settings,
  onToolChange,
  onSettingsChange,
  onCapture,
  onPaste,
  onUpload,
  onLongCapture,
  capturing,
  longCapturing,
  hasImage,
}: ToolbarProps) {
  const { t } = useTranslation();
  const { undo, redo, canUndo, canRedo } = useHistory();

  const handleColorChange = useCallback(
    (color: string) => {
      onSettingsChange({ color, fillColor: color });
    },
    [onSettingsChange]
  );

  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-3 py-1.5">
      {/* 导入操作 */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onCapture}
          disabled={capturing}
          aria-label={t('screenshotEditor.capture')}
        >
          <MonitorUp className="h-3.5 w-3.5" />
          {t('screenshotEditor.capture')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onPaste}
          aria-label={t('screenshotEditor.paste')}
        >
          <ClipboardPaste className="h-3.5 w-3.5" />
          {t('screenshotEditor.paste')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs"
          onClick={onUpload}
          aria-label={t('screenshotEditor.upload')}
        >
          <Upload className="h-3.5 w-3.5" />
          {t('screenshotEditor.upload')}
        </Button>
        {onLongCapture && (
          <Button
            variant={longCapturing ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={onLongCapture}
            disabled={capturing || longCapturing}
            aria-label="长截图"
            title="自动滚动并纵向拼接"
          >
            <Rows3 className="h-3.5 w-3.5" />
            长截图
          </Button>
        )}
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* 撤销/重做 */}
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={undo}
          disabled={!canUndo}
          aria-label="撤销"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={redo}
          disabled={!canRedo}
          aria-label="重做"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* 工具选择 */}
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ type, icon: Icon, labelKey, shortcut }) => (
          <Button
            key={type}
            variant={tool === type ? 'secondary' : 'ghost'}
            size="icon"
            className={cn('h-7 w-7', tool === type && 'bg-primary/15 text-primary')}
            onClick={() => onToolChange(type)}
            disabled={!hasImage && type !== 'select'}
            title={`${t(labelKey)} (${shortcut})`}
            aria-label={t(labelKey)}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* 颜色选择 */}
      <div className="flex items-center gap-1">
        {COLOR_PRESETS.slice(0, 7).map((color) => (
          <button
            key={color}
            className={cn(
              'h-5 w-5 rounded-full border-2 transition-transform hover:scale-110',
              settings.color === color ? 'border-primary scale-110' : 'border-muted-foreground/30'
            )}
            style={{ backgroundColor: color }}
            onClick={() => handleColorChange(color)}
            aria-label={`颜色 ${color}`}
          />
        ))}
        <input
          type="color"
          value={settings.color}
          onChange={(e) => handleColorChange(e.target.value)}
          className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label="自定义颜色"
        />
      </div>

      <div className="mx-2 h-5 w-px bg-border" />

      {/* 线宽 */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">{t('screenshotEditor.strokeWidth')}</span>
        <input
          type="range"
          min="1"
          max="20"
          value={settings.strokeWidth}
          onChange={(e) => onSettingsChange({ strokeWidth: parseInt(e.target.value) })}
          className="h-1 w-16"
          aria-label="线宽"
        />
        <span className="w-5 text-xs font-mono">{settings.strokeWidth}</span>
      </div>

      {/* 字号（文字工具时显示） */}
      {tool === 'text' && (
        <>
          <div className="mx-2 h-5 w-px bg-border" />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t('screenshotEditor.fontSize')}</span>
            <input
              type="range"
              min="12"
              max="72"
              value={settings.fontSize}
              onChange={(e) => onSettingsChange({ fontSize: parseInt(e.target.value) })}
              className="h-1 w-16"
              aria-label="字号"
            />
            <span className="w-5 text-xs font-mono">{settings.fontSize}</span>
          </div>
        </>
      )}
    </div>
  );
}
