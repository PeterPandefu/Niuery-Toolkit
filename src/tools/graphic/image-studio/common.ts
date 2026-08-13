import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { type SaveFile } from '@/lib/file-save';

export const IMAGE_FILTER = { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] };
export interface ImageProcessingResult {
  files: SaveFile[];
  zipName: string;
  filter?: { name: string; extensions: string[] };
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** 运行包装：统一 busy / 进度 / 错误提示 */
export function useBusyRun() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setProgress(null);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '处理失败');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return { busy, progress, setProgress, run };
}

/** 临时处理结果与输入绑定：更换输入即失效，重新处理失败则保留上次成功结果。 */
export function useImageProcessingResult(sourceFiles: File[]) {
  const [result, setResult] = useState<ImageProcessingResult | null>(null);
  const sourceKey = useMemo(
    () => sourceFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`).join('|'),
    [sourceFiles]
  );

  useEffect(() => {
    setResult(null);
  }, [sourceKey]);

  return { result, setResult };
}
