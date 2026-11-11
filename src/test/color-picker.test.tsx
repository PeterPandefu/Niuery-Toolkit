import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ColorWheelTab from '@/tools/converter/color-assistant/ColorWheelTab';

const { invoke, listen, errorToast } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), errorToast: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('sonner', () => ({ toast: { error: errorToast, success: vi.fn() } }));

let picked: ((event: { payload: string }) => void) | undefined;
let closed: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('EyeDropper', undefined);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  invoke.mockResolvedValue(undefined);
  listen.mockImplementation(async (name: string, handler: typeof picked) => {
    if (name === 'screen-color-picked') picked = handler;
    if (name === 'screen-color-picker-closed') closed = handler as () => void;
    return vi.fn();
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); picked = undefined; closed = undefined; });

it('uses desktop capture without EyeDropper and applies the selected color', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  render(<ColorWheelTab />);
  fireEvent.click(screen.getByTitle('屏幕取色'));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith('start_screenshot', { mode: 'color' }));
  await act(async () => picked?.({ payload: '#123456' }));
  expect(screen.getByDisplayValue('#123456')).toBeInTheDocument();
  expect(errorToast).not.toHaveBeenCalled();
  expect(screen.getByTitle('屏幕取色')).toBeDisabled();
  await act(async () => closed?.());
  expect(screen.getByTitle('屏幕取色')).toBeEnabled();
});

it('treats browser cancellation as cancellation instead of an error', async () => {
  vi.stubGlobal('EyeDropper', class { open() { return Promise.reject(new DOMException('cancelled', 'AbortError')); } });
  render(<ColorWheelTab />);
  fireEvent.click(screen.getByTitle('屏幕取色'));
  await act(async () => { await Promise.resolve(); });
  expect(errorToast).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('#908637')).toBeInTheDocument();
});

it('keeps browser EyeDropper success working', async () => {
  vi.stubGlobal('EyeDropper', class { open() { return Promise.resolve({ sRGBHex: '#abcdef' }); } });
  render(<ColorWheelTab />);
  fireEvent.click(screen.getByTitle('屏幕取色'));
  await waitFor(() => expect(screen.getAllByRole('textbox').some((input) => (input as HTMLInputElement).value === '#ABCDEF')).toBe(true));
  expect(screen.getByTitle('屏幕取色')).toBeEnabled();
});

it('releases desktop listeners after startup fails and allows retry', async () => {
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  invoke.mockRejectedValueOnce(new Error('capture busy'));
  render(<ColorWheelTab />);
  fireEvent.click(screen.getByTitle('屏幕取色'));
  await waitFor(() => expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('capture busy')));
  expect(screen.getByTitle('屏幕取色')).toBeEnabled();
  await act(async () => picked?.({ payload: '#ffffff' }));
  expect(screen.getByDisplayValue('#908637')).toBeInTheDocument();
});

it('explains unsupported browser capability instead of referencing a missing constructor', async () => {
  render(<ColorWheelTab />);
  fireEvent.click(screen.getByTitle('屏幕取色'));
  await waitFor(() => expect(errorToast).toHaveBeenCalledWith(expect.stringContaining('当前浏览器不支持屏幕取色')));
  expect(screen.getByTitle('屏幕取色')).toBeEnabled();
});
