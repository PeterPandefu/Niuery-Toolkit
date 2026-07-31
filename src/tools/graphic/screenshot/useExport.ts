import { useCallback } from 'react';
import { toast } from 'sonner';
import Konva from 'konva';
import type { ExportFormat } from './types';

interface UseExportOptions {
  stageRef: React.MutableRefObject<Konva.Stage | null>;
  canvasSize: { width: number; height: number };
}

/**
 * 导出 Hook
 * 支持 PNG/JPEG/WebP 导出和剪贴板复制
 */
export function useExport({ stageRef, canvasSize }: UseExportOptions) {
  const getExportCanvas = useCallback((): HTMLCanvasElement | null => {
    const stage = stageRef.current;
    if (!stage) return null;

    // 导出时重置缩放和位移，只导出画布区域
    const oldScale = stage.scaleX();
    const oldPos = { x: stage.x(), y: stage.y() };

    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.batchDraw();

    const dataURL = stage.toDataURL({
      x: 0,
      y: 0,
      width: canvasSize.width,
      height: canvasSize.height,
      pixelRatio: 1,
    });

    // 恢复视图
    stage.scale({ x: oldScale, y: oldScale });
    stage.position(oldPos);
    stage.batchDraw();

    const canvas = document.createElement('canvas');
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.src = dataURL;
    ctx.drawImage(img, 0, 0);

    return canvas;
  }, [stageRef, canvasSize]);

  const generateFilename = useCallback((format: ExportFormat) => {
    const now = new Date();
    const ts = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const ext = format === 'jpeg' ? 'jpg' : format;
    return `screenshot_${ts}.${ext}`;
  }, []);

  const exportImage = useCallback(
    (format: ExportFormat, quality: number = 90) => {
      const stage = stageRef.current;
      if (!stage) {
        toast.error('没有可导出的内容');
        return;
      }

      try {
        // 临时重置视图导出
        const oldScale = stage.scaleX();
        const oldPos = { x: stage.x(), y: stage.y() };
        stage.scale({ x: 1, y: 1 });
        stage.position({ x: 0, y: 0 });
        stage.batchDraw();

        const mimeType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        const dataURL = stage.toDataURL({
          x: 0,
          y: 0,
          width: canvasSize.width,
          height: canvasSize.height,
          mimeType,
          quality: quality / 100,
          pixelRatio: 1,
        });

        // 恢复视图
        stage.scale({ x: oldScale, y: oldScale });
        stage.position(oldPos);
        stage.batchDraw();

        const link = document.createElement('a');
        link.download = generateFilename(format);
        link.href = dataURL;
        link.click();
        toast.success(`已导出 ${format.toUpperCase()}`);
      } catch {
        toast.error('导出失败');
      }
    },
    [stageRef, canvasSize, generateFilename]
  );

  const copyToClipboard = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) {
      toast.error('没有可复制的内容');
      return;
    }

    try {
      const oldScale = stage.scaleX();
      const oldPos = { x: stage.x(), y: stage.y() };
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.batchDraw();

      const dataURL = stage.toDataURL({
        x: 0,
        y: 0,
        width: canvasSize.width,
        height: canvasSize.height,
        mimeType: 'image/png',
        pixelRatio: 1,
      });

      stage.scale({ x: oldScale, y: oldScale });
      stage.position(oldPos);
      stage.batchDraw();

      const blob = await (await fetch(dataURL)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      toast.success('已复制到剪贴板');
    } catch {
      toast.error('复制失败，请检查浏览器权限');
    }
  }, [stageRef, canvasSize]);

  return { exportImage, copyToClipboard, getExportCanvas };
}
