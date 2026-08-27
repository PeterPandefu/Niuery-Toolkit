import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeFileDropBridge } from '@/components/shared/NativeFileDropBridge';

const { onDragDropEventMock, convertFileSrcMock } = vi.hoisted(() => ({
  onDragDropEventMock: vi.fn(),
  convertFileSrcMock: vi.fn((path: string) => `asset://${encodeURIComponent(path)}`),
}));

vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: onDragDropEventMock }) }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: convertFileSrcMock }));

describe('NativeFileDropBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    globalThis.fetch = vi.fn(async () => new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } }));
  });

  it('converts Tauri path drops into a DOM drop event for the target tool', async () => {
    const target = document.createElement('div');
    document.body.append(target);
    Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => target), configurable: true });
    const drop = vi.fn();
    target.addEventListener('drop', drop);
    onDragDropEventMock.mockImplementationOnce((handler: (event: unknown) => void) => {
      void handler({ payload: { type: 'drop', paths: ['C:\\tmp\\sample.txt'], position: { x: 20, y: 40 } } });
      return Promise.resolve(() => undefined);
    });

    render(<NativeFileDropBridge />);

    await waitFor(() => expect(drop).toHaveBeenCalledOnce());
    const event = drop.mock.calls[0][0] as DragEvent;
    expect(event.dataTransfer?.files[0]).toHaveProperty('name', 'sample.txt');
    expect(convertFileSrcMock).toHaveBeenCalledWith('C:\\tmp\\sample.txt');
  });
});
