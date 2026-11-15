export interface AvailableUpdate {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: unknown) => void) => Promise<void>;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
  done: boolean;
}

export interface UpdateRuntime {
  check: () => Promise<AvailableUpdate | null>;
  relaunch: () => Promise<void>;
}

export interface InstalledUpdate {
  version: string;
  body?: string;
}

export async function installAvailableUpdate(runtime: UpdateRuntime): Promise<InstalledUpdate | null> {
  const update = await runtime.check();
  if (!update) return null;

  await update.downloadAndInstall();
  await runtime.relaunch();
  return { version: update.version, body: update.body };
}
import { isTauri } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

function ensureNetworkAccessAllowed(): void {
  if (isTauri && !useAppStore.getState().networkAccessAllowed) {
    throw new Error('桌面端网络权限未开启，请在“设置 > 网络权限”中开启后重试');
  }
}


export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  ensureNetworkAccessAllowed();
  const { check } = await import('@tauri-apps/plugin-updater');
  return check();
}

export async function installAppUpdate(update: AvailableUpdate, onProgress?: (progress: UpdateProgress) => void): Promise<void> {
  ensureNetworkAccessAllowed();
  const { prepareAiForUpdate } = await import('@/tools/ai-assistant/backend');
  const release = await prepareAiForUpdate();
  let downloaded = 0;
  let total: number | null = null;
  try {
    await update.downloadAndInstall(event => {
      const { event: kind, data } = event as { event: string; data?: { contentLength?: number; chunkLength?: number } };
      if (kind === 'Started') {
        downloaded = 0;
        total = data?.contentLength ?? null;
        onProgress?.({ downloaded, total, done: false });
      } else if (kind === 'Progress') {
        downloaded += data?.chunkLength ?? 0;
        onProgress?.({ downloaded, total, done: false });
      } else if (kind === 'Finished') {
        onProgress?.({ downloaded: total ?? downloaded, total, done: true });
      }
    });
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ai_restart_application');
  } finally { release(); }
}
