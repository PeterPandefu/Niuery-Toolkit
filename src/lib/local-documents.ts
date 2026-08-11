import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/api-client';

export interface OpenedTextDocument {
  path: string;
  contents: string;
}

export interface RecoverySnapshot {
  id: string;
  tool: string;
  content: string;
  document_path: string | null;
  updated_at: number;
}

export async function openTextDocument(
  filterName: string,
  extensions: string[],
): Promise<OpenedTextDocument | null> {
  if (!isTauri) return null;
  return invoke<OpenedTextDocument | null>('open_text_file_dialog', { filterName, extensions });
}

export async function writeRecoverySnapshot(
  tool: string,
  id: string,
  content: string,
  documentPath: string | null,
) {
  if (!isTauri) return;
  await invoke('write_recovery_snapshot', { tool, id, content, documentPath });
}

export async function listRecoverySnapshots(tool: string): Promise<RecoverySnapshot[]> {
  if (!isTauri) return [];
  return invoke<RecoverySnapshot[]>('list_recovery_snapshots', { tool });
}

export async function discardRecoverySnapshot(tool: string, id: string) {
  if (!isTauri) return;
  await invoke('discard_recovery_snapshot', { tool, id });
}
