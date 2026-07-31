import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';

/**
 * 剪贴板粘贴 Hook
 * 监听 paste 事件，提取图片数据
 */
export function useClipboardPaste(onImage: (img: HTMLImageElement) => void) {
  const handlePaste = useCallback(
    async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) return;

          const url = URL.createObjectURL(file);
          const img = new Image();
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = reject;
            img.src = url;
          });
          URL.revokeObjectURL(url);
          onImage(img);
          toast.success('已粘贴图片');
          return;
        }
      }
    },
    [onImage]
  );

  useEffect(() => {
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [handlePaste]);
}
