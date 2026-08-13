import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageFileDropzone } from '@/tools/graphic/image-studio/image-file-dropzone';

const { invokeMock, toastSuccess, toastError } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const imageEntry = {
  id: 'image-1',
  content_type: 'image',
  image_thumbnail: null,
  preview: '图片 10x20',
  timestamp: 1_700_000_000_000,
};

describe('ImageFileDropzone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_clipboard_history') return Promise.resolve([imageEntry]);
      if (command === 'get_clipboard_image') return Promise.resolve('aW1hZ2U=');
      return Promise.reject(new Error(`未知命令：${command}`));
    });
  });

  it('单图面板导入最新历史图片时替换当前文件', async () => {
    const onChange = vi.fn();
    render(<ImageFileDropzone files={[new File(['old'], 'old.png', { type: 'image/png' })]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '导入最新图片' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const [files] = onChange.mock.calls[0] as [File[]];
    expect(files).toHaveLength(1);
    expect(files[0]).toHaveProperty('type', 'image/png');
    expect(files[0].name).toMatch(/^剪贴板图片-.*\.png$/);
    expect(toastSuccess).toHaveBeenCalledWith('已导入最新剪贴板图片');
  });

  it('多图面板从历史列表选择图片时追加当前文件', async () => {
    const current = new File(['old'], 'old.png', { type: 'image/png' });
    const onChange = vi.fn();
    render(<ImageFileDropzone files={[current]} onChange={onChange} multiple />);

    fireEvent.click(screen.getByRole('button', { name: '历史图片' }));
    const item = await screen.findByRole('button', { name: /图片 10x20/ });
    fireEvent.click(item);

    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    const [files] = onChange.mock.calls[0] as [File[]];
    expect(files).toHaveLength(2);
    expect(files[0]).toBe(current);
    expect(files[1].name).toMatch(/^剪贴板图片-.*\.png$/);
  });
});
