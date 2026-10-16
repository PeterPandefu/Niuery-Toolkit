import { describe, expect, it, vi } from 'vitest';
import { installAvailableUpdate } from '@/lib/app-updater';

describe('installAvailableUpdate', () => {
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
