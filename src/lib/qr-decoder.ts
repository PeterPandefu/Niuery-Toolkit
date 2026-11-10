import jsQR from 'jsqr';

export interface QrDecodeResult {
  rawValue: string;
  format: 'qr_code';
  engine: 'barcode-detector' | 'jsqr';
  sourceWidth: number;
  sourceHeight: number;
  durationMs: number;
}

export type QrDecodeFailureCode = 'aborted' | 'invalid-image' | 'not-found' | 'unsupported';

export class QrDecodeError extends Error {
  readonly code: QrDecodeFailureCode;

  constructor(code: QrDecodeFailureCode, message: string) {
    super(message);
    this.name = 'QrDecodeError';
    this.code = code;
  }
}

interface DetectorResult {
  rawValue?: string;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): { detect(source: unknown): Promise<DetectorResult[]> };
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new QrDecodeError('aborted', '二维码识别已取消');
}

async function loadImage(source: Blob): Promise<LoadedImage> {
  try {
    if (typeof globalThis.createImageBitmap === 'function') {
      const bitmap = await globalThis.createImageBitmap(source);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    }

    const url = URL.createObjectURL(source);
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('图片解码失败'));
      element.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    throw new QrDecodeError('invalid-image', '图片解码失败');
  }
}

function createImageData(image: LoadedImage, scale = 1, enhance = false): ImageData {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new QrDecodeError('invalid-image', '无法创建图片处理画布');
  context.filter = enhance ? 'grayscale(1) contrast(1.35)' : 'none';
  context.drawImage(image.source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

function detectorConstructor(): BarcodeDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
}

function nativeRawValue(results: DetectorResult[]) {
  return results.find((result) => typeof result.rawValue === 'string' && result.rawValue.length > 0)?.rawValue;
}

export async function decodeQrFromBlob(
  source: Blob,
  options: { signal?: AbortSignal } = {},
): Promise<QrDecodeResult> {
  const startedAt = performance.now();
  throwIfAborted(options.signal);
  const image = await loadImage(source);

  try {
    const Detector = detectorConstructor();
    if (Detector) {
      try {
        throwIfAborted(options.signal);
        const detector = new Detector({ formats: ['qr_code'] });
        const nativeResult = nativeRawValue(await detector.detect(image.source));
        if (nativeResult) {
          return {
            rawValue: nativeResult,
            format: 'qr_code',
            engine: 'barcode-detector',
            sourceWidth: image.width,
            sourceHeight: image.height,
            durationMs: Math.round(performance.now() - startedAt),
          };
        }
      } catch (error) {
        if (error instanceof QrDecodeError) throw error;
      }
    }

    const variants = [
      createImageData(image),
      createImageData(image, 2),
      createImageData(image, 1, true),
    ];
    for (const imageData of variants) {
      throwIfAborted(options.signal);
      const fallbackResult = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' });
      if (fallbackResult?.data) {
        return {
          rawValue: fallbackResult.data,
          format: 'qr_code',
          engine: 'jsqr',
          sourceWidth: image.width,
          sourceHeight: image.height,
          durationMs: Math.round(performance.now() - startedAt),
        };
      }
    }

    throw new QrDecodeError('not-found', '未检测到二维码');
  } finally {
    image.close();
  }
}

export async function decodeQrFile(file: Blob, signal?: AbortSignal): Promise<QrDecodeResult> {
  return decodeQrFromBlob(file, { signal });
}

export function classifyQrValue(rawValue: string):
  | { kind: 'url'; url: URL; hostname: string }
  | { kind: 'text' } {
  try {
    const url = new URL(rawValue.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return { kind: 'url', url, hostname: url.hostname };
    }
  } catch {
    // QR payloads are commonly plain text; an invalid URL is a valid text result.
  }
  return { kind: 'text' };
}
