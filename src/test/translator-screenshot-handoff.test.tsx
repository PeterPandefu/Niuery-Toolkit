import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TranslatorTool from '@/tools/translate';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { useTranslateStore } from '@/store/translate-store';

const { resolveFetch, translateWithBaidu } = vi.hoisted(() => ({
  resolveFetch: vi.fn(),
  translateWithBaidu: vi.fn(),
}));

vi.mock('@/lib/translate-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/translate-utils')>('@/lib/translate-utils');
  return { ...actual, resolveFetch, translateWithBaidu };
});

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

describe('截图翻译交接', () => {
  beforeEach(() => {
    useTranslateStore.setState({ baiduAppId: 'app-id', baiduSecret: 'secret' });
    useScreenshotOcrStore.setState({
      screenshotSession: { id: 1, imageDataUrl: 'data:image/png;base64,test', text: '截图原文' },
      pendingTranslation: { id: 2, text: '截图原文' },
    });
    resolveFetch.mockResolvedValue(vi.fn());
    translateWithBaidu.mockResolvedValue({ text: 'translated text' });
  });

  afterEach(() => {
    useScreenshotOcrStore.setState({ screenshotSession: null, pendingTranslation: null });
  });

  it('一次性接收 OCR 文本并自动翻译', async () => {
    render(<TranslatorTool />);

    await waitFor(() => expect(translateWithBaidu).toHaveBeenCalled());
    expect(translateWithBaidu).toHaveBeenCalledWith(
      '截图原文',
      'auto',
      'en',
      { appId: 'app-id', secret: 'secret' },
      expect.any(Function)
    );
    expect(screen.getByRole('textbox')).toHaveValue('截图原文');
    expect(await screen.findByText('translated text')).toBeInTheDocument();
    expect(useScreenshotOcrStore.getState().pendingTranslation).toBeNull();
    expect(screen.getByRole('button', { name: '返回截图' })).toBeInTheDocument();
  });
});
