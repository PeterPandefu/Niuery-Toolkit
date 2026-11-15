import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAppUpdate, installAvailableUpdate } from '@/lib/app-updater';
const native = vi.hoisted(() => ({ invoke: vi.fn(), relaunch: vi.fn() }));
const persistence = vi.hoisted(() => ({ prepareAiForUpdate: vi.fn(), release: vi.fn() }));
vi.mock('@/tools/ai-assistant/backend', () => ({ prepareAiForUpdate: persistence.prepareAiForUpdate }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: native.relaunch }));

describe('installAvailableUpdate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    persistence.prepareAiForUpdate.mockResolvedValue(persistence.release);
  });
  it('requests a restart that waits for AI persistence after installing an update', async () => {
    const order: string[] = [];
    const downloadAndInstall = vi.fn(async () => { order.push('install'); });
    native.invoke.mockImplementation(async () => { order.push('restart'); });
    persistence.prepareAiForUpdate.mockImplementation(async () => { order.push('save'); return persistence.release; });
    await installAppUpdate({ version: '1.2.2', downloadAndInstall });
    expect(native.invoke).toHaveBeenCalledWith('ai_restart_application');
    expect(native.relaunch).not.toHaveBeenCalled();
    expect(order).toEqual(['save', 'install', 'restart']);
    expect(persistence.release).toHaveBeenCalledOnce();
  });
  it('blocks Windows installation if the final workspace cannot be saved', async () => {
    const downloadAndInstall = vi.fn();
    persistence.prepareAiForUpdate.mockRejectedValue(new Error('disk full'));
    await expect(installAppUpdate({ version: '1.2.2', downloadAndInstall })).rejects.toThrow('disk full');
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it('unlocks the workspace when downloading or installing fails', async () => {
    const downloadAndInstall = vi.fn().mockRejectedValue(new Error('download failed'));
    await expect(installAppUpdate({ version: '1.2.2', downloadAndInstall })).rejects.toThrow('download failed');
    expect(persistence.release).toHaveBeenCalledOnce();
  });
  it('forwards download progress events to the callback', async () => {
    let emit: ((event: unknown) => void) | undefined;
    let finish!: () => void;
    const downloadAndInstall = vi.fn((onEvent?: (event: unknown) => void) => {
      emit = onEvent;
      return new Promise<void>(resolve => { finish = resolve; });
    });
    const progress: unknown[] = [];
    const pending = installAppUpdate({ version: '1.8.1', downloadAndInstall }, p => progress.push(p));
    await vi.waitFor(() => expect(emit).toBeDefined());
    emit!({ event: 'Started', data: { contentLength: 100 } });
    emit!({ event: 'Progress', data: { chunkLength: 40 } });
    emit!({ event: 'Progress', data: { chunkLength: 60 } });
    expect(progress).toEqual([
      { downloaded: 0, total: 100, done: false },
      { downloaded: 40, total: 100, done: false },
      { downloaded: 100, total: 100, done: false },
    ]);
    emit!({ event: 'Finished' });
    finish();
    await pending;
    expect(progress[progress.length - 1]).toEqual({ downloaded: 100, total: 100, done: true });
  });
  it('downloads, installs, and relaunches when an update is available', async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue({
      version: '1.2.0',
      body: '修复问题',
      downloadAndInstall,
    });
    const relaunch = vi.fn().mockResolvedValue(undefined);

    const result = await installAvailableUpdate({ check, relaunch });

    expect(result).toEqual({ version: '1.2.0', body: '修复问题' });
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });
});
