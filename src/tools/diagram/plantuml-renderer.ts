import { invoke } from '@tauri-apps/api/core';
import type { DiagramRenderResult } from './diagram-editor';

type RenderOptions = { scheme: 'light' | 'dark' };

async function renderPlantUml(source: string, options: RenderOptions, format: 'svg' | 'png'): Promise<Uint8Array> {
  const bytes = await invoke<number[]>('render_plantuml', { source, scheme: options.scheme, format });
  return Uint8Array.from(bytes);
}

export async function renderPlantUmlDiagram(source: string, options: RenderOptions): Promise<DiagramRenderResult> {
  const bytes = await renderPlantUml(source, options, 'svg');
  return { svg: new TextDecoder().decode(bytes) };
}

export function renderPlantUmlPng(source: string, options: RenderOptions): Promise<Uint8Array> {
  return renderPlantUml(source, options, 'png');
}
