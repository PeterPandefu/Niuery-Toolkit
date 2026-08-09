import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRecorder } from '@/tools/graphic/screen-recorder/useRecorder';
import type { CaptureTarget, RecordingSettings, RecordingStatusEvent } from '@/tools/graphic/screen-recorder/types';

const { invokeMock, listenMock, convertFileSrcMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
  convertFileSrcMock: vi.fn(() => 'asset://localhost/recording.mp4'),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, convertFileSrc: convertFileSrcMock }));
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
      return Promise.resolve();
    });
  });

  afterEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    convertFileSrcMock.mockReset();
    statusListener = undefined;
  });

  it('通过受限资源协议加载已停止录制，保留 MP4 原始字节', async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => { await result.current.start(target, settings); });
    await act(async () => { await result.current.stop(); });

    const loadPreview = (result.current as typeof result.current & {
      loadPreview?: () => string | null;
    }).loadPreview;
    const source = loadPreview?.();

    expect(source).toBe('asset://localhost/recording.mp4');
    expect(convertFileSrcMock).toHaveBeenCalledWith('C:\\recording.mp4');
    expect(invokeMock).not.toHaveBeenCalledWith('get_recording_preview', expect.anything());
  });

  it('通过受限会话 ID 请求在文件夹中定位录制缓存文件', async () => {
    const { result } = renderHook(() => useRecorder());

    await act(async () => { await result.current.start(target, settings); });
    await act(async () => { await result.current.stop(); });
    await act(async () => { await result.current.revealInFolder(); });

    expect(invokeMock).toHaveBeenCalledWith('reveal_recording_in_folder', { sessionId: 'session-1' });
  });

  it('保留 GIF 导出的具体后端错误，供预览界面与日志展示', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'start_recording') {
        return Promise.resolve({ id: 'session-1', width: 320, height: 180, startedAt: 1 });
      }
      if (command === 'stop_recording') {
        return Promise.resolve({ path: 'C:\\recording.mp4', durationMs: 1_000, width: 320, height: 180 });
      }
      if (command === 'export_recording') {
        return Promise.reject(new Error('GIF 导出失败（FFmpeg 退出码 1）：Invalid data found when processing input'));
      }
      return Promise.resolve();
    });
    const { result } = renderHook(() => useRecorder());

    await act(async () => { await result.current.start(target, settings); });
    await act(async () => { await result.current.stop(); });
    let failure: unknown;
    await act(async () => {
      try {
        await result.current.exportRecording('gif');
      } catch (reason) {
        failure = reason;
      }
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('FFmpeg 退出码 1');
    expect(result.current.error).toContain('Invalid data found when processing input');
    expect(invokeMock).toHaveBeenCalledWith('export_recording', expect.objectContaining({
      sessionId: 'session-1',
      format: 'gif',
    }));
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
