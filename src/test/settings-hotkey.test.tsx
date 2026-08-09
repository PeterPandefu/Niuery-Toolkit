import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOTKEYS_CHANGED_EVENT } from '@/lib/hotkeys';
import { SettingsDialog } from '@/components/layout/SettingsDialog';

const { invokeMock, setSkinMock, setThemeMock, resetAppearanceMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  setSkinMock: vi.fn(),
  setThemeMock: vi.fn(),
  resetAppearanceMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('@/registry/tool-registry', () => ({
  getAvailableCategories: () => [],
  getToolsByCategory: () => [],
}));
vi.mock('@/store/tool-lifecycle-store', () => ({
  useToolLifecycleStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ alwaysOnTools: [], activeTools: [], setAlwaysOn: vi.fn() }),
}));
vi.mock('@/store/app-store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ pinnedTools: [], togglePinnedTool: vi.fn() }),
}));
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({
    theme: 'system',
    setTheme: setThemeMock,
    skin: 'forge',
    setSkin: setSkinMock,
    resetAppearance: resetAppearanceMock,
    scheme: 'light',
    monacoTheme: 'niuery-forge-light',
  }),
}));

describe('SettingsDialog hotkey reset', () => {
  afterEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
    setSkinMock.mockReset();
    setThemeMock.mockReset();
    resetAppearanceMock.mockReset();
  });

  it('publishes the reloaded bindings after a reset command returns no payload', async () => {
    const bindings = { screenshot: 'Alt+S', showWindow: 'Ctrl+Shift+T' };
    const published: unknown[] = [];
    const listener = (event: Event) => published.push((event as CustomEvent).detail);
    window.addEventListener(HOTKEYS_CHANGED_EVENT, listener);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'reset_hotkeys') return Promise.resolve();
      if (command === 'get_hotkeys') return Promise.resolve(bindings);
      return Promise.resolve();
    });

    render(<SettingsDialog open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('get_hotkeys');
    });
    invokeMock.mockClear();

    fireEvent.click(screen.getByText('app.hotkeys'));
    fireEvent.click(screen.getByText('hotkeys.reset'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('reset_hotkeys');
      expect(invokeMock).toHaveBeenCalledWith('get_hotkeys');
      expect(published).toContainEqual(bindings);
    });

    window.removeEventListener(HOTKEYS_CHANGED_EVENT, listener);
  });

  it('在外观页即时应用皮肤、模式并支持恢复默认', async () => {
    invokeMock.mockResolvedValue({});
    render(<SettingsDialog open onClose={vi.fn()} />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('get_hotkeys'));

    fireEvent.click(screen.getByRole('button', { name: 'theme.appearance' }));
    fireEvent.click(screen.getByRole('button', { name: 'theme.oceantheme.oceanDesc' }));
    fireEvent.click(screen.getByRole('button', { name: /theme.dark/ }));
    fireEvent.click(screen.getByRole('button', { name: 'theme.restoreDefault' }));

    expect(setSkinMock).toHaveBeenCalledWith('ocean');
    expect(setThemeMock).toHaveBeenCalledWith('dark');
    expect(resetAppearanceMock).toHaveBeenCalledOnce();
  });
});
