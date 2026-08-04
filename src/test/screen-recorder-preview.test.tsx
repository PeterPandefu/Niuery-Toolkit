import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecorder } from '@/tools/graphic/screen-recorder/useRecorder';
import type { CaptureTarget, RecordingSettings, RecordingStatusEvent } from '@/tools/graphic/screen-recorder/types';

const { invokeMock, listenMock, createObjectUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  createObjectUrlMock: vi.fn(() => 'blob:recording-preview'),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const target: CaptureTarget = {
  mode: 'region',
  monitorId: 'primary',
  rect: { x: 0, y: 0, width: 320, height: 180 },
};

const settings: RecordingSettings = {
  fps: 30,
  quality: 'balanced',
  countdownSec: 0,
  cursorHighlight: true,
  audio: { microphone: false, system: false },
};

let statusListener: ((event: { payload: RecordingStatusEvent }) => void) | undefined;

describe('screen recording preview', () => {
  beforeEach(() => {
    listenMock.mockImplementation((_event: string, listener: typeof statusListener) => {
      statusListener = listener;
      return Promise.resolve(vi.fn());
    });
    invokeMock.mockImplementation((command: string) => {
      if (command === 'start_recording') {
        return Promise.resolve({ id: 'session-1', width: 320, height: 180, startedAt: 1 });
      }
      if (command === 'stop_recording') {
        return Promise.resolve({ path: 'C:\\recording.mp4', durationMs: 1_000, width: 320, height: 180 });
      }
      if (command === 'get_recording_preview') return Promise.resolve(new Uint8Array([0, 1, 2, 3]).buffer);
      return Promise.resolve();
    });
    vi.stubGlobal('URL', { createObjectURL: createObjectUrlMock, revokeObjectURL: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    invokeMock.mockReset();
    listenMock.mockReset();
    createObjectUrlMock.mockReset();
    statusListener = undefined;
  });

  it('loads a stopped recording through the native bridge as a blob URL', async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => { await result.current.start(target, settings); });
    await act(async () => { await result.current.stop(); });

    const loadPreview = (result.current as typeof result.current & {
      loadPreview?: () => Promise<string | null>;
    }).loadPreview;
    const source = await loadPreview?.();

    expect(source).toBe('blob:recording-preview');
    expect(invokeMock).toHaveBeenCalledWith('get_recording_preview', { sessionId: 'session-1' });
    expect(createObjectUrlMock).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('全局录屏快捷键停止后同步录制成品', async () => {
    const onStatus = vi.fn();
    const { result } = renderHook(() => useRecorder({ onStatus }));
    await act(async () => { await result.current.start(target, settings); });

    const artifact = { path: 'C:\\recording.mp4', durationMs: 1_000, width: 320, height: 180 };
    act(() => {
      statusListener?.({
        payload: {
          sessionId: 'session-1',
          status: 'stopped',
          elapsedMs: 1_000,
          fps: 0,
          droppedFrames: 0,
          artifact,
        },
      });
    });

    expect(result.current.session).toBeNull();
    expect(result.current.artifact).toEqual(artifact);
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped', artifact }));
  });
});
