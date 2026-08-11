import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotOverlay } from '@/screenshot/ScreenshotOverlay';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/screenshot/AnnotationLayer', () => ({ AnnotationLayer: () => null }));
vi.mock('@/screenshot/EditToolbar', () => ({ EditToolbar: () => null }));

describe('ScreenshotOverlay selection mode', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      clip: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      fillStyle: '',
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,masked');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    invokeMock.mockReset();
  });

  it('starts in rectangle selection mode and switches to freehand with M', () => {
    render(<ScreenshotOverlay generation={1} screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />);

    expect(screen.getByText(/拖动鼠标框选截图区域/)).toBeInTheDocument();
    expect(screen.getByTestId('screenshot-idle-mask')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'm' });

    expect(screen.getByText(/按住鼠标绘制截图区域/)).toBeInTheDocument();
  });

  it('provides a visible cancel action while the full-screen layer is idle', () => {
    render(<ScreenshotOverlay generation={1} screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />);

    fireEvent.click(screen.getByRole('button', { name: '取消截图（Esc）' }));

    expect(invokeMock).toHaveBeenCalledWith('close_screenshot_window', { generation: 1 });
  });

  it('在 React 提交选择阶段前完成的快速拖拽也会落入已确认选区', () => {
    const { container } = render(
      <ScreenshotOverlay generation={1} screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />,
    );
    const overlay = container.firstElementChild!;

    // 原生输入不会等待 React effect 安装 mousemove/mouseup 监听器。
    // 将三个事件置于同一同步批次，模拟用户按下后立刻拖动并松开。
    act(() => {
      overlay.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 50, clientY: 40, button: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 50, clientY: 40, button: 0 }));
    });

    expect(screen.getByTestId('selection-outside-mask')).toBeInTheDocument();
    expect(screen.queryByTestId('screenshot-idle-mask')).not.toBeInTheDocument();
  });

  it('框选中按 Esc 后会卸载旧的鼠标回调，不能把已关闭会话推进到已确认选区', () => {
    const { container } = render(
      <ScreenshotOverlay generation={1} screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />,
    );
    const overlay = container.firstElementChild!;

    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(invokeMock).toHaveBeenCalledWith('close_screenshot_window', { generation: 1 });

    // 原生窗口 hide 后 WebView 不会立即卸载；此时旧鼠标事件仍可能抵达页面。
    fireEvent.mouseMove(window, { clientX: 50, clientY: 40 });
    fireEvent.mouseUp(window, { clientX: 50, clientY: 40 });

    expect(screen.queryByTestId('selection-outside-mask')).not.toBeInTheDocument();
  });

  it('手绘阶段按 Esc 会同步解除鼠标和失焦监听器', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const { container } = render(
      <ScreenshotOverlay generation={1} screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />,
    );
    const overlay = container.firstElementChild!;

    fireEvent.keyDown(window, { key: 'm' });
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10, button: 0 });
    fireEvent.keyDown(window, { key: 'Escape' });

    const removedEventTypes = removeEventListener.mock.calls.map(([type]) => type);
    expect(removedEventTypes).toEqual(expect.arrayContaining(['mousemove', 'mouseup', 'blur']));
    expect(screen.getByTestId('screenshot-idle-mask')).toBeInTheDocument();
  });

  it('keeps the screen visible outside the hand-drawn selection rectangle', async () => {
    const { container } = render(
      <ScreenshotOverlay generation={1} screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />
    );
    const overlay = container.firstElementChild!;

    if (screen.queryByText(/拖动鼠标框选截图区域/)) {
      fireEvent.keyDown(window, { key: 'm' });
    }
    fireEvent.mouseDown(overlay, { clientX: 10, clientY: 10 });
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 10 });
    fireEvent.mouseMove(window, { clientX: 30, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 30 });
    fireEvent.mouseMove(window, { clientX: 10, clientY: 10 });
    fireEvent.mouseUp(window);
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(overlay).not.toHaveClass('bg-white');
    expect(container.querySelector('img')).not.toHaveStyle({
      clipPath: 'polygon(10px 10px, 30px 10px, 30px 30px, 10px 30px, 10px 10px)',
    });
    expect(screen.getByTestId('selection-outside-mask')).toHaveStyle({
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
    });
  });
});
