import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CursorHighlightOverlay from '@/recording/CursorHighlightOverlay';
import RecordingCaptureBorderOverlay from '@/recording/RecordingCaptureBorderOverlay';

describe('录制光标高亮层', () => {
  it('渲染精简的红色圆环，供 gdigrab 直接录入', () => {
    render(<CursorHighlightOverlay />);

    const highlight = screen.getByTestId('recording-cursor-highlight');
    expect(highlight).toHaveAttribute('aria-label', '录制光标高亮');
    expect(highlight.className).toContain('border-red-500');
    expect(highlight.className).toContain('rounded-full');
    expect(highlight.className).toContain('h-[22px]');
    expect(highlight.className).toContain('w-[22px]');
    expect(highlight.className).toContain('0_0_8px');
  });
});

describe('录制范围边框层', () => {
  it('渲染独立的无交互边框', () => {
    render(<RecordingCaptureBorderOverlay />);

    const border = screen.getByTestId('recording-capture-border');
    expect(border).toHaveClass('recording-capture-border');
    expect(border).toHaveAttribute('aria-hidden', 'true');
  });

  it('随窗口 DPI 变化保持 3 个物理像素并清理监听', () => {
    const ratio = vi.spyOn(window, 'devicePixelRatio', 'get');
    try {
      ratio.mockReturnValue(1.5);
      const { unmount } = render(<RecordingCaptureBorderOverlay />);
      const border = screen.getByTestId('recording-capture-border');
      expect(border.style.getPropertyValue('--recording-border-width')).toBe('2px');

      ratio.mockReturnValue(2);
      fireEvent(window, new Event('resize'));
      expect(border.style.getPropertyValue('--recording-border-width')).toBe('1.5px');

      unmount();
      ratio.mockReturnValue(1);
      fireEvent(window, new Event('resize'));
      expect(border.style.getPropertyValue('--recording-border-width')).toBe('1.5px');
    } finally {
      ratio.mockRestore();
    }
  });
});
