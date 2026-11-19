import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlPreviewFrame } from '@/components/shared/HtmlPreviewFrame';
import { HTML_PREVIEW_METRICS } from '@/lib/html-preview';

const PANE = { width: 668, height: 673 };

class PaneResizeObserver {
  static callback: ResizeObserverCallback | null = null;
  constructor(callback: ResizeObserverCallback) { PaneResizeObserver.callback = callback; }
  observe() {
    PaneResizeObserver.callback?.([{ contentRect: PANE }] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

function reportWidth(width: number, source: Window | null) {
  window.dispatchEvent(new MessageEvent('message', { data: { type: HTML_PREVIEW_METRICS, width }, source }));
}

describe('HTML 预览面板', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', PaneResizeObserver); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('按上报的内容宽度缩放 iframe，使宽内容完整可见', async () => {
    render(<HtmlPreviewFrame html="<p>wide</p>" title="HTML 本地预览" />);
    const frame = screen.getByTitle('HTML 本地预览') as HTMLIFrameElement;
    await act(async () => { reportWidth(1920, frame.contentWindow); });
    expect(frame.style.width).toBe('1920px');
    expect(Number(frame.style.transform.replace(/[^\d.]/g, ''))).toBeCloseTo(PANE.width / 1920, 6);
    expect(screen.getByText('预览缩放 35%')).toBeInTheDocument();
  });

  it('切换到原始尺寸后取消缩放', async () => {
    render(<HtmlPreviewFrame html="<p>wide</p>" title="HTML 本地预览" />);
    const frame = screen.getByTitle('HTML 本地预览') as HTMLIFrameElement;
    await act(async () => { reportWidth(1920, frame.contentWindow); });
    await act(async () => { screen.getByRole('button', { name: '预览原始尺寸' }).click(); });
    expect(frame.style.transform).toBe('scale(1)');
    expect(frame.style.width).toBe('1920px');
    expect(screen.getByText('预览缩放 100%')).toBeInTheDocument();
  });

  it('忽略来自其他窗口的测量消息', async () => {
    render(<HtmlPreviewFrame html="<p>wide</p>" title="HTML 本地预览" />);
    await act(async () => { reportWidth(1920, window); });
    expect(screen.getByText('预览缩放 100%')).toBeInTheDocument();
  });
});