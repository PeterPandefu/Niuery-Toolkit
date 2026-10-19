import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('default tool settings', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('enables the six quick-bar tools in the requested order on first launch', async () => {
    const { useAppStore } = await import('@/store/app-store');

    expect(useAppStore.getState().pinnedTools).toEqual([
      'markdown-editor',
      'mind-map',
      'excalidraw-board',
      'clipboard-history',
      'image-studio',
      'translator',
    ]);
  });

  it.each([0, 7])('uses the new quick-bar defaults when version %i has no saved list', async (version) => {
    localStorage.setItem('niuery-toolkit-store', JSON.stringify({ state: {}, version }));
    const { useAppStore } = await import('@/store/app-store');

    expect(useAppStore.getState().pinnedTools).toEqual([
      'markdown-editor',
      'mind-map',
      'excalidraw-board',
      'clipboard-history',
      'image-studio',
      'translator',
    ]);
  });

  it.each([
    { version: 0, pinnedTools: ['timestamp', 'base64'] },
    { version: 7, pinnedTools: ['translator', 'markdown-editor'] },
    { version: 7, pinnedTools: [] },
  ])('preserves a saved quick-bar list: $pinnedTools (version $version)', async ({ version, pinnedTools }) => {
    localStorage.setItem('niuery-toolkit-store', JSON.stringify({ state: { pinnedTools }, version }));
    const { useAppStore } = await import('@/store/app-store');

    expect(useAppStore.getState().pinnedTools).toEqual(pinnedTools);
  });

  it('starts screenshot and clipboard history as resident tools on first launch', async () => {
    const { useToolLifecycleStore } = await import('@/store/tool-lifecycle-store');

    expect(useToolLifecycleStore.getState().alwaysOnTools).toEqual(['screenshot-editor', 'clipboard-history']);
    expect(useToolLifecycleStore.getState().activeTools).toEqual(['screenshot-editor', 'clipboard-history']);
  });

  it.each([
    { alwaysOnTools: ['translator'] },
    { alwaysOnTools: [] },
  ])('preserves and starts only saved resident tools: $alwaysOnTools', async ({ alwaysOnTools }) => {
    localStorage.setItem('niuery-toolkit-lifecycle', JSON.stringify({ state: { alwaysOnTools }, version: 0 }));
    const { useToolLifecycleStore } = await import('@/store/tool-lifecycle-store');

    expect(useToolLifecycleStore.getState().alwaysOnTools).toEqual(alwaysOnTools);
    expect(useToolLifecycleStore.getState().activeTools).toEqual(alwaysOnTools);
  });
});
