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


export async function checkForAppUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  return check();
}

export async function installAppUpdate(update: AvailableUpdate): Promise<void> {
  await update.downloadAndInstall();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}
