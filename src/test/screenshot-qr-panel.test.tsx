import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotQrPanel } from '@/components/qr/ScreenshotQrPanel';
import type { QrDecodeResult } from '@/lib/qr-decoder';

const result: QrDecodeResult = {
  rawValue: 'https://example.test/path?q=1',
  format: 'qr_code',
  engine: 'jsqr',
  sourceWidth: 256,
  sourceHeight: 256,
  durationMs: 12,
};

const source = new Blob(['image'], { type: 'image/png' });

function renderPanel(overrides: Partial<React.ComponentProps<typeof ScreenshotQrPanel>> = {}) {
  return render(
    <ScreenshotQrPanel
      source={source}
      result={result}
      busy={false}
      error={null}
      onRetry={vi.fn()}
      onCopy={vi.fn()}
      onOpenUrl={vi.fn()}
      onCancel={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScreenshotQrPanel', () => {
  it('shows a URL result and opens it only after confirmation', () => {
    const onOpenUrl = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPanel({ onOpenUrl });

    expect(screen.getByText('网页链接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '在浏览器打开' }));

    expect(onOpenUrl).toHaveBeenCalledWith(new URL(result.rawValue));
  });

  it('keeps the URL closed when confirmation is cancelled', () => {
    const onOpenUrl = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel({ onOpenUrl });

    fireEvent.click(screen.getByRole('button', { name: '在浏览器打开' }));

    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it('copies text results and exposes retry and close actions', () => {
    const onCopy = vi.fn();
    const onRetry = vi.fn();
    const onClose = vi.fn();
    renderPanel({
      result: { ...result, rawValue: '纯文本二维码' },
      onCopy,
      onRetry,
      onClose,
    });

    expect(screen.getByText('文本')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '在浏览器打开' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制结果' }));
    fireEvent.click(screen.getByRole('button', { name: '重新识别' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭二维码识别' }));

    expect(onCopy).toHaveBeenCalledOnce();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows cancellation while decoding and readable errors', () => {
    const onCancel = vi.fn();
    renderPanel({ result: null, busy: true, error: '未检测到二维码', onCancel });

    expect(screen.getByRole('status')).toHaveTextContent('正在识别二维码');
    expect(screen.getByText('未检测到二维码')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消识别' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
