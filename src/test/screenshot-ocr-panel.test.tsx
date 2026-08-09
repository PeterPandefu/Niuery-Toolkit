import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenshotOcrPanel } from '@/components/ocr/ScreenshotOcrPanel';
import * as ocrPreprocess from '@/tools/graphic/image-studio/ocr-preprocess';

const { recognize, setParameters, terminate, createWorker } = vi.hoisted(() => ({
  recognize: vi.fn(),
  setParameters: vi.fn(),
  terminate: vi.fn(),
  createWorker: vi.fn(),
}));

vi.mock('@/tools/graphic/image-studio/ocr-engine', () => ({
  createOcrWorker: createWorker,
  OcrInitializationTimeoutError: class OcrInitializationTimeoutError extends Error {},
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('ScreenshotOcrPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ocrPreprocess, 'preprocessOcrImage').mockResolvedValue({} as HTMLCanvasElement);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:screenshot'), revokeObjectURL: vi.fn() });
    recognize.mockResolvedValue({ data: { text: '截图识别文本', confidence: 96 } });
    setParameters.mockResolvedValue(undefined);
    terminate.mockResolvedValue(undefined);
    createWorker.mockResolvedValue({ recognize, setParameters, terminate });
  });

  it('自动识别截图并把结果交给翻译入口', async () => {
    const onTextChange = vi.fn();
    const onTranslate = vi.fn();

    render(
      <ScreenshotOcrPanel
        source={new Blob(['image'], { type: 'image/png' })}
        text=""
        autoRecognize
        autoTranslate
        onTextChange={onTextChange}
        onTranslate={onTranslate}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => expect(onTextChange).toHaveBeenCalledWith('截图识别文本'));
    expect(onTranslate).toHaveBeenCalledWith('截图识别文本');
    expect(createWorker).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });
});
