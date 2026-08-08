import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CursorHighlightOverlay from '@/recording/CursorHighlightOverlay';

describe('录制光标高亮层', () => {
  it('渲染显著的红色圆环，供 gdigrab 直接录入', () => {
    render(<CursorHighlightOverlay />);

    const highlight = screen.getByTestId('recording-cursor-highlight');
    expect(highlight).toHaveAttribute('aria-label', '录制光标高亮');
    expect(highlight.className).toContain('border-red-500');
    expect(highlight.className).toContain('rounded-full');
  });
});
