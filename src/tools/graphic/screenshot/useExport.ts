import { useCallback } from 'react';
import { toast } from 'sonner';
import Konva from 'konva';
import { invoke } from '@tauri-apps/api/core';
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
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const renderExportDataUrl = useCallback((format: ExportFormat, quality: number) => {
    const stage = stageRef.current;
    if (!stage) return null;

    const oldScale = stage.scaleX();
    const oldPos = { x: stage.x(), y: stage.y() };
    const mimeType = format === 'png' ? 'image/png' : format === 'jpeg' ? 'image/jpeg' : 'image/webp';

    try {
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.batchDraw();
      return stage.toDataURL({
        x: 0,
        y: 0,
        width: canvasSize.width,
        height: canvasSize.height,
        mimeType,
        quality: quality / 100,
        pixelRatio: 1,
      });
    } finally {
      stage.scale({ x: oldScale, y: oldScale });
      stage.position(oldPos);
      stage.batchDraw();
    }
  }, [stageRef, canvasSize]);

  const base64FromDataUrl = useCallback((dataUrl: string) => {
    const separator = dataUrl.indexOf(',');
    return separator >= 0 ? dataUrl.slice(separator + 1) : dataUrl;
  }, []);

  const getExportCanvas = useCallback((): HTMLCanvasElement | null => {
    const dataURL = renderExportDataUrl('png', 100);
    if (!dataURL) return null;

    const canvas = document.createElement('canvas');
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    img.src = dataURL;
    ctx.drawImage(img, 0, 0);

    return canvas;
  }, [renderExportDataUrl, canvasSize]);

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
    async (format: ExportFormat, quality: number = 90) => {
      if (!stageRef.current) {
        toast.error('没有可导出的内容');
        return;
      }

      try {
        const dataURL = renderExportDataUrl(format, quality);
        if (!dataURL) throw new Error('没有可导出的内容');
        const filename = generateFilename(format);

        if (isTauri) {
          const savedPath = await invoke<string | null>('save_image_dialog', {
            base64Data: base64FromDataUrl(dataURL),
            format,
          });
          if (savedPath) {
            toast.success(`已保存到：${savedPath}`);
          } else {
            toast.info('已取消导出');
          }
        } else {
          const link = document.createElement('a');
          link.download = filename;
          link.href = dataURL;
          link.click();
          toast.success(`${filename} 已下载到浏览器默认下载目录`);
        }
      } catch {
        toast.error('导出失败');
      }
    },
    [stageRef, renderExportDataUrl, generateFilename, isTauri, base64FromDataUrl]
  );

  const copyToClipboard = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) {
      toast.error('没有可复制的内容');
      return;
    }

    try {
      const dataURL = renderExportDataUrl('png', 100);
      if (!dataURL) throw new Error('没有可复制的内容');
      const base64Data = base64FromDataUrl(dataURL);

      if (isTauri) {
        await invoke('copy_image_to_clipboard', { base64Data });
      } else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
          throw new Error('当前环境不支持图片剪贴板');
        }
        const blob = await (await fetch(dataURL)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      }
      toast.success('已复制到剪贴板');
    } catch {
      toast.error(isTauri ? '复制失败，请检查系统剪贴板状态' : '复制失败，请在安全网页环境中授予剪贴板权限');
    }
  }, [stageRef, renderExportDataUrl, base64FromDataUrl, isTauri]);

  return { exportImage, copyToClipboard, getExportCanvas };
}
