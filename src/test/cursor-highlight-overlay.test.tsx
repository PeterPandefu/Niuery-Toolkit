import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
