import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoLongScreenshotPanel } from '@/tools/graphic/screenshot/AutoLongScreenshotPanel';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

describe('AutoLongScreenshotPanel', () => {
  afterEach(() => invokeMock.mockReset());

  it('offers the desktop windows returned by the native capture source command', async () => {
    invokeMock.mockResolvedValue([
      {
        sourceType: 'window',
        id: 42,
        title: '订单详情 - 示例浏览器',
        appName: 'Example Browser',
        processId: 123,
        width: 1280,
        height: 900,
      },
    ]);

    render(<AutoLongScreenshotPanel onComplete={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText('订单详情 - 示例浏览器')).toBeInTheDocument();
    expect(screen.getByText('Example Browser · 1280 × 900')).toBeInTheDocument();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('list_long_screenshot_sources'));
  });
});
