import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScreenshotApp from '@/screenshot/ScreenshotApp';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

class PendingImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    // Keep decoding pending to model a slow screenshot image.
  }
}

class LoadedImage extends PendingImage {
  naturalWidth = 1_920;
  naturalHeight = 1_080;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

describe('ScreenshotApp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', PendingImage);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.resolve('captured-screen');
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invokeMock.mockReset();
  });

  it('keeps the transparent overlay hidden until the screenshot has decoded', async () => {
    render(<ScreenshotApp />);

    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');
  });

  it('shows the native window only after the screenshot overlay has committed for two frames', async () => {
    vi.stubGlobal('Image', LoadedImage);
    let overlayWasCommitted = false;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.resolve('captured-screen');
      if (command === 'show_screenshot_window') {
        overlayWasCommitted = document.querySelector('img[alt=""]') !== null;
      }
      return Promise.resolve();
    });

    render(<ScreenshotApp />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31);
    });
    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(invokeMock).toHaveBeenCalledWith('show_screenshot_window');
    expect(overlayWasCommitted).toBe(true);
  });

  it('closes the hidden native window when loading the screenshot fails', async () => {
    vi.useRealTimers();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.reject(new Error('capture unavailable'));
      return Promise.resolve();
    });

    render(<ScreenshotApp />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('close_screenshot_window');
    });

    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');
  });

  it('cancels a scheduled window-show retry when unmounted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', LoadedImage);
    let showCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.resolve('captured-screen');
      if (command === 'show_screenshot_window') {
        showCalls += 1;
        return Promise.reject(new Error('window unavailable'));
      }
      return Promise.resolve();
    });

    const { unmount } = render(<ScreenshotApp />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(showCalls).toBe(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(showCalls).toBe(1);
  });
});
