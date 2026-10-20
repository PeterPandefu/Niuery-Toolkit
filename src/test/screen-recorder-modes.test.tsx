import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ScreenRecorder from '@/tools/graphic/screen-recorder';

const { invokeMock, listeners } = vi.hoisted(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  return { invokeMock: vi.fn(), listeners: new Map<string, (event: { payload: unknown }) => void>() };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn((name, callback) => {
  listeners.set(name, callback);
  return Promise.resolve(() => listeners.delete(name));
}) }));

const monitors = [
  { id: 'primary', name: '主显示器', x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, primary: true },
  { id: 'secondary', name: '副显示器', x: -1280, y: 0, width: 1280, height: 720, scaleFactor: 1.5, primary: false },
];
const windows = [{ id: 42, title: '演示文档', appName: '记事本', x: 10, y: 20, width: 640, height: 480, monitorId: 'primary' }];
let currentWindows = windows;

beforeEach(() => {
  currentWindows = windows;
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'list_capture_monitors') return monitors;
    if (command === 'list_capture_windows') return currentWindows;
    if (command === 'list_audio_sources') return [];
    if (command === 'start_recording') return { id: 'session-1', width: 640, height: 480, startedAt: 1 };
  });
});
afterEach(() => { cleanup(); invokeMock.mockReset(); listeners.clear(); });

async function openMode(mode: string) {
  render(<ScreenRecorder />);
  await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_capture_monitors'));
  fireEvent.click(screen.getByRole('button', { name: mode }));
}
function noCountdown() {
  chooseOption('倒计时', '立即开始');
}
function chooseOption(label: string, name: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(screen.getByRole('option', { name }));
}

describe('录屏模式', () => {
  it('全屏录制选定的副显示器，不要求框选区域', async () => {
    await openMode('全屏录制');
    chooseOption('录制显示器', /副显示器/);
    noCountdown();
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('start_recording', {
      target: { mode: 'monitor', monitorId: 'secondary' }, settings: expect.objectContaining({ countdownSec: 0 }),
    }));
    expect(screen.getByText('正在录制')).toBeInTheDocument();
  });

  it('窗口不自动选择，搜索后按窗口 ID 启动', async () => {
    await openMode('窗口录制');
    expect(screen.getByRole('button', { name: '开始录制' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('搜索窗口'), { target: { value: '记事本' } });
    chooseOption('录制窗口', /演示文档/);
    noCountdown();
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('start_recording', {
      target: { mode: 'window', windowId: 42 }, settings: expect.objectContaining({ countdownSec: 0 }),
    }));
  });

  it('刷新保留有效窗口，失效后清空选择并禁用启动', async () => {
    await openMode('窗口录制');
    chooseOption('录制窗口', /演示文档/);
    fireEvent.click(screen.getByRole('button', { name: '刷新来源' }));
    await waitFor(() => expect(screen.getByLabelText('录制窗口')).toHaveValue('42'));
    currentWindows = [];
    fireEvent.click(screen.getByRole('button', { name: '刷新来源' }));
    await waitFor(() => expect(screen.getByLabelText('录制窗口')).toHaveValue(''));
    expect(screen.getByRole('button', { name: '开始录制' })).toBeDisabled();
  });

  it('倒计时期间锁定模式、来源及设置，阻止重复启动', async () => {
    await openMode('全屏录制');
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '开始录制' }));
      expect(screen.getByRole('button', { name: '窗口录制' })).toBeDisabled();
      expect(screen.getByLabelText('录制显示器')).toBeDisabled();
      expect(screen.getByLabelText('倒计时')).toBeDisabled();
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(invokeMock.mock.calls.filter(([name]) => name === 'start_recording')).toHaveLength(1);
    } finally { vi.useRealTimers(); }
  });

  it('目标自动停止后进入可导出的预览并显示保留原因', async () => {
    await openMode('窗口录制');
    chooseOption('录制窗口', /演示文档/);
    noCountdown();
    fireEvent.click(screen.getByRole('button', { name: '开始录制' }));
    await screen.findByText('正在录制');
    act(() => listeners.get('recording-status')?.({ payload: {
      sessionId: 'session-1', status: 'stopped', elapsedMs: 1000, fps: 30, droppedFrames: 0,
      artifact: { path: 'C:/recording.mp4', width: 640, height: 480, durationMs: 1000, warning: '目标窗口已最小化，已停止并保存录制' },
    } }));
    expect(screen.getByText('录制完成')).toBeInTheDocument();
    expect(screen.getByText('目标窗口已最小化，已停止并保存录制')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 MP4' })).toBeEnabled();
  });
});
