import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StickyNoteTool from '@/tools/text/sticky-note';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('StickyNoteTool', () => {
  beforeEach(() => invokeMock.mockResolvedValue(undefined));

  afterEach(() => invokeMock.mockReset());

  it('通过主窗口入口唤出独立便签窗口', () => {
    render(<StickyNoteTool />);

    fireEvent.click(screen.getByRole('button', { name: 'stickyNoteLauncher.open' }));

    expect(invokeMock).toHaveBeenCalledWith('show_sticky_note_window');
  });
});
