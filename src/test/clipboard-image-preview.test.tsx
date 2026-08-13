import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardImagePreview } from '@/tools/text/clipboard-image-preview';

const { invokeMock, toastError } = vi.hoisted(() => ({ invokeMock: vi.fn(), toastError: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const entries = [
  { id: 'first', preview: '图片 10x20', timestamp: 1_700_000_000_000 },
  { id: 'second', preview: '图片 30x40', timestamp: 1_700_000_100_000 },
];

describe('ClipboardImagePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation((_command: string, { id }: { id: string }) => Promise.resolve(id === 'first' ? 'Zmlyc3Q=' : 'c2Vjb25k'));
  });

  it('读取完整历史原图，展示尺寸并支持键盘切换', async () => {
    const onClose = vi.fn();
    render(<ClipboardImagePreview entries={entries} initialId="first" onClose={onClose} />);

    const image = await screen.findByRole('img', { name: '剪贴板历史图片 1 / 2' });
    expect(image).toHaveAttribute('src', 'data:image/png;base64,Zmlyc3Q=');
    Object.defineProperties(image, {
      naturalWidth: { value: 10 },
      naturalHeight: { value: 20 },
    });
    fireEvent.load(image);
    expect(screen.getByText(/10 × 20/)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByRole('img', { name: '剪贴板历史图片 2 / 2' })).toHaveAttribute('src', 'data:image/png;base64,c2Vjb25k'));

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
