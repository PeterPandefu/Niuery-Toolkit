import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrPanel } from '@/tools/graphic/image-studio/ocr-panel';
import { OCR_INITIALIZATION_TIMEOUT_MS } from '@/tools/graphic/image-studio/ocr-engine';
import * as ocrPreprocess from '@/tools/graphic/image-studio/ocr-preprocess';

const { recognize, setParameters, terminate, createWorker } = vi.hoisted(() => ({
  recognize: vi.fn(),
  setParameters: vi.fn(),
  terminate: vi.fn(),
  createWorker: vi.fn(),
}));
const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  PSM: { SPARSE_TEXT: '11' },
  createWorker,
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}));

function selectImage(container: HTMLElement) {
  const file = new File(['image'], 'example.png', { type: 'image/png' });
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return file;
}

function startRecognition() {
  fireEvent.click(screen.getByRole('button', { name: '开始识别' }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe('OcrPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(ocrPreprocess, 'preprocessOcrImage').mockResolvedValue({} as HTMLCanvasElement);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('选择图片后显示预览，并在移除图片时释放对象 URL', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:ocr-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const { container } = render(<OcrPanel />);
    const file = selectImage(container);

    const preview = await screen.findByRole('img', { name: '已选图片预览' });
    expect(preview).toHaveAttribute('src', 'blob:ocr-preview');
    expect(createObjectURL).toHaveBeenCalledWith(file);

    fireEvent.click(screen.getByTitle('移除'));

    await waitFor(() => expect(screen.queryByRole('img', { name: '已选图片预览' })).not.toBeInTheDocument());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ocr-preview');
  });

  it('使用本地 OCR 资源识别已选择的图片，并展示可编辑结果', async () => {
    recognize.mockResolvedValue({ data: { text: ['识别出的文字', ''].join('\n'), confidence: 95 } });
    setParameters.mockResolvedValue(undefined);
    terminate.mockResolvedValue(undefined);
    createWorker.mockResolvedValue({ recognize, setParameters, terminate });

    const { container } = render(<OcrPanel />);
    const file = selectImage(container);
    startRecognition();

    await waitFor(() => expect(screen.getByLabelText('识别结果')).toHaveValue('识别出的文字'));
    expect(createWorker).toHaveBeenCalledWith(
      'chi_sim+eng',
      1,
      expect.objectContaining({
        workerPath: expect.stringContaining('ocr/worker.min.js'),
        workerBlobURL: false,
        corePath: expect.stringContaining('ocr/core/tesseract-core-lstm.wasm.js'),
        langPath: expect.stringContaining('ocr/lang'),
      })
    );
    expect(setParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: '11',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    expect(ocrPreprocess.preprocessOcrImage).toHaveBeenCalledWith(file);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('在 StrictMode 的 effect 重放后仍能识别并展示结果', async () => {
    recognize.mockResolvedValue({ data: { text: 'StrictMode 识别结果', confidence: 95 } });
    setParameters.mockResolvedValue(undefined);
    terminate.mockResolvedValue(undefined);
    createWorker.mockResolvedValue({ recognize, setParameters, terminate });

    const { container } = render(
      <StrictMode>
        <OcrPanel />
      </StrictMode>
    );
    selectImage(container);
    startRecognition();

    await waitFor(() => expect(screen.getByLabelText('识别结果')).toHaveValue('StrictMode 识别结果'));
    expect(recognize).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('初始化超时时恢复按钮并提示本地资源错误', async () => {
    vi.useFakeTimers();
    createWorker.mockReturnValue(new Promise(() => undefined));
    const { container } = render(<OcrPanel />);
    selectImage(container);
    startRecognition();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OCR_INITIALIZATION_TIMEOUT_MS);
    });

    expect(toastError).toHaveBeenCalledWith('OCR 引擎初始化失败，请检查本地 OCR 资源');
    expect(screen.getByRole('button', { name: '开始识别' })).toBeEnabled();
  });

  it('超时后迟到的 Worker 会被终止且不会执行识别', async () => {
    vi.useFakeTimers();
    const lateWorker = deferred<Tesseract.Worker>();
    createWorker.mockReturnValue(lateWorker.promise);
    const { container } = render(<OcrPanel />);
    selectImage(container);
    startRecognition();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OCR_INITIALIZATION_TIMEOUT_MS);
    });
    await act(async () => {
      lateWorker.resolve({ recognize, terminate } as unknown as Tesseract.Worker);
      await Promise.resolve();
    });

    expect(terminate).toHaveBeenCalledOnce();
    expect(recognize).not.toHaveBeenCalled();
  });
});
