import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

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

    expect(createWorker).not.toHaveBeenCalled();
    fireEvent.load(screen.getByRole('img', { name: '待识别截图预览' }));

    await waitFor(() => expect(onTextChange).toHaveBeenCalledWith('截图识别文本'));
    expect(onTranslate).toHaveBeenCalledWith('截图识别文本');
    expect(createWorker).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('在预览加载前替换图片时只自动识别最新来源', async () => {
    const firstSource = new Blob(['first'], { type: 'image/png' });
    const secondSource = new Blob(['second'], { type: 'image/png' });
    const processedSources: Blob[] = [];
    vi.spyOn(ocrPreprocess, 'preprocessOcrImage').mockImplementation(async (source) => {
      processedSources.push(source);
      return {} as HTMLCanvasElement;
    });
    const { rerender } = render(
      <ScreenshotOcrPanel
        source={firstSource}
        text=""
        autoRecognize
        autoTranslate
        onTextChange={vi.fn()}
        onTranslate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    rerender(
      <ScreenshotOcrPanel
        source={secondSource}
        text=""
        autoRecognize
        autoTranslate
        onTextChange={vi.fn()}
        onTranslate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    fireEvent.load(screen.getByRole('img', { name: '待识别截图预览' }));

    await waitFor(() => expect(processedSources).toHaveLength(1));
    expect(processedSources[0]).toBe(secondSource);
    expect(processedSources[0]).not.toBe(firstSource);
  });

  it('手动识别不依赖预览加载，取消会终止已创建的 Worker', async () => {
    const pendingRecognition = deferred<{ data: { text: string; confidence: number } }>();
    const onTextChange = vi.fn();
    const onTranslate = vi.fn();
    recognize.mockReturnValueOnce(pendingRecognition.promise);
    const source = new Blob(['image'], { type: 'image/png' });

    render(
      <ScreenshotOcrPanel
        source={source}
        text=""
        onTextChange={onTextChange}
        onTranslate={onTranslate}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '识别整图' }));
    await waitFor(() => expect(ocrPreprocess.preprocessOcrImage).toHaveBeenCalledWith(source));
    fireEvent.click(screen.getByRole('button', { name: '取消识别' }));

    await waitFor(() => expect(terminate).toHaveBeenCalledOnce());
    await act(async () => {
      pendingRecognition.resolve({ data: { text: '取消后的结果', confidence: 96 } });
      await Promise.resolve();
    });
    expect(onTextChange).not.toHaveBeenCalled();
    expect(onTranslate).not.toHaveBeenCalled();
  });

  it('识别运行中替换图片会丢弃旧结果，并只自动识别新来源一次', async () => {
    const firstRecognition = deferred<{ data: { text: string; confidence: number } }>();
    const firstSource = new Blob(['first'], { type: 'image/png' });
    const secondSource = new Blob(['second'], { type: 'image/png' });
    const onTextChange = vi.fn();
    const onTranslate = vi.fn();
    recognize
      .mockReturnValueOnce(firstRecognition.promise)
      .mockResolvedValueOnce({ data: { text: '第二张图片', confidence: 96 } });

    const { rerender } = render(
      <ScreenshotOcrPanel
        source={firstSource}
        text=""
        autoRecognize
        autoTranslate
        onTextChange={onTextChange}
        onTranslate={onTranslate}
        onClose={vi.fn()}
      />
    );

    fireEvent.load(screen.getByRole('img', { name: '待识别截图预览' }));
    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(1));

    rerender(
      <ScreenshotOcrPanel
        source={secondSource}
        text=""
        autoRecognize
        autoTranslate
        onTextChange={onTextChange}
        onTranslate={onTranslate}
        onClose={vi.fn()}
      />
    );
    fireEvent.load(screen.getByRole('img', { name: '待识别截图预览' }));

    await waitFor(() => expect(recognize).toHaveBeenCalledTimes(2));
    await act(async () => {
      firstRecognition.resolve({ data: { text: '第一张图片', confidence: 96 } });
      await Promise.resolve();
    });

    await waitFor(() => expect(onTextChange).toHaveBeenCalledWith('第二张图片'));
    expect(onTextChange).toHaveBeenCalledTimes(1);
    expect(onTranslate).toHaveBeenCalledWith('第二张图片');
    expect(onTranslate).toHaveBeenCalledTimes(1);
  });
});
