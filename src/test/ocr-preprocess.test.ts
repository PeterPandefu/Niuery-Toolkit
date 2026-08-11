import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OCR_IMAGE_LOAD_TIMEOUT_MS,
  enhanceOcrRaster,
  getOcrCanvasSize,
  preprocessOcrImage,
} from '@/tools/graphic/image-studio/ocr-preprocess';

describe('OCR 图像预处理', () => {
  it('会将小图放大，并限制超大图片的最大边长', () => {
    expect(getOcrCanvasSize(640, 480)).toEqual({ width: 1280, height: 960 });
    expect(getOcrCanvasSize(5_000, 3_000)).toEqual({ width: 4096, height: 2458 });
  });

  it('会将彩色像素转换为增强后的灰度像素，同时保留透明度', () => {
    const output = enhanceOcrRaster({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([
        30, 80, 120, 255,
        230, 220, 210, 128,
      ]),
    });

    expect(Array.from(output.data)).toEqual([49, 49, 49, 255, 255, 255, 255, 128]);
  });

  it('图片解码未触发任何事件时会超时并释放对象 URL', async () => {
    class PendingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(_value: string) {
        // 模拟 WebView 图片解码永远不结算的异常路径。
      }
    }

    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('Image', PendingImage);
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:pending'), revokeObjectURL });

    const preprocessing = preprocessOcrImage(new Blob(['image'], { type: 'image/png' }));
    const rejection = expect(preprocessing).rejects.toThrow('图片加载超时');
    await vi.advanceTimersByTimeAsync(OCR_IMAGE_LOAD_TIMEOUT_MS);

    await rejection;
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:pending');
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
