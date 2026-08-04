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
    render(<ScreenshotOverlay screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />);

    expect(screen.getByText(/拖动鼠标框选截图区域/)).toBeInTheDocument();
    expect(screen.getByTestId('screenshot-idle-mask')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'm' });

    expect(screen.getByText(/按住鼠标绘制截图区域/)).toBeInTheDocument();
  });

  it('provides a visible cancel action while the full-screen layer is idle', () => {
    render(<ScreenshotOverlay screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />);

    fireEvent.click(screen.getByRole('button', { name: '取消截图（Esc）' }));

    expect(invokeMock).toHaveBeenCalledWith('close_screenshot_window');
  });

  it('keeps the screen visible outside the hand-drawn selection rectangle', async () => {
    const { container } = render(
      <ScreenshotOverlay screenImage={{ src: 'screen' } as HTMLImageElement} screenW={100} screenH={100} />
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
