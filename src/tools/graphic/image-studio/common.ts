import { useState } from 'react';
import { toast } from 'sonner';
import { saveResults, type SaveFile } from '@/lib/file-save';

export const IMAGE_FILTER = { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] };

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

/** 保存图片结果（多文件自动 zip） */
export async function saveImageResults(files: SaveFile[], zipName = '图片处理结果.zip'): Promise<string | null> {
  const path = await saveResults(zipName, files, IMAGE_FILTER);
  if (path) toast.success(files.length > 1 ? `处理完成，共 ${files.length} 个文件` : '处理完成');
  return path;
}
