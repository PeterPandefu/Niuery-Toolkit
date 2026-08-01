import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Download,
  Copy,
  RotateCw,
  RotateCcw,
  FlipHorizontal2,
  FlipVertical2,
  Maximize2,
  Camera,
} from 'lucide-react';
import Konva from 'konva';
import { HistoryProvider, useHistory } from './screenshot/HistoryProvider';
import { EditorCanvas } from './screenshot/EditorCanvas';
import { Toolbar } from './screenshot/Toolbar';
import { LayerPanel } from './screenshot/LayerPanel';
import { CropOverlay } from './screenshot/CropOverlay';
import { useScreenCapture } from './screenshot/useScreenCapture';
import { useClipboardPaste } from './screenshot/useClipboardPaste';
import { useExport } from './screenshot/useExport';
import {
  type ToolType,
  type ToolSettings,
  type AnnotationData,
  type CanvasSize,
  type ExportFormat,
  DEFAULT_TOOL_SETTINGS,
  TOOL_SHORTCUTS,
  MAX_CANVAS_SIZE,
} from './screenshot/types';

function ScreenshotEditorInner() {
  const { t } = useTranslation();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [tool, setTool] = useState<ToolType>('select');
  const [settings, setSettings] = useState<ToolSettings>(DEFAULT_TOOL_SETTINGS);
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [numberCounter, setNumberCounter] = useState(1);
  const [showCrop, setShowCrop] = useState(false);
  const [exportQuality, setExportQuality] = useState(90);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showResize, setShowResize] = useState(false);
  const [resizeW, setResizeW] = useState('');
  const [resizeH, setResizeH] = useState('');

  const stageRef = useRef<Konva.Stage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { capture, capturing } = useScreenCapture();
  const { undo, redo, clear } = useHistory();
  const { exportImage, copyToClipboard } = useExport({ stageRef, canvasSize });

  // 加载图片到画布
  const loadImage = useCallback(
    (img: HTMLImageElement) => {
      let { width, height } = img;
      if (width > MAX_CANVAS_SIZE || height > MAX_CANVAS_SIZE) {
        const ratio = Math.min(MAX_CANVAS_SIZE / width, MAX_CANVAS_SIZE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        toast.warning(`图片过大，已缩放至 ${width}×${height}`);
      }
      setImage(img);
      setCanvasSize({ width, height });
      setAnnotations([]);
      setSelectedIds([]);
      setNumberCounter(1);
      clear();
    },
    [clear]
  );

  // 剪贴板粘贴
  useClipboardPaste(loadImage);

  // 屏幕截图
  const handleCapture = useCallback(async () => {
    const img = await capture();
    if (img) loadImage(img);
  }, [capture, loadImage]);

  // 文件上传
  const handleUpload = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件');
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        loadImage(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast.error('图片加载失败');
      };
      img.src = url;
      e.target.value = '';
    },
    [loadImage]
  );

  // 拖拽上传
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error('请拖入图片文件');
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        loadImage(img);
      };
      img.src = url;
    },
    [loadImage]
  );

  // 粘贴按钮（触发提示）
  const handlePasteClick = useCallback(() => {
    toast.info('请按 Ctrl+V 粘贴剪贴板中的图片');
  }, []);

  // 微信风格截图（Tauri 桌面端）
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const handleWechatScreenshot = useCallback(async () => {
    try {
      await invoke('start_screenshot');
    } catch (e) {
      toast.error(`截图失败: ${e}`);
    }
  }, []);

  // 工具切换时退出裁剪
  useEffect(() => {
    if (tool !== 'crop') setShowCrop(false);
  }, [tool]);

  // 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 忽略输入框中的按键
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.length > 0) {
          e.preventDefault();
          setAnnotations((prev) => prev.filter((a) => !selectedIds.includes(a.id)));
          setSelectedIds([]);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const toolType = TOOL_SHORTCUTS[e.key.toLowerCase()];
      if (toolType && image) {
        e.preventDefault();
        setTool(toolType);
        if (toolType === 'crop') setShowCrop(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, selectedIds, image]);

  // 裁剪确认
  const handleCropConfirm = useCallback(
    (cropRect: { x: number; y: number; width: number; height: number }) => {
      if (!image) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropRect.width);
      canvas.height = Math.round(cropRect.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(
        image,
        cropRect.x, cropRect.y, cropRect.width, cropRect.height,
        0, 0, cropRect.width, cropRect.height
      );
      const newImg = new Image();
      newImg.onload = () => {
        setImage(newImg);
        setCanvasSize({ width: canvas.width, height: canvas.height });
        // 调整标注位置
        setAnnotations((prev) =>
          prev
            .map((a) => ({
              ...a,
              props: {
                ...a.props,
                x: (a.props.x as number) - cropRect.x,
                y: (a.props.y as number) - cropRect.y,
              },
            }))
            .filter((a) => {
              const x = a.props.x as number;
              const y = a.props.y as number;
              return x >= -50 && y >= -50 && x <= canvas.width + 50 && y <= canvas.height + 50;
            })
        );
        setShowCrop(false);
        setTool('select');
        toast.success('裁剪完成');
      };
      newImg.src = canvas.toDataURL('image/png');
    },
    [image]
  );

  // 旋转
  const handleRotate = useCallback(
    (degrees: 90 | -90) => {
      if (!image) return;
      const canvas = document.createElement('canvas');
      const isQuarter = Math.abs(degrees) === 90;
      canvas.width = isQuarter ? canvasSize.height : canvasSize.width;
      canvas.height = isQuarter ? canvasSize.width : canvasSize.height;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((degrees * Math.PI) / 180);
      ctx.drawImage(image, -canvasSize.width / 2, -canvasSize.height / 2);
      const newImg = new Image();
      newImg.onload = () => {
        setImage(newImg);
        setCanvasSize({ width: canvas.width, height: canvas.height });
        toast.success(`已旋转 ${degrees}°`);
      };
      newImg.src = canvas.toDataURL('image/png');
    },
    [image, canvasSize]
  );

  // 翻转（同步翻转标注位置）
  const handleFlip = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!image) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize.width;
      canvas.height = canvasSize.height;
      const ctx = canvas.getContext('2d')!;
      if (direction === 'horizontal') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);
      }
      ctx.drawImage(image, 0, 0);
      const newImg = new Image();
      newImg.onload = () => {
        setImage(newImg);
        // 同步翻转标注位置
        setAnnotations((prev) =>
          prev.map((a) => {
            const props = { ...a.props };
            if (direction === 'horizontal') {
              if (props.x !== undefined) props.x = canvasSize.width - (props.x as number);
              if (props.points) {
                const pts = [...(props.points as number[])];
                for (let i = 0; i < pts.length; i += 2) pts[i] = canvasSize.width - pts[i];
                props.points = pts;
              }
            } else {
              if (props.y !== undefined) props.y = canvasSize.height - (props.y as number);
              if (props.points) {
                const pts = [...(props.points as number[])];
                for (let i = 1; i < pts.length; i += 2) pts[i] = canvasSize.height - pts[i];
                props.points = pts;
              }
            }
            return { ...a, props };
          })
        );
        toast.success(direction === 'horizontal' ? t('screenshotEditor.flippedH', '已水平翻转') : t('screenshotEditor.flippedV', '已垂直翻转'));
      };
      newImg.src = canvas.toDataURL('image/png');
    },
    [image, canvasSize, t]
  );

  // 缩放画布
  const handleResize = useCallback(
    (newW: number, newH: number) => {
      if (!image || newW < 1 || newH < 1) return;
      if (newW > MAX_CANVAS_SIZE || newH > MAX_CANVAS_SIZE) {
        toast.error(`最大尺寸 ${MAX_CANVAS_SIZE}px`);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0, newW, newH);
      const newImg = new Image();
      newImg.onload = () => {
        setImage(newImg);
        setCanvasSize({ width: newW, height: newH });
        setShowResize(false);
        toast.success(`已缩放至 ${newW}×${newH}`);
      };
      newImg.src = canvas.toDataURL('image/png');
    },
    [image]
  );

  const handleSettingsChange = useCallback((partial: Partial<ToolSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
  }, []);

  // 空状态
  if (!image) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-8 p-8"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="text-center">
          <h2 className="text-lg font-semibold text-foreground">{t('screenshotEditor.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('screenshotEditor.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-4">
          {isTauri && (
            <Button variant="outline" className="h-24 w-36 flex-col gap-2" onClick={handleWechatScreenshot}>
              <Camera className="h-8 w-8" />
              <span className="text-xs">截图</span>
              <span className="text-[10px] text-muted-foreground">Ctrl+Alt+A</span>
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('screenshotEditor.dragHint')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 工具栏 */}
      <Toolbar
        tool={tool}
        settings={settings}
        onToolChange={(t) => {
          setTool(t);
          if (t === 'crop') setShowCrop(true);
        }}
        onSettingsChange={handleSettingsChange}
        onCapture={handleCapture}
        onPaste={handlePasteClick}
        onUpload={handleUpload}
        capturing={capturing}
        hasImage={!!image}
      />

      {/* 主区域 */}
      <div className="flex min-h-0 flex-1">
        {/* 画布 */}
        <div className="relative min-h-0 flex-1">
          <EditorCanvas
            image={image}
            canvasSize={canvasSize}
            tool={tool}
            settings={settings}
            annotations={annotations}
            selectedIds={selectedIds}
            numberCounter={numberCounter}
            onAnnotationsChange={setAnnotations}
            onSelectChange={setSelectedIds}
            onNumberCounterChange={setNumberCounter}
            stageRef={stageRef}
          />

          {/* 裁剪覆盖层 */}
          {showCrop && (
            <CropOverlay
              canvasSize={canvasSize}
              scale={stageRef.current?.scaleX() ?? 1}
              position={{ x: stageRef.current?.x() ?? 0, y: stageRef.current?.y() ?? 0 }}
              onConfirm={handleCropConfirm}
              onCancel={() => {
                setShowCrop(false);
                setTool('select');
              }}
            />
          )}
        </div>

        {/* 图层面板 */}
        <LayerPanel
          annotations={annotations}
          selectedIds={selectedIds}
          onSelectChange={setSelectedIds}
          onAnnotationsChange={setAnnotations}
        />
      </div>

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between border-t px-4 py-1.5">
        {/* 左侧：画布信息 + 变换 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {canvasSize.width} × {canvasSize.height} px
          </span>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRotate(-90)} title="逆时针旋转90°" aria-label="逆时针旋转">
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleRotate(90)} title="顺时针旋转90°" aria-label="顺时针旋转">
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleFlip('horizontal')} title="水平翻转" aria-label="水平翻转">
              <FlipHorizontal2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleFlip('vertical')} title="垂直翻转" aria-label="垂直翻转">
              <FlipVertical2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setShowResize(!showResize); setResizeW(String(canvasSize.width)); setResizeH(String(canvasSize.height)); }} title="调整尺寸" aria-label="调整尺寸">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {/* 缩放输入 */}
          {showResize && (
            <div className="flex items-center gap-1 rounded border bg-background px-2 py-0.5">
              <input
                type="number"
                className="h-5 w-14 rounded border px-1 text-xs"
                value={resizeW}
                onChange={(e) => setResizeW(e.target.value)}
                aria-label="宽度"
              />
              <span className="text-xs text-muted-foreground">×</span>
              <input
                type="number"
                className="h-5 w-14 rounded border px-1 text-xs"
                value={resizeH}
                onChange={(e) => setResizeH(e.target.value)}
                aria-label="高度"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs"
                onClick={() => handleResize(parseInt(resizeW) || canvasSize.width, parseInt(resizeH) || canvasSize.height)}
              >
                应用
              </Button>
            </div>
          )}
        </div>

        {/* 右侧：导出 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{t('screenshotEditor.quality')}</span>
            <input
              type="range"
              min="10"
              max="100"
              value={exportQuality}
              onChange={(e) => setExportQuality(parseInt(e.target.value))}
              className="h-1 w-16"
              aria-label="导出质量"
            />
            <span className="w-7 text-xs font-mono">{exportQuality}%</span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setShowExportMenu(!showExportMenu)}
            >
              <Download className="h-3.5 w-3.5" />
              {t('screenshotEditor.export')}
            </Button>
            {showExportMenu && (
              <div className="absolute bottom-full right-0 mb-1 w-32 rounded-md border bg-popover p-1 shadow-md">
                {(['png', 'jpeg', 'webp'] as ExportFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    className={cn(
                      'w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                      'capitalize'
                    )}
                    onClick={() => {
                      exportImage(fmt, exportQuality);
                      setShowExportMenu(false);
                    }}
                  >
                    {fmt === 'jpeg' ? 'JPEG' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={copyToClipboard}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('screenshotEditor.copy')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ScreenshotEditor() {
  return (
    <HistoryProvider>
      <ScreenshotEditorInner />
    </HistoryProvider>
  );
}
