import { Channel, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { holdAiUpdate } from './update-lock';
import type { AiBackend, AiFlushHandler, AiProvider, AiStreamEvent, AiWorkspace } from './types';

const inDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const desktopRequired = () => new Error('请在桌面应用中连接模型、保存 API 密钥或打开数据目录。 / Please use the desktop app.');
let previewWorkspace: AiWorkspace | null = null;
let exitListeners = 0;
const flushHandlers = new Set<AiFlushHandler>();
let exitRegistration = Promise.resolve();
const syncExitListener = () => {
  const pending = exitRegistration.then(() => invoke<void>('ai_set_exit_listener', { ready: exitListeners > 0 }));
  exitRegistration = pending.catch(() => {});
  return pending;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Windows updater installation exits without emitting Tauri's exit event. */
export async function prepareAiForUpdate(): Promise<() => void> {
  const releaseGlobal = holdAiUpdate();
  const releases: (() => void)[] = [];
  const release = () => {
    for (const callback of releases.splice(0)) callback();
    releaseGlobal();
  };
  try {
    for (const handler of flushHandlers) {
      const unlock = await handler(true);
      if (unlock) releases.push(unlock);
    }
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

/** Browser preview keeps non-secret configuration in memory; native IO stays in Rust. */
export const desktopAiBackend: AiBackend = {
  async onExitRequested(handler) {
    if (!inDesktop()) return () => {};
    flushHandlers.add(handler);
    let flushing = false;
    const unlisten = await listen('ai-prepare-exit', async () => {
      if (flushing) return;
      flushing = true;
      let success = false;
      try { await handler(); success = true; }
      catch { /* Keep the app open; the workspace exposes the save error. */ }
      try { await invoke('ai_complete_exit', { success }); }
      finally { flushing = false; }
    }).catch(error => { flushHandlers.delete(handler); throw error; });
    exitListeners++;
    try { await syncExitListener(); }
    catch (error) { exitListeners--; flushHandlers.delete(handler); unlisten(); throw error; }
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      unlisten();
      flushHandlers.delete(handler);
      exitListeners--;
      void syncExitListener().catch(() => {});
    };
  },
  async load() {
    return inDesktop() ? invoke<AiWorkspace | null>('ai_load_workspace') : clone(previewWorkspace);
  },
  async save(workspace) {
    if (inDesktop()) return invoke<void>('ai_save_workspace', { workspace });
    previewWorkspace = clone(workspace);
  },
  async saveProvider(provider, apiKey) {
    if (inDesktop()) {
      return invoke<AiProvider>('ai_save_provider', { provider, ...(apiKey === undefined ? {} : { apiKey }) });
    }
    if (apiKey) throw desktopRequired();
    return { ...clone(provider), hasApiKey: false };
  },
  async removeProvider(providerId) {
    if (inDesktop()) await invoke<void>('ai_remove_provider', { providerId });
  },
  async listModels(providerId) {
    if (!inDesktop()) throw desktopRequired();
    return invoke('ai_list_models', { providerId });
  },
  async testConnection(providerId) {
    if (!inDesktop()) throw desktopRequired();
    return invoke('ai_test_connection', { providerId });
  },
  async testModel(providerId, modelId) {
    if (!inDesktop()) throw desktopRequired();
    return invoke('ai_test_model', { providerId, modelId });
  },
  async generate(request, onEvent) {
    if (!inDesktop()) throw desktopRequired();
    const onEventChannel = new Channel<AiStreamEvent>();
    onEventChannel.onmessage = event => {
      if (event.requestId === request.requestId && event.conversationId === request.conversationId && event.messageId === request.messageId) {
        onEvent(event);
      }
    };
    await invoke<void>('ai_generate', { request, onEvent: onEventChannel });
  },
  async cancel(requestId) {
    if (inDesktop()) await invoke<void>('ai_cancel', { requestId });
  },
  async openDataDirectory() {
    if (!inDesktop()) throw desktopRequired();
    await invoke<void>('ai_open_data_directory');
  },
  async reset() {
    if (inDesktop()) await invoke<void>('ai_reset');
    else previewWorkspace = null;
  },
};
