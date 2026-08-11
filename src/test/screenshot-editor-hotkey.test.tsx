import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScreenshotEditor from '@/tools/graphic/screenshot-editor';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { useAppStore } from '@/store/app-store';

const { invokeMock, minimizeMock, toastError } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  minimizeMock: vi.fn(() => Promise.resolve()),
  toastError: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emitTo: vi.fn(() => Promise.resolve()),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ minimize: minimizeMock, unminimize: vi.fn(), setFocus: vi.fn() }),
}));
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
vi.mock('sonner', () => ({
  toast: { error: toastError, warning: vi.fn(), success: vi.fn(), info: vi.fn() },
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
    minimizeMock.mockClear();
    toastError.mockReset();
    useScreenshotOcrStore.setState({ screenshotSession: null, pendingTranslation: null });
    useAppStore.setState({ activeToolId: null });
    vi.unstubAllGlobals();
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

  it('minimizes the main window before starting a screenshot from the button', async () => {
    render(<ScreenshotEditor />);

    fireEvent.click(await screen.findByText('screenshotEditor.capture'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_screenshot');
    });
    const startScreenshotCall = invokeMock.mock.calls.findIndex(([command]) => command === 'start_screenshot');
    expect(minimizeMock).toHaveBeenCalledTimes(1);
    expect(minimizeMock.mock.invocationCallOrder[0]).toBeLessThan(
      invokeMock.mock.invocationCallOrder[startScreenshotCall]
    );
  });

  it('allows disabling minimization before taking a screenshot', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_hotkeys') return Promise.resolve({ screenshot: 'Ctrl+Shift+S' });
      if (command === 'get_screenshot_settings') return Promise.resolve({ minimizeBeforeCapture: false });
      return Promise.resolve();
    });

    render(<ScreenshotEditor />);

    const minimizeCheckbox = await screen.findByRole('checkbox', { name: '截图前最小化主窗口' });
    await waitFor(() => expect(minimizeCheckbox).not.toBeChecked());

    fireEvent.click(await screen.findByText('screenshotEditor.capture'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_screenshot');
    });
    expect(minimizeMock).not.toHaveBeenCalled();
  });

  it('persists changes to the minimization setting', async () => {
    render(<ScreenshotEditor />);

    fireEvent.click(await screen.findByRole('checkbox', { name: '截图前最小化主窗口' }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_screenshot_minimize_before_capture', {
        minimizeBeforeCapture: false,
      });
    });
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

  it('跳转翻译而卸载编辑器后，不显示已取消会话的加载失败提示', async () => {
    const images: Array<{ onerror: (() => void) | null }> = [];
    class DeferredImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        images.push(this);
      }
    }
    vi.stubGlobal('Image', DeferredImage);
    useAppStore.setState({ activeToolId: 'screenshot-editor' });
    useScreenshotOcrStore.setState({
      screenshotSession: { id: 1, imageDataUrl: 'data:image/png;base64,test', text: '截图原文' },
    });

    const { unmount } = render(<ScreenshotEditor />);
    await act(async () => {
      await Promise.resolve();
    });
    unmount();

    act(() => images[0]?.onerror?.());

    expect(toastError).not.toHaveBeenCalledWith('截图识别会话加载失败，请重试');
  });

  it('跳转翻译后忽略已取消会话的 Blob 加载失败', async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    let rejectFetch!: (reason?: unknown) => void;
    class DeferredImage {
      width = 1;
      height = 1;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        images.push(this);
      }
    }
    vi.stubGlobal('Image', DeferredImage);
    useAppStore.setState({ activeToolId: 'screenshot-editor' });
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    useScreenshotOcrStore.setState({
      screenshotSession: { id: 1, imageDataUrl: 'data:image/png;base64,test', text: '截图原文' },
    });

    const { unmount } = render(<ScreenshotEditor />);
    await waitFor(() => expect(images[0]?.onload).toBeTypeOf('function'));
    act(() => images[0]?.onload?.());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    unmount();
    await act(async () => {
      rejectFetch(new Error('请求已取消'));
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalledWith('截图识别会话加载失败，请重试');
  });

  it('翻译页活动时，常驻的截图编辑器不加载新的识别会话', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        this.onerror?.();
      }
    }
    vi.stubGlobal('Image', FailingImage);
    useAppStore.setState({ activeToolId: 'translator' });
    useScreenshotOcrStore.setState({
      screenshotSession: { id: 1, imageDataUrl: 'data:image/png;base64,test', text: '截图原文' },
    });

    render(<ScreenshotEditor />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(toastError).not.toHaveBeenCalledWith('截图识别会话加载失败，请重试');
  });
});
