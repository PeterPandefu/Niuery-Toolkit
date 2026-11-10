import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyQrValue, decodeQrFromBlob, QrDecodeError } from '@/lib/qr-decoder';

const { jsQrMock } = vi.hoisted(() => ({ jsQrMock: vi.fn() }));

vi.mock('jsqr', () => ({ default: jsQrMock }));

function installImageBitmap(width = 320, height = 200) {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(width * height * 4), width, height })),
    putImageData: vi.fn(),
    fillRect: vi.fn(),
    filter: 'none',
    fillStyle: '#fff',
  } as unknown as CanvasRenderingContext2D);
  return close;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  jsQrMock.mockReset();
});

describe('classifyQrValue', () => {
  it('classifies http and https payloads as URLs', () => {
    expect(classifyQrValue('https://example.test/path?q=1')).toEqual({
      kind: 'url',
      url: new URL('https://example.test/path?q=1'),
      hostname: 'example.test',
    });
    expect(classifyQrValue('http://example.test')).toMatchObject({ kind: 'url', hostname: 'example.test' });
  });

  it('keeps unsupported protocols and malformed values as text', () => {
    expect(classifyQrValue('javascript:alert(1)')).toEqual({ kind: 'text' });
    expect(classifyQrValue('not a URL')).toEqual({ kind: 'text' });
  });
});

describe('decodeQrFromBlob', () => {
  it('uses BarcodeDetector when available', async () => {
    const close = installImageBitmap();
    class Detector {
      constructor(_options: unknown) {}
      async detect() {
        return [{ rawValue: 'https://example.test' }];
      }
    }
    vi.stubGlobal('BarcodeDetector', Detector);

    const result = await decodeQrFromBlob(new Blob(['image'], { type: 'image/png' }));

    expect(result.rawValue).toBe('https://example.test');
    expect(result.engine).toBe('barcode-detector');
    expect(result.sourceWidth).toBe(320);
    expect(close).toHaveBeenCalledOnce();
  });

  it('falls back to jsqr when native detection is unavailable', async () => {
    installImageBitmap(128, 128);
    jsQrMock.mockReturnValue({ data: 'fallback text' });

    const result = await decodeQrFromBlob(new Blob(['image'], { type: 'image/png' }));

    expect(result.rawValue).toBe('fallback text');
    expect(result.engine).toBe('jsqr');
    expect(jsQrMock).toHaveBeenCalled();
  });

  it('reports invalid images with a typed error', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode failed'); }));

    await expect(decodeQrFromBlob(new Blob(['bad']))).rejects.toMatchObject({
      code: 'invalid-image',
    } satisfies Partial<QrDecodeError>);
  });

  it('honors cancellation before doing work', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(decodeQrFromBlob(new Blob(['image']), { signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    } satisfies Partial<QrDecodeError>);
  });
});
