import { describe, expect, it, vi } from 'vitest';
import { decodeQrFile } from '@/lib/qr-decoder';

vi.mock('@/lib/qr-decoder', () => ({
  decodeQrFile: vi.fn(async () => ({
    rawValue: 'https://example.test',
    format: 'qr_code',
    engine: 'jsqr',
    sourceWidth: 256,
    sourceHeight: 256,
    durationMs: 4,
  })),
  decodeQrFromBlob: vi.fn(async () => ({
    rawValue: 'https://example.test',
    format: 'qr_code',
    engine: 'jsqr',
    sourceWidth: 256,
    sourceHeight: 256,
    durationMs: 4,
  })),
}));

describe('QR tool file decoding', () => {
  it('routes an uploaded image through the shared decoder', async () => {
    const result = await decodeQrFile(new File(['png'], 'qr.png', { type: 'image/png' }));
    expect(result.rawValue).toBe('https://example.test');
  });
});
