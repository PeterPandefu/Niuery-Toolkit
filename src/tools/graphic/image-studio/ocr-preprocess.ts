export const OCR_SCALE_FACTOR = 2;
export const OCR_MAX_IMAGE_DIMENSION = 4096;
export const OCR_IMAGE_LOAD_TIMEOUT_MS = 15_000;
export const OCR_RECOGNITION_PARAMETERS = {
  tessedit_pageseg_mode: '3' as Tesseract.PSM,
  preserve_interword_spaces: '1',
  user_defined_dpi: '300',
} as const;

const OCR_CONTRAST_FACTOR = 1.35;

export interface OcrRaster {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function getOcrCanvasSize(width: number, height: number) {
  const scale = Math.min(
    OCR_SCALE_FACTOR,
    OCR_MAX_IMAGE_DIMENSION / Math.max(width, height)
  );

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function enhanceOcrRaster(raster: OcrRaster): OcrRaster {
  const data = new Uint8ClampedArray(raster.data);

  for (let index = 0; index < data.length; index += 4) {
    const luminance = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    const enhanced = clampChannel((luminance - 128) * OCR_CONTRAST_FACTOR + 128);
    data[index] = enhanced;
    data[index + 1] = enhanced;
    data[index + 2] = enhanced;
  }

  return { ...raster, data };
}

function loadOcrImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    image.onload = () => {
      succeed();
    };
    image.onerror = () => {
      fail(new Error('图片解码失败'));
    };
    const timer = window.setTimeout(() => fail(new Error('图片加载超时')), OCR_IMAGE_LOAD_TIMEOUT_MS);
    image.src = url;
  });
}

export async function preprocessOcrImage(file: Blob): Promise<HTMLCanvasElement> {
  const image = await loadOcrImage(file);
  const size = getOcrCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建 OCR 图像处理画布');

  context.drawImage(image, 0, 0, size.width, size.height);
  const imageData = context.getImageData(0, 0, size.width, size.height);
  const enhanced = enhanceOcrRaster({
    width: size.width,
    height: size.height,
    data: imageData.data,
  });
  context.putImageData(new ImageData(enhanced.data, enhanced.width, enhanced.height), 0, 0);

  return canvas;
}
