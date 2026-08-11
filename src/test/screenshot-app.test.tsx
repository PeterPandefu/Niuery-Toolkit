import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScreenshotApp from '@/screenshot/ScreenshotApp';

const { convertFileSrcMock, invokeMock, listenMock, unlistenMock } = vi.hoisted(() => ({
  convertFileSrcMock: vi.fn((path: string) => `asset://${path}`),
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  unlistenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: convertFileSrcMock, invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

interface ScreenshotCapture {
  generation: number;
  mode: 'normal' | 'longshot';
  path: string;
}

let currentCapture: ScreenshotCapture | null;
let captureReadyHandler: ((event: { payload: { generation: number } }) => void) | null;
let crossOriginAtSrcAssignment: string | null | undefined;

class PendingImage {
  naturalWidth = 0;
  naturalHeight = 0;
  crossOrigin: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_value: string) {
    // 保持解码未完成，用于模拟大截图加载。
  }
}

class LoadedImage extends PendingImage {
  naturalWidth = 1_920;
  naturalHeight = 1_080;

  set src(_value: string) {
    crossOriginAtSrcAssignment = this.crossOrigin;
    queueMicrotask(() => this.onload?.());
  }
}

async function emitCaptureReady(generation: number) {
  await act(async () => {
    captureReadyHandler?.({ payload: { generation } });
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ScreenshotApp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', PendingImage);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
    currentCapture = null;
    captureReadyHandler = null;
    crossOriginAtSrcAssignment = undefined;
    listenMock.mockImplementation(async (eventName: string, handler: typeof captureReadyHandler) => {
      if (eventName === 'screenshot-capture-ready') captureReadyHandler = handler;
      return unlistenMock;
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.resolve(currentCapture);
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    invokeMock.mockReset();
    convertFileSrcMock.mockClear();
    listenMock.mockReset();
    unlistenMock.mockReset();
  });

  it('预热窗口无截图数据时不触发原生全屏操作，并等待捕获事件', async () => {
    render(<ScreenshotApp />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(listenMock).toHaveBeenCalledWith('screenshot-capture-ready', expect.any(Function));
    expect(invokeMock).not.toHaveBeenCalledWith('prepare_screenshot_window');
    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');
    expect(invokeMock).not.toHaveBeenCalledWith('close_screenshot_window');
  });

  it('收到捕获事件并提交截图覆盖层后立即显示预热窗口', async () => {
    vi.stubGlobal('Image', LoadedImage);
    let overlayWasCommitted = false;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.resolve(currentCapture);
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

    currentCapture = { generation: 1, mode: 'normal', path: 'C:/cache/captured-screen.png' };
    await emitCaptureReady(1);
    expect(invokeMock).toHaveBeenCalledWith('show_screenshot_window', { generation: 1 });
    expect(convertFileSrcMock).toHaveBeenCalledWith('C:/cache/captured-screen.png');
    expect(overlayWasCommitted).toBe(true);
  });

  it('以匿名跨域模式加载截图，避免框选导出时污染画布', async () => {
    vi.stubGlobal('Image', LoadedImage);
    render(<ScreenshotApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    currentCapture = { generation: 1, mode: 'normal', path: 'C:/cache/captured-screen.png' };
    await emitCaptureReady(1);

    expect(crossOriginAtSrcAssignment).toBe('anonymous');
  });

  it('同一预热窗口可连续加载并显示多个截图会话', async () => {
    vi.stubGlobal('Image', LoadedImage);
    render(<ScreenshotApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    currentCapture = { generation: 1, mode: 'normal', path: 'C:/cache/first-screen.png' };
    await emitCaptureReady(1);

    currentCapture = { generation: 2, mode: 'longshot', path: 'C:/cache/second-screen.png' };
    await emitCaptureReady(2);

    expect(invokeMock.mock.calls.filter(([command]) => command === 'show_screenshot_window')).toHaveLength(2);
  });

  it('截图数据加载失败时关闭隐藏窗口并释放会话', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.reject(new Error('截图数据不可用'));
      return Promise.resolve();
    });

    render(<ScreenshotApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(invokeMock).toHaveBeenCalledWith('close_screenshot_window', {});
    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');
  });

  it('组件卸载时取消窗口显示重试', async () => {
    vi.stubGlobal('Image', LoadedImage);
    currentCapture = { generation: 1, mode: 'normal', path: 'C:/cache/captured-screen.png' };
    let showCalls = 0;
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_screen_capture') return Promise.resolve(currentCapture);
      if (command === 'show_screenshot_window') {
        showCalls += 1;
        return Promise.reject(new Error('窗口暂不可用'));
      }
      return Promise.resolve();
    });

    const { unmount } = render(<ScreenshotApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(showCalls).toBe(1);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(showCalls).toBe(1);
  });

  it('组件卸载时注销捕获事件并忽略后续通知', async () => {
    vi.stubGlobal('Image', LoadedImage);
    const { unmount } = render(<ScreenshotApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    unmount();
    currentCapture = { generation: 1, mode: 'normal', path: 'C:/cache/captured-screen.png' };
    await emitCaptureReady(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(unlistenMock).toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith('show_screenshot_window');
  });
});
