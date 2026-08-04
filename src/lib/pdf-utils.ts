import { PDFDocument, degrees } from 'pdf-lib';

/** 带名称的 PDF 输出 */
export interface NamedPdf {
  name: string;
  bytes: Uint8Array;
}

/**
 * 解析页范围表达式，如 "1-3,5,8-" → [1,2,3,5,8,...]
 * 支持：单页 `5`、区间 `1-3`、开区间 `8-` / `-3`；多段用逗号分隔；结果去重保序
 */
export function parsePageRanges(input: string, maxPage: number): number[] {
  const text = input.trim();
  if (!text) throw new Error('请输入页范围');
  if (maxPage < 1) throw new Error('PDF 没有可用页面');

  const result: number[] = [];
  for (const raw of text.split(/[,，]/)) {
    const seg = raw.trim();
    if (!seg) continue;

    const rangeMatch = seg.match(/^(\d+)?\s*-\s*(\d+)?$/);
    if (rangeMatch) {
      const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 1;
      const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : maxPage;
      if (start < 1 || end > maxPage) throw new Error(`页范围超出范围（1-${maxPage}）：${seg}`);
      if (start > end) throw new Error(`页范围起止颠倒：${seg}`);
      for (let i = start; i <= end; i++) result.push(i);
      continue;
    }

    if (/^\d+$/.test(seg)) {
      const n = parseInt(seg, 10);
      if (n < 1 || n > maxPage) throw new Error(`页码超出范围（1-${maxPage}）：${n}`);
      result.push(n);
      continue;
    }

    throw new Error(`无法解析页表达式：${seg}`);
  }

  if (result.length === 0) throw new Error('请输入页范围');
  return [...new Set(result)];
}

/** 读取 PDF 页数 */
export async function getPdfPageCount(buffer: ArrayBuffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.getPageCount();
}

/** 合并多个 PDF */
export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const buffer of buffers) {
    const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  if (out.getPageCount() === 0) throw new Error('没有可合并的页面');
  return out.save();
}

/** 提取指定页（1-based）组成新 PDF */
export async function extractPages(buffer: ArrayBuffer, pageNumbers: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, pageNumbers.map((n) => n - 1));
  copied.forEach((page) => out.addPage(page));
  return out.save();
}

/** 按逗号分段拆分，每段输出一个 PDF */
export async function splitBySegments(buffer: ArrayBuffer, segments: string, maxPage: number): Promise<NamedPdf[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const parts = segments
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('请输入页范围');

  const outputs: NamedPdf[] = [];
  for (const part of parts) {
    const pages = parsePageRanges(part, maxPage);
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, pages.map((n) => n - 1));
    copied.forEach((page) => doc.addPage(page));
    outputs.push({ name: `拆分-${part}.pdf`, bytes: await doc.save() });
  }
  return outputs;
}

/** 每页拆分为独立 PDF */
export async function splitEveryPage(buffer: ArrayBuffer): Promise<NamedPdf[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const total = src.getPageCount();
  const outputs: NamedPdf[] = [];
  for (let i = 0; i < total; i++) {
    const doc = await PDFDocument.create();
    const [page] = await doc.copyPages(src, [i]);
    doc.addPage(page);
    outputs.push({ name: `第${i + 1}页.pdf`, bytes: await doc.save() });
  }
  return outputs;
}

export interface ImageWatermarkOptions {
  /** 旋转角度（度） */
  rotation: number;
  /** 是否平铺整页 */
  tiled: boolean;
  /** 水印宽度相对页面宽度的比例 */
  scale: number;
}

/** 将 PNG 水印图（透明度已烘焙进图片）应用到每一页 */
export async function applyImageWatermark(
  buffer: ArrayBuffer,
  pngBytes: Uint8Array,
  opts: ImageWatermarkOptions
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const img = await doc.embedPng(pngBytes);
  const ratio = img.height / Math.max(img.width, 1);

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const drawW = width * opts.scale;
    const drawH = drawW * ratio;

    if (opts.tiled) {
      const stepX = drawW * 1.6;
      const stepY = drawH * 2.4;
      for (let y = -drawH; y < height + drawH; y += stepY) {
        for (let x = -drawW / 2; x < width + drawW; x += stepX) {
          page.drawImage(img, {
            x,
            y,
            width: drawW,
            height: drawH,
            rotate: degrees(opts.rotation),
          });
        }
      }
    } else {
      page.drawImage(img, {
        x: (width - drawW) / 2,
        y: (height - drawH) / 2,
        width: drawW,
        height: drawH,
        rotate: degrees(opts.rotation),
      });
    }
  }

  return doc.save();
}

/** 无损压缩：重写对象流，保留文本层 */
export async function compressLossless(buffer: ArrayBuffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  return doc.save({ useObjectStreams: true });
}
