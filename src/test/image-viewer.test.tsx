import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageViewer } from '@/components/media/image-viewer';

describe('ImageViewer', () => {
  it('shows optional image information and navigates with buttons and arrow keys', () => {
    function Gallery() {
      const [index, setIndex] = useState(0);
      return (
        <ImageViewer
          source={`data:image/png;base64,${index}`}
          alt={`图片 ${index + 1}`}
          mode="dialog"
          description={`第 ${index + 1} 张原图`}
          navigation={{
            onPrevious: () => setIndex((value) => (value + 1) % 2),
            onNext: () => setIndex((value) => (value + 1) % 2),
          }}
        />
      );
    }
    render(<Gallery />);

    expect(screen.getByText('第 1 张原图')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一张（→）' }));
    expect(screen.getByRole('img', { name: '图片 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '上一张（←）' }));
    expect(screen.getByRole('img', { name: '图片 1' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('第 2 张原图')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('第 1 张原图')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('combobox', { name: '预览背景' }), { key: 'ArrowRight' });
    expect(screen.getByText('第 1 张原图')).toBeInTheDocument();
  });

  it('keeps inline previews inside their host instead of creating a page overlay', () => {
    const { container } = render(<ImageViewer source="data:image/png;base64,abc" alt="内嵌图片" mode="inline" />);

    expect(container).toContainElement(screen.getByRole('region', { name: '图片预览区域' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('places shared preview dialogs above the tool stacking context', () => {
    const { container } = render(
      <div style={{ position: 'relative', zIndex: 10, overflow: 'hidden' }}>
        <ImageViewer source="data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E" alt="图表预览" mode="dialog" />
      </div>,
    );

    const dialog = screen.getByRole('dialog', { name: '图片预览' });
    expect(dialog.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
    expect(within(dialog).queryByRole('button', { name: '上一张（←）' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '下一张（→）' })).not.toBeInTheDocument();
  });

  it('zooms through the shared controls and resets to fit', () => {
    render(<ImageViewer source="data:image/png;base64,abc" alt="共享图片" mode="inline" />);

    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '放大预览' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '适应窗口' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('keeps a Mermaid SVG fitted to the viewport while it is enlarged', () => {
    render(
      <ImageViewer
        source="data:image/svg+xml,%3Csvg%20viewBox%3D%270%200%203000%20500%27%3E%3C%2Fsvg%3E"
        alt="大型 Mermaid 图表"
        mode="inline"
      />,
    );

    const image = screen.getByRole('img', { name: '大型 Mermaid 图表' });
    for (let index = 0; index < 12; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: '放大预览' }));
    }

    expect(screen.getByText('400%')).toBeInTheDocument();
    expect(image).toHaveClass('h-full', 'w-full', 'object-contain');
    expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(4)' });
  });

  it('lets users apply a background to a transparent SVG preview and keeps it in full screen', () => {
    render(
      <ImageViewer
        source="data:image/svg+xml,%3Csvg%20viewBox%3D%270%200%20100%20100%27%3E%3C%2Fsvg%3E"
        alt="透明 SVG"
        mode="inline"
      />,
    );

    const viewport = screen.getByRole('region', { name: '图片预览区域' });
    const background = screen.getByRole('combobox', { name: '预览背景' });
    expect(background).toHaveValue('transparent');
    expect(viewport).not.toHaveClass('bg-black/90');

    fireEvent.click(background);
    fireEvent.click(screen.getByRole('option', { name: '白色' }));
    expect(viewport).toHaveStyle({ backgroundColor: '#ffffff' });

    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));
    const dialog = screen.getByRole('dialog', { name: '图片预览' });
    expect(within(dialog).getByRole('region', { name: '图片预览区域' })).toHaveStyle({ backgroundColor: '#ffffff' });

    fireEvent.click(within(dialog).getByRole('combobox', { name: '预览背景' }));
    fireEvent.click(within(dialog).getByRole('option', { name: '深色' }));
    fireEvent.click(within(dialog).getByTitle('关闭预览（Esc）'));

    expect(background).toHaveValue('dark');
    expect(viewport).toHaveStyle({ backgroundColor: '#111827' });
  });

  it('applies a user-selected custom background color', () => {
    render(<ImageViewer source="data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E" alt="自定义背景 SVG" mode="inline" />);

    fireEvent.click(screen.getByRole('combobox', { name: '预览背景' }));
    fireEvent.click(screen.getByRole('option', { name: '自定义' }));
    fireEvent.change(screen.getByLabelText('自定义预览背景色'), { target: { value: '#fef3c7' } });

    expect(screen.getByRole('region', { name: '图片预览区域' })).toHaveStyle({ backgroundColor: '#fef3c7' });
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

  it('keeps its toolbar within the window when an unbounded image is shown', () => {
    render(<ImageViewer source="data:image/png;base64,very-wide-image" alt="超宽图片" mode="inline" />);

    expect(screen.getByRole('region', { name: '图片预览' })).toHaveClass('min-w-0');
    expect(screen.getByRole('region', { name: '图片预览区域' })).toHaveClass('min-w-0');
    expect(screen.getByRole('button', { name: '全屏预览' })).toBeVisible();
  });

  it('closes a dialog with Escape', () => {
    const onClose = () => undefined;
    render(<ImageViewer source="data:image/png;base64,abc" alt="弹窗图片" mode="dialog" onClose={onClose} />);

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument();
  });

  it('opens an immersive preview from the shared full-screen control', () => {
    render(<ImageViewer source="data:image/png;base64,abc" alt="全屏图片" mode="inline" />);

    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));

    expect(screen.getByRole('dialog', { name: '图片预览' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: '全屏图片' })).toHaveLength(2);
  });

  it('expands an existing preview dialog to the full viewport', () => {
    render(<ImageViewer source="data:image/png;base64,abc" alt="弹窗全屏图片" mode="dialog" />);

    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));

    expect(screen.getByRole('dialog', { name: '图片预览' })).toHaveClass('p-0');
    expect(screen.getByRole('button', { name: '退出全屏预览' })).toBeInTheDocument();
  });
});
