import { invoke } from '@tauri-apps/api/core';
import JSZip from 'jszip';
import { toast } from 'sonner';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface SaveFile {
  name: string;
  blob: Blob;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 保存单个字节结果：Tauri 弹保存对话框，浏览器回退为下载 */
export async function saveBytes(
  defaultName: string,
  bytes: Uint8Array | ArrayBuffer | Blob,
  filterName: string,
  extensions: string[]
): Promise<string | null> {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes]);
  if (isTauriRuntime()) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    return await invoke<string | null>('save_file_dialog', {
      bytes: buf,
      defaultName,
      filterName,
      extensions,
    });
  }
  triggerBrowserDownload(blob, defaultName);
  return defaultName;
}

/** 保存并向用户说明实际位置；取消时不显示成功提示。 */
export async function saveBytesWithFeedback(
  defaultName: string,
  bytes: Uint8Array | ArrayBuffer | Blob,
  filterName: string,
  extensions: string[],
): Promise<string | null> {
  const path = await saveBytes(defaultName, bytes, filterName, extensions);
  if (!path) {
    toast.info('已取消保存');
    return null;
  }
  toast.success(isTauriRuntime() ? `已保存到：${path}` : `${defaultName} 已下载到浏览器默认下载目录`);
  return path;
}

/**
 * 保存处理结果：单个文件直接保存；多个文件打包 zip 后保存
 * 返回实际保存路径（用户取消时返回 null）
 */
export async function saveResults(
  zipName: string,
  files: SaveFile[],
  singleFilter: { name: string; extensions: string[] }
): Promise<string | null> {
  if (files.length === 0) return null;
  if (files.length === 1) {
    return saveBytes(files[0].name, files[0].blob, singleFilter.name, singleFilter.extensions);
  }
  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.blob);
  const blob = await zip.generateAsync({ type: 'blob' });
  return saveBytes(zipName, blob, 'ZIP 压缩包', ['zip']);
}

/** 保存处理结果并说明实际位置；适用于单文件或 ZIP 批量结果。 */
export async function saveResultsWithFeedback(
  zipName: string,
  files: SaveFile[],
  singleFilter: { name: string; extensions: string[] },
): Promise<string | null> {
  const path = await saveResults(zipName, files, singleFilter);
  if (!path) {
    toast.info('已取消保存');
    return null;
  }
  const name = files.length === 1 ? files[0].name : zipName;
  toast.success(isTauriRuntime() ? `已保存到：${path}` : `${name} 已下载到浏览器默认下载目录`);
  return path;
}
