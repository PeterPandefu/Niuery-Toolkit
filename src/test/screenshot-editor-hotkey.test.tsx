import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScreenshotEditor from '@/tools/graphic/screenshot-editor';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/tools/graphic/screenshot/HistoryProvider', () => ({
  HistoryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useHistory: () => ({ undo: vi.fn(), redo: vi.fn(), clear: vi.fn() }),
}));
vi.mock('@/tools/graphic/screenshot/EditorCanvas', () => ({ EditorCanvas: () => null }));
vi.mock('@/tools/graphic/screenshot/Toolbar', () => ({ Toolbar: () => null }));
vi.mock('@/tools/graphic/screenshot/LayerPanel', () => ({ LayerPanel: () => null }));
vi.mock('@/tools/graphic/screenshot/CropOverlay', () => ({ CropOverlay: () => null }));
vi.mock('@/tools/graphic/screenshot/useScreenCapture', () => ({
  useScreenCapture: () => ({ capture: vi.fn(), capturing: false }),
}));
vi.mock('@/tools/graphic/screenshot/useClipboardPaste', () => ({ useClipboardPaste: vi.fn() }));
vi.mock('@/tools/graphic/screenshot/useExport', () => ({
  useExport: () => ({ exportImage: vi.fn(), copyToClipboard: vi.fn() }),
}));

describe('ScreenshotEditor screenshot hotkey hint', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_hotkeys') return Promise.resolve({ screenshot: 'Ctrl+Shift+S' });
      return Promise.resolve();
    });
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    invokeMock.mockReset();
  });

  it('renders the configured shortcut and applies later configuration changes', async () => {
    render(<ScreenshotEditor />);

    expect(await screen.findByText('Ctrl+Shift+S')).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('niuery:hotkeys-changed', { detail: { screenshot: 'Alt+S' } })
      );
    });

    expect(screen.getByText('Alt+S')).toBeInTheDocument();
  });

  it('omits the capture and drag-and-drop descriptions from the empty state', async () => {
    render(<ScreenshotEditor />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('screenshotEditor.subtitle')).not.toBeInTheDocument();
    expect(screen.queryByText('screenshotEditor.dragHint')).not.toBeInTheDocument();
  });

  it('keeps a newer configuration event when the initial load resolves late', async () => {
    let resolveInitialHotkeys!: (hotkeys: Record<string, string>) => void;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_hotkeys') {
        return new Promise<Record<string, string>>((resolve) => {
          resolveInitialHotkeys = resolve;
        });
      }
      return Promise.resolve();
    });

    render(<ScreenshotEditor />);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent('niuery:hotkeys-changed', { detail: { screenshot: 'Alt+S' } })
      );
    });
    expect(screen.getByText('Alt+S')).toBeInTheDocument();

    await act(async () => {
      resolveInitialHotkeys({ screenshot: 'Ctrl+Shift+S' });
      await Promise.resolve();
    });

    expect(screen.getByText('Alt+S')).toBeInTheDocument();
  });
});
