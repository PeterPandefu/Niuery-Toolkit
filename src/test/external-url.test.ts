import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternalUrl } from '@/lib/external-url';

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  openUrlMock.mockReset();
});

describe('openExternalUrl', () => {
  it('rejects non-web protocols before opening anything', async () => {
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow('不支持');
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it('uses the Tauri opener in desktop runtime', async () => {
    vi.stubGlobal('__TAURI_INTERNALS__', {});
    openUrlMock.mockResolvedValue(undefined);

    await expect(openExternalUrl('https://example.test')).resolves.toBeUndefined();
    expect(openUrlMock).toHaveBeenCalledWith('https://example.test/');
  });

  it('opens a new tab in browser runtime and reports popup blocking', async () => {
    const openMock = vi.fn().mockReturnValue({});
    vi.spyOn(window, 'open').mockImplementation(openMock);

    await openExternalUrl(new URL('http://example.test/path'));
    expect(openMock).toHaveBeenCalledWith('http://example.test/path', '_blank', 'noopener,noreferrer');

    openMock.mockReturnValue(null);
    await expect(openExternalUrl('https://example.test')).rejects.toThrow('弹窗');
  });
});
