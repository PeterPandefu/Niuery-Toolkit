import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  applyImageWatermark,
  compressLossless,
  extractPages,
  getPdfPageCount,
  mergePdfs,
  parsePageRanges,
  splitBySegments,
  splitEveryPage,
} from '@/lib/pdf-utils';

/** 生成指定页数的空白 PDF */
async function makePdf(pageCount: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([200, 300]);
  const bytes = await doc.save();
  return bytes.slice().buffer;
}

/** 1x1 红色 PNG */
const PNG_1X1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

describe('parsePageRanges', () => {
  it('解析单页与区间', () => {
    expect(parsePageRanges('1-3,5', 10)).toEqual([1, 2, 3, 5]);
  });

  it('支持开区间 -3 与 4-', () => {
    expect(parsePageRanges('-3', 10)).toEqual([1, 2, 3]);
    expect(parsePageRanges('4-', 5)).toEqual([4, 5]);
  });

  it('去重并保持顺序', () => {
    expect(parsePageRanges('2,2-3,1', 5)).toEqual([2, 3, 1]);
  });

  it('支持中文逗号分隔', () => {
    expect(parsePageRanges('1，3', 5)).toEqual([1, 3]);
  });

  it('越界、颠倒、非法输入均抛错', () => {
    expect(() => parsePageRanges('0', 5)).toThrow();
    expect(() => parsePageRanges('6', 5)).toThrow();
    expect(() => parsePageRanges('3-1', 5)).toThrow();
    expect(() => parsePageRanges('abc', 5)).toThrow();
    expect(() => parsePageRanges('', 5)).toThrow();
    expect(() => parsePageRanges('1-3', 0)).toThrow();
  });
});

describe('PDF 合并 / 提取 / 拆分', () => {
  it('合并 2 页 + 3 页 → 5 页', async () => {
    const merged = await mergePdfs([await makePdf(2), await makePdf(3)]);
    expect(await getPdfPageCount(merged.slice().buffer)).toBe(5);
  });

  it('合并空列表抛错', async () => {
    await expect(mergePdfs([])).rejects.toThrow('没有可合并的页面');
  });

  it('extractPages 提取指定页', async () => {
    const src = await makePdf(4);
    const out = await extractPages(src, [4, 2]);
    expect(await getPdfPageCount(out.slice().buffer)).toBe(2);
  });

  it('splitBySegments 按逗号分段输出', async () => {
    const src = await makePdf(5);
    const outputs = await splitBySegments(src, '1-2,3-5', 5);
    expect(outputs).toHaveLength(2);
    expect(outputs[0].name).toBe('拆分-1-2.pdf');
    expect(await getPdfPageCount(outputs[0].bytes.slice().buffer)).toBe(2);
    expect(await getPdfPageCount(outputs[1].bytes.slice().buffer)).toBe(3);
  });

  it('splitEveryPage 每页独立成文件且命名正确', async () => {
    const src = await makePdf(3);
    const outputs = await splitEveryPage(src);
    expect(outputs.map((o) => o.name)).toEqual(['第1页.pdf', '第2页.pdf', '第3页.pdf']);
    for (const output of outputs) {
      expect(await getPdfPageCount(output.bytes.slice().buffer)).toBe(1);
    }
  });
});

describe('水印与压缩', () => {
  it('applyImageWatermark 保持页数', async () => {
    const src = await makePdf(2);
    const single = await applyImageWatermark(src, PNG_1X1, { rotation: 30, tiled: false, scale: 0.5 });
    expect(await getPdfPageCount(single.slice().buffer)).toBe(2);
    const tiled = await applyImageWatermark(src, PNG_1X1, { rotation: -45, tiled: true, scale: 0.2 });
    expect(await getPdfPageCount(tiled.slice().buffer)).toBe(2);
  });

  it('compressLossless 输出可再次加载且页数不变', async () => {
    const src = await makePdf(3);
    const compressed = await compressLossless(src);
    expect(await getPdfPageCount(compressed.slice().buffer)).toBe(3);
  });
});
