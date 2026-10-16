import { invoke, convertFileSrc } from '@tauri-apps/api/core';

export type ResourceId = 'chromium' | 'ffmpeg' | 'java' | 'plantuml' | 'ocr-engine' | 'ocr-chi-sim' | 'ocr-eng';
export interface ResourceStatus {
  id: ResourceId; version: string; platform: string; archive: string; entry: string;
  sha256: string; downloadBytes: number; installedBytes: number;
  status: 'ready' | 'missing'; source: 'local' | 'managed' | 'bundled' | 'system' | null;
  path: string | null; error: string | null; managed: boolean;
}
export interface ResourceProgress { id: ResourceId; phase: string; received: number; total: number }
export const isResourceDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function resourcesForFeature(feature: string): ResourceId[] {
  switch (feature) {
    case 'html-export': return ['chromium'];
    case 'plantuml': return ['java', 'plantuml'];
    case 'recording': return ['ffmpeg'];
    default: return [];
  }
}
export function resourcesForOcr(language: string): ResourceId[] {
  return ['ocr-engine', ...(language.includes('chi_sim') ? ['ocr-chi-sim' as const] : []), ...(language.includes('eng') ? ['ocr-eng' as const] : [])];
}
export const TOOL_RESOURCES: Partial<Record<string, ResourceId[]>> = {
  'plantuml-editor': ['java', 'plantuml'], 'screen-recorder': ['ffmpeg'],
  'markdown-editor': ['chromium'], 'html-renderer': ['chromium'], 'report-generator': ['chromium'],
  'mermaid-editor': ['chromium'],
};
export function openResourceManager() { window.dispatchEvent(new Event('open-resource-manager')); }

export async function ocrAssetUrls(language: string) {
  if (!isResourceDesktop()) {
    const base = new URL('ocr/', window.location.href);
    return { workerPath: new URL('worker.min.js', base).href, corePath: new URL('core/tesseract-core-lstm.wasm.js', base).href, langPath: new URL('lang', base).href };
  }
  await invoke('get_resource_paths', { ids: resourcesForOcr(language) });
  // Catalog-only virtual URLs: no duplicate model directory and no arbitrary
  // app-data JavaScript permitted by CSP.
  const base = convertFileSrc('', 'resource');
  return { workerPath: new URL('ocr-engine/worker.min.js', base).href, corePath: new URL('ocr-engine/core/tesseract-core-lstm.wasm.js', base).href, langPath: new URL('lang', base).href };
}
