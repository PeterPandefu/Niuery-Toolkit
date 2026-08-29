import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StickyNoteTool from '@/tools/text/sticky-note';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('StickyNoteTool', () => {
  beforeEach(() => invokeMock.mockResolvedValue({}));

  afterEach(() => invokeMock.mockReset());

  it('通过主窗口入口唤出独立便签窗口', () => {
    render(<StickyNoteTool />);

    fireEvent.click(screen.getByRole('button', { name: 'stickyNoteLauncher.open' }));

    expect(invokeMock).toHaveBeenCalledWith('show_sticky_note_window');
  });

  it('显示已保存的便签快捷键并在设置变更后同步提示', async () => {
    invokeMock.mockImplementation((command: string) =>
      command === 'get_hotkeys' ? Promise.resolve({ stickyNote: 'Alt+Shift+P' }) : Promise.resolve(undefined),
    );

    render(<StickyNoteTool />);

    await waitFor(() => expect(screen.getByText('Alt + Shift + P')).toBeInTheDocument());

    fireEvent(
      window,
      new CustomEvent('niuery:hotkeys-changed', { detail: { stickyNote: 'Ctrl+Shift+K' } }),
    );

    await waitFor(() => expect(screen.getByText('Ctrl + Shift + K')).toBeInTheDocument());
    expect(screen.queryByText('Alt + Shift + P')).not.toBeInTheDocument();
  });
});
