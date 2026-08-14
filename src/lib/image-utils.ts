import { PDFDocument } from 'pdf-lib';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type MergeDirection = 'horizontal' | 'vertical' | 'grid';

/** 计算缩放尺寸：单边指定时按该边等比缩放；双边指定且锁定比例时按 contain 缩放 */
export function calcResizeSize(
  orig: Size,
  target: { width?: number; height?: number },
  keepRatio: boolean
): Size {
  const w = target.width && target.width > 0 ? target.width : orig.width;
  const h = target.height && target.height > 0 ? target.height : orig.height;

  if (!keepRatio) {
    return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
  }
  if (w && (!target.height || target.height <= 0)) {
    const s = w / orig.width;
    return { width: Math.max(1, Math.round(orig.width * s)), height: Math.max(1, Math.round(orig.height * s)) };
  }
  if (h && (!target.width || target.width <= 0)) {
    const s = h / orig.height;
    return { width: Math.max(1, Math.round(orig.width * s)), height: Math.max(1, Math.round(orig.height * s)) };
  }
  const s = Math.min(w / orig.width, h / orig.height);
  return { width: Math.max(1, Math.round(orig.width * s)), height: Math.max(1, Math.round(orig.height * s)) };
}

/** 计算多图合并布局：横向 / 纵向 / 网格 */
export function calcMergeLayout(
  sizes: Size[],
  opts: { direction: MergeDirection; gap: number; cols?: number }
): { canvas: Size; positions: Point[] } {
  if (sizes.length === 0) return { canvas: { width: 0, height: 0 }, positions: [] };
  const gap = Math.max(0, opts.gap);

  if (opts.direction === 'horizontal') {
    const positions: Point[] = [];
    let x = 0;
    for (const s of sizes) {
      positions.push({ x, y: 0 });
      x += s.width + gap;
    }
    return {
      canvas: {
        width: sizes.reduce((sum, s) => sum + s.width, 0) + gap * (sizes.length - 1),
        height: Math.max(...sizes.map((s) => s.height)),
      },
      positions,
    };
  }

  if (opts.direction === 'vertical') {
    const positions: Point[] = [];
    let y = 0;
    for (const s of sizes) {
      positions.push({ x: 0, y });
      y += s.height + gap;
    }
    return {
      canvas: {
        width: Math.max(...sizes.map((s) => s.width)),
        height: sizes.reduce((sum, s) => sum + s.height, 0) + gap * (sizes.length - 1),
      },
      positions,
    };
  }

  const cols = Math.max(1, Math.min(opts.cols ?? Math.ceil(Math.sqrt(sizes.length)), sizes.length));
  const rows = Math.ceil(sizes.length / cols);
  const colWidths = new Array<number>(cols).fill(0);
  const rowHeights = new Array<number>(rows).fill(0);
  sizes.forEach((s, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    colWidths[c] = Math.max(colWidths[c], s.width);
    rowHeights[r] = Math.max(rowHeights[r], s.height);
  });

  const positions: Point[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    let x = 0;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i < sizes.length) positions.push({ x, y });
      x += colWidths[c] + gap;
    }
    y += rowHeights[r] + gap;
  }

  return {
    canvas: {
      width: colWidths.reduce((sum, v) => sum + v, 0) + gap * (cols - 1),
      height: rowHeights.reduce((sum, v) => sum + v, 0) + gap * (rows - 1),
    },
    positions,
  };
}

/** 按比例居中裁剪框 */
export function calcRatioCrop(orig: Size, ratioW: number, ratioH: number): { x: number; y: number; width: number; height: number } {
  const ratio = ratioW / ratioH;
  let w = orig.width;
  let h = w / ratio;
  if (h > orig.height) {
    h = orig.height;
    w = h * ratio;
  }
  w = Math.max(1, Math.floor(w));
  h = Math.max(1, Math.floor(h));
  return {
    x: Math.floor((orig.width - w) / 2),
    y: Math.floor((orig.height - h) / 2),
    width: w,
    height: h,
  };
}

/** 自定义尺寸居中裁剪框（超出原图时收缩） */
export function calcCenterCrop(orig: Size, target: Size): { x: number; y: number; width: number; height: number } {
  const w = Math.max(1, Math.min(Math.round(target.width), orig.width));
  const h = Math.max(1, Math.min(Math.round(target.height), orig.height));
  return {
    x: Math.floor((orig.width - w) / 2),
    y: Math.floor((orig.height - h) / 2),
    width: w,
    height: h,
  };
}

/* ==================== 浏览器画布辅助 ==================== */

export function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败，文件可能已损坏'));
    img.src = url;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('画布导出失败'))), type, quality);
  });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** 加载文件为画布 + 图像元素 */
export async function fileToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: HTMLImageElement }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return { canvas, ctx, img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 多张图片合成 GIF（统一缩放到首帧尺寸） */
export async function encodeImagesToGif(files: File[], delayMs: number): Promise<Blob> {
  if (files.length === 0) throw new Error('请先选择图片');
  const frames: Uint8Array[] = [];
  let width = 0;
  let height = 0;

  for (const file of files) {
    const { canvas, ctx, img } = await fileToCanvas(file);
    if (frames.length === 0) {
      width = canvas.width;
      height = canvas.height;
      ctx.drawImage(img, 0, 0);
    } else {
      // 后续帧等比 contain 到首帧尺寸，空白补白
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      const s = Math.min(width / img.naturalWidth, height / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
    }
    frames.push(new Uint8Array(ctx.getImageData(0, 0, width, height).data));
  }

  const encoder = GIFEncoder();
  for (const rgba of frames) {
    const palette = quantize(rgba, 256, { format: 'rgba4444' });
    const index = applyPalette(rgba, palette);
    encoder.writeFrame(index, width, height, { palette, delay: delayMs, repeat: 0 });
  }
  encoder.finish();
  return new Blob([encoder.bytes()], { type: 'image/gif' });
}

/** 多张图片合成 PDF（每图一页，页面尺寸=图片像素尺寸） */
export async function encodeImagesToPdf(files: File[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error('请先选择图片');
  const doc = await PDFDocument.create();

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isJpg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
    const embedded = isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }

  return doc.save();
}
