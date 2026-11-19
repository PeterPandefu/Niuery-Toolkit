import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/lib/api-client';

export interface OpenedTextDocument {
  path: string;
  contents: string;
}

export interface OpenedBinaryDocument {
  path: string;
  contents: string;
}

export interface OpenedTextDocuments {
  files: OpenedTextDocument[];
  failures: { path: string; error: string }[];
}

export interface TextDocumentInput {
  name: string;
  content: string;
}

export interface TextFileReadFailure {
  name: string;
  error: string;
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

export async function openBinaryDocument(
  filterName: string,
  extensions: string[],
): Promise<OpenedBinaryDocument | null> {
  if (!isTauri) return null;
  return invoke<OpenedBinaryDocument | null>('open_binary_file_dialog', { filterName, extensions });
}

/** 原生多选对话框；取消选择时 files 与 failures 均为空。 */
export async function openTextDocuments(
  filterName: string,
  extensions: string[],
): Promise<OpenedTextDocuments | null> {
  if (!isTauri) return null;
  return invoke<OpenedTextDocuments>('open_text_files_dialog', { filterName, extensions });
}

/** 逐个读取浏览器文件，单个文件读取失败只记录，不中断其余文件。 */
export async function readTextFiles(
  files: File[],
): Promise<{ documents: TextDocumentInput[]; failures: TextFileReadFailure[] }> {
  const documents: TextDocumentInput[] = [];
  const failures: TextFileReadFailure[] = [];
  for (const file of files) {
    try {
      documents.push({ name: file.name, content: await file.text() });
    } catch (error) {
      failures.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { documents, failures };
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
