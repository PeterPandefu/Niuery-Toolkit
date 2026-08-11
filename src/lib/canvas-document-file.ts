import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/api-client';
import { saveBytes } from '@/lib/file-save';

export interface CanvasAssetPayload {
  filename: string;
  base64: string;
}

export async function saveCanvasDocument(
  content: string,
  assets: CanvasAssetPayload[],
  defaultName: string,
): Promise<string | null> {
  if (isTauri) {
    return invoke<string | null>('save_canvas_document', { content, assets, defaultName });
  }
  return saveBytes(defaultName, new TextEncoder().encode(content), '知识画布', ['niuery-canvas']);
}

export async function readCanvasAsset(documentPath: string, assetRef: string): Promise<string> {
  if (!isTauri) throw new Error('仅桌面应用支持读取画布资源');
  return invoke<string>('read_canvas_asset', { documentPath, assetRef });
}
