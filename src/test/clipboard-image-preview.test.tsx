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

  it('将预览挂载到页面顶层，避开工具内容区的层叠和裁剪', async () => {
    const { container, unmount } = render(
      <div style={{ position: 'relative', zIndex: 10, overflow: 'hidden' }}>
        <ClipboardImagePreview entries={entries} initialId="first" onClose={() => undefined} />
      </div>,
    );

    await screen.findByRole('img', { name: '剪贴板历史图片 1 / 2' });
    const dialog = screen.getByRole('dialog', { name: '图片预览' });
    expect(dialog.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);

    unmount();
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument();
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

  it('在同一共享弹窗内全屏、切图和缩放，不叠加第二个弹窗', async () => {
    render(<ClipboardImagePreview entries={entries} initialId="first" onClose={() => undefined} />);
    await screen.findByRole('img', { name: '剪贴板历史图片 1 / 2' });

    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));
    expect(screen.getAllByRole('dialog', { name: '图片预览' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: '退出全屏预览' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一张（→）' }));
    await screen.findByRole('img', { name: '剪贴板历史图片 2 / 2' });
    expect(screen.getByRole('button', { name: '退出全屏预览' })).toBeInTheDocument();
    fireEvent.wheel(screen.getByRole('region', { name: '图片预览区域' }), { deltaY: -100 });
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('单张图片不显示切图按钮，点击遮罩关闭', async () => {
    const onClose = vi.fn();
    render(<ClipboardImagePreview entries={entries.slice(0, 1)} initialId="first" onClose={onClose} />);
    await screen.findByRole('img', { name: '剪贴板历史图片 1 / 1' });
    expect(screen.queryByRole('button', { name: '上一张（←）' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一张（→）' })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '关闭预览' })[0]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('读取失败时通知并关闭，不保留空弹窗', async () => {
    invokeMock.mockRejectedValueOnce(new Error('原图不存在'));
    const onClose = vi.fn();
    render(<ClipboardImagePreview entries={entries} initialId="first" onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(toastError).toHaveBeenCalledWith('读取历史图片失败：原图不存在');
  });
});
