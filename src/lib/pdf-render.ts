import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface PageImage {
  name: string;
  blob: Blob;
}

export type ProgressFn = (done: number, total: number) => void;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('画布导出失败'))), type, quality);
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadPdf(buffer: ArrayBuffer) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
  const doc = await task.promise;
  return { doc, task };
}

/** 将每页渲染为图片（PNG/JPEG） */
export async function renderPdfPages(
  buffer: ArrayBuffer,
  opts: { format: 'png' | 'jpeg'; dpi: number; quality: number },
  onProgress?: ProgressFn
): Promise<PageImage[]> {
  const { doc, task } = await loadPdf(buffer);
  const scale = opts.dpi / 72;
  const results: PageImage[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      if (opts.format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await page.render({ canvas, viewport }).promise;
      const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await canvasToBlob(canvas, type, opts.quality);
      results.push({ name: `第${i}页.${opts.format === 'png' ? 'png' : 'jpg'}`, blob });
      onProgress?.(i, doc.numPages);
    }
  } finally {
    await task.destroy();
  }
  return results;
}

interface PdfImageObject {
  width: number;
  height: number;
  kind: number;
  data?: Uint8ClampedArray | Uint8Array;
  bitmap?: ImageBitmap;
}

/** pdfjs ImageKind：1=GRAYSCALE_1BPP, 2=RGB_24BPP, 3=RGBA_32BPP */
async function imageObjectToBlob(img: PdfImageObject): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;

  if (img.bitmap) {
    ctx.drawImage(img.bitmap, 0, 0);
    return canvasToBlob(canvas, 'image/png');
  }
  if (!img.data || img.width < 1 || img.height < 1) return null;

  const imageData = ctx.createImageData(img.width, img.height);
  if (img.kind === 3) {
    if (img.data.length !== img.width * img.height * 4) return null;
    imageData.data.set(img.data);
  } else if (img.kind === 2) {
    if (img.data.length !== img.width * img.height * 3) return null;
    const src = img.data;
    const dst = imageData.data;
    for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
      dst[j] = src[i];
      dst[j + 1] = src[i + 1];
      dst[j + 2] = src[i + 2];
      dst[j + 3] = 255;
    }
  } else {
    return null; // 1bpp 位图暂不支持
  }

  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, 'image/png');
}

/** 提取 PDF 内嵌图片 */
export async function extractEmbeddedImages(buffer: ArrayBuffer, onProgress?: ProgressFn): Promise<PageImage[]> {
  const { doc, task } = await loadPdf(buffer);
  const results: PageImage[] = [];

  try {
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const ops = await page.getOperatorList();
      let index = 0;

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        let img: PdfImageObject | null = null;

        if (fn === pdfjsLib.OPS.paintImageXObject) {
          const name = ops.argsArray[i][0] as string;
          img = await new Promise<PdfImageObject>((resolve) => {
            page.objs.get(name, resolve as (value: unknown) => void);
          });
        } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
          img = ops.argsArray[i][0] as PdfImageObject;
        }

        if (img) {
          const blob = await imageObjectToBlob(img);
          if (blob) {
            index += 1;
            results.push({ name: `第${pageNum}页-图${index}.png`, blob });
          }
        }
      }
      onProgress?.(pageNum, doc.numPages);
    }
  } finally {
    await task.destroy();
  }
  return results;
}

/** 激进压缩：每页栅格化为 JPEG 后重建 PDF（丢失文本层） */
export async function rasterCompressPdf(
  buffer: ArrayBuffer,
  opts: { dpi: number; quality: number },
  onProgress?: ProgressFn
): Promise<Uint8Array> {
  const { doc, task } = await loadPdf(buffer);
  const out = await PDFDocument.create();
  const scale = opts.dpi / 72;

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;

      const jpeg = await canvasToBlob(canvas, 'image/jpeg', opts.quality);
      const embedded = await out.embedJpg(await jpeg.arrayBuffer());
      const pdfPage = out.addPage([baseViewport.width, baseViewport.height]);
      pdfPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });
      onProgress?.(i, doc.numPages);
    }
  } finally {
    await task.destroy();
  }

  return out.save();
}

/** 将文字水印渲染为透明 PNG 字节（用系统字体，天然支持中文） */
export function renderWatermarkPng(
  text: string,
  opts: { fontSize: number; opacity: number; color: string }
): Uint8Array {
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  const font = `600 ${opts.fontSize}px system-ui, sans-serif`;
  measure.font = font;
  const metrics = measure.measureText(text);
  const pad = Math.ceil(opts.fontSize * 0.6);

  canvas.width = Math.max(Math.ceil(metrics.width) + pad * 2, 4);
  canvas.height = Math.ceil(opts.fontSize * 1.5) + pad * 2;

  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = opts.opacity;
  ctx.fillStyle = opts.color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  return dataUrlToBytes(canvas.toDataURL('image/png'));
}
