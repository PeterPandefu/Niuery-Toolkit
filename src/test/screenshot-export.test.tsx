import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExport } from '@/tools/graphic/screenshot/useExport';

const { invokeMock, successMock, infoMock, errorMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  successMock: vi.fn(),
  infoMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('sonner', () => ({ toast: { success: successMock, info: infoMock, error: errorMock } }));

function createStage() {
  let scale = 1;
  let position = { x: 0, y: 0 };
  return {
    scaleX: () => scale,
    x: () => position.x,
    y: () => position.y,
    scale: ({ x }: { x: number }) => { scale = x; },
    position: (next: { x: number; y: number }) => { position = next; },
    batchDraw: vi.fn(),
    toDataURL: vi.fn(() => 'data:image/png;base64,ZW5jb2RlZC1pbWFnZQ=='),
  };
}

describe('screenshot editor export and copy', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    invokeMock.mockResolvedValue('C:\\Users\\Peter\\Pictures\\screenshot.png');
    successMock.mockReset();
    infoMock.mockReset();
    errorMock.mockReset();
  });

  afterEach(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    invokeMock.mockReset();
  });

  it('reports the exact native save location after exporting', async () => {
    const stageRef = { current: createStage() } as never;
    const { result } = renderHook(() => useExport({ stageRef, canvasSize: { width: 320, height: 200 } }));

    await act(async () => { await result.current.exportImage('png', 90); });

    expect(invokeMock).toHaveBeenCalledWith('save_file_dialog', expect.objectContaining({
      defaultName: expect.stringMatching(/^screenshot_.*\.png$/),
      filterName: 'PNG',
      extensions: ['png'],
    }));
    expect(successMock).toHaveBeenCalledWith(expect.stringContaining('C:\\Users\\Peter\\Pictures\\screenshot.png'));
  });

  it('uses the native clipboard bridge in the desktop app', async () => {
    const stageRef = { current: createStage() } as never;
    const { result } = renderHook(() => useExport({ stageRef, canvasSize: { width: 320, height: 200 } }));

    await act(async () => { await result.current.copyToClipboard(); });

    expect(invokeMock).toHaveBeenCalledWith('copy_image_to_clipboard', { base64Data: 'ZW5jb2RlZC1pbWFnZQ==' });
    expect(successMock).toHaveBeenCalledWith('已复制到剪贴板');
    expect(errorMock).not.toHaveBeenCalled();
  });
});
