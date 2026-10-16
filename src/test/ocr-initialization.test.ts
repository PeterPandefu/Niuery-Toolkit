import { afterEach, expect, it, vi } from 'vitest';
const assets = vi.hoisted(() => vi.fn());
vi.mock('@/lib/resources', () => ({ ocrAssetUrls: assets, isResourceDesktop: () => true }));
vi.mock('tesseract.js', () => ({ createWorker: vi.fn(), OEM: { LSTM_ONLY: 1 }, PSM: { AUTO: '3' } }));

afterEach(() => vi.useRealTimers());

it('bounds initialization even when the desktop resource resolver never responds', async () => {
  vi.useFakeTimers();
  assets.mockReturnValue(new Promise(() => undefined));
  const { createOcrWorker } = await import('@/tools/graphic/image-studio/ocr-engine');
  let outcome: unknown;
  void createOcrWorker('eng', () => undefined, 50).catch(error => { outcome = error; });
  await vi.advanceTimersByTimeAsync(51);
  expect(outcome).toBeInstanceOf(Error);
  expect((outcome as Error).name).toBe('OcrInitializationTimeoutError');
});
