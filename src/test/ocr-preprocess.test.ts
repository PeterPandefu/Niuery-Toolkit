import { describe, expect, it } from 'vitest';
import { getOcrCanvasSize, enhanceOcrRaster } from '@/tools/graphic/image-studio/ocr-preprocess';

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
});
