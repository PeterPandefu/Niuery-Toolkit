import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessingResultPreview } from '@/tools/graphic/image-studio/processing-result-preview';

const { invokeMock, toastSuccess, toastMessage, toastInfo } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
  toastInfo: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, message: toastMessage, info: toastInfo, error: vi.fn() } }));

describe('ProcessingResultPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    invokeMock.mockResolvedValue('C:\\Users\\Peter\\Pictures\\result.png');
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => `blob:result-${blob.size}`),
      revokeObjectURL: vi.fn(),
    });
  });

  it('单图处理结果在保存前并排显示原图和结果', () => {
    render(
      <ProcessingResultPreview
        sourceFiles={[new File(['source'], '原图.png', { type: 'image/png' })]}
        result={{ files: [{ name: '原图-处理.png', blob: new Blob(['result'], { type: 'image/png' }) }], zipName: '处理结果.zip' }}
      />
    );

    expect(screen.getByRole('img', { name: '原图预览' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '处理结果预览，点击放大' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('批量结果支持保存单张与保存全部', async () => {
    render(
      <ProcessingResultPreview
        sourceFiles={[]}
        result={{
          files: [
            { name: '一.png', blob: new Blob(['one'], { type: 'image/png' }) },
            { name: '二.png', blob: new Blob(['two'], { type: 'image/png' }) },
          ],
          zipName: '批量结果.zip',
        }}
      />
    );

    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('save_file_dialog', expect.objectContaining({ defaultName: '一.png' })));

    fireEvent.click(screen.getByRole('button', { name: '保存全部' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('save_file_dialog', expect.objectContaining({ defaultName: '批量结果.zip' })));
  });

  it('opens results above the tool context and navigates in the same full-screen dialog', () => {
    const { container, unmount } = render(
      <div style={{ position: 'relative', zIndex: 10, overflow: 'hidden' }}>
        <ProcessingResultPreview sourceFiles={[]} result={{
          files: [
            { name: 'first.png', blob: new Blob(['first'], { type: 'image/png' }) },
            { name: 'second.png', blob: new Blob(['second'], { type: 'image/png' }) },
          ],
          zipName: 'results.zip',
        }} />
      </div>,
    );

    fireEvent.click(screen.getByTitle('放大查看 first.png'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
    expect(within(dialog).getByRole('img', { name: 'first.png 处理结果预览' })).toHaveAttribute('src', 'blob:result-5');
    fireEvent.click(within(dialog).getByRole('button', { name: '全屏预览' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: '下一张（→）' }));
    expect(within(dialog).getByRole('img', { name: 'second.png 处理结果预览' })).toHaveAttribute('src', 'blob:result-6');
    expect(within(dialog).getByRole('button', { name: '退出全屏预览' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(within(dialog).getByRole('img', { name: 'first.png 处理结果预览' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /保存全部/ })).toBeInTheDocument();
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result-5');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result-6');
  });
});
