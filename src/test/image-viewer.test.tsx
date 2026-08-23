import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageViewer } from '@/components/media/image-viewer';

describe('ImageViewer', () => {
  it('zooms through the shared controls and resets to fit', () => {
    render(<ImageViewer source="data:image/png;base64,abc" alt="共享图片" mode="inline" />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '放大预览' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('moves the image while the pointer is dragged', () => {
    render(<ImageViewer source="data:image/png;base64,abc" alt="可拖动图片" mode="inline" />);

    const viewport = screen.getByRole('region', { name: '图片预览区域' });
    const image = screen.getByRole('img', { name: '可拖动图片' });
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 40, clientY: 60 });
    fireEvent.pointerUp(viewport, { pointerId: 1 });

    expect(image).toHaveStyle({ transform: 'translate(30px, 40px) scale(1)' });
  });

  it('updates the rendered source when the preview source changes', () => {
    const { rerender } = render(<ImageViewer source="data:image/png;base64,first" alt="可替换图片" mode="inline" />);
    rerender(<ImageViewer source="data:image/png;base64,second" alt="可替换图片" mode="inline" />);

    expect(screen.getByRole('img', { name: '可替换图片' })).toHaveAttribute('src', 'data:image/png;base64,second');
  });

  it('closes a dialog with Escape', () => {
    const onClose = () => undefined;
    render(<ImageViewer source="data:image/png;base64,abc" alt="弹窗图片" mode="dialog" onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument();
  });
});
