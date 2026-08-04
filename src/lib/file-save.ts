import { invoke } from '@tauri-apps/api/core';
import JSZip from 'jszip';
import { isTauri } from '@/lib/api-client';

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
  if (isTauri) {
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
