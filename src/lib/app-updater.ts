export interface AvailableUpdate {
  version: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: unknown) => void) => Promise<void>;
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

export async function installAppUpdate(update: AvailableUpdate): Promise<void> {
  ensureNetworkAccessAllowed();
  const { prepareAiForUpdate } = await import('@/tools/ai-assistant/backend');
  const release = await prepareAiForUpdate();
  try {
    await update.downloadAndInstall();
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('ai_restart_application');
  } finally { release(); }
}
