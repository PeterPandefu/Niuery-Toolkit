import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('OCR 静态资源', () => {
  it('包含有效的 Tesseract WASM 核心文件', async () => {
    const bytes = await readFile('public/ocr/core/tesseract-core-lstm.wasm');

    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  });
});
