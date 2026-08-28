import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { isTauri } from '@/lib/api-client';

// 保证 fake worker 的动态 import 与模块 chunk 的相对路径无关（尤其是 Tauri 的 asset:// 页面）。
pdfjsLib.GlobalWorkerOptions.workerSrc = typeof window === 'undefined' ? workerUrl : new URL(workerUrl, window.location.href).href;

export interface PageImage {
  name: string;
  blob: Blob;
}

export type ProgressFn = (done: number, total: number) => void;

/** PDF.js 在桌面 WebView 中偶发无法完成图像解码或 worker 销毁。 */
const PDF_OPERATION_TIMEOUT_MS = 30_000;
const PDF_TASK_DESTROY_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = PDF_OPERATION_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时，请检查 PDF 文件是否损坏`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function destroyPdfTask(task: { destroy: () => Promise<void> }) {
  try {
    // 清理失败不应阻塞已经生成的结果或让界面永久保持 busy。
    await withTimeout(task.destroy(), 'PDF 资源清理', PDF_TASK_DESTROY_TIMEOUT_MS);
  } catch {
    // PDF.js worker 在 WebView 关闭时可能已经失去响应，忽略清理错误即可。
  }
}

function createPdfLoadingTask(buffer: ArrayBuffer) {
  const params = {
    data: new Uint8Array(buffer.slice(0)),
    // WebView2 的 ImageDecoder/OffscreenCanvas 在部分 PDF 上会一直 pending。
    // 关闭这两条优化路径后由 PDF.js 使用稳定的 Canvas 解码流程。
    isImageDecoderSupported: !isTauri,
    isOffscreenCanvasSupported: !isTauri,
  };

  if (!isTauri) return pdfjsLib.getDocument(params);

  // PDF.js 的模块 Worker 若在 WebView2 中无法启动，不会自行超时或回退，加载任务会永久 pending。
  // 仅在创建任务的同步阶段屏蔽 Worker，迫使 PDF.js 使用其内建的主线程 fake worker。
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  try {
    Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: undefined });
    return pdfjsLib.getDocument(params);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor);
    else Reflect.deleteProperty(globalThis, 'Worker');
  }
}

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
  const task = createPdfLoadingTask(buffer);
  const doc = await withTimeout(task.promise, 'PDF 加载');
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
      const page = await withTimeout(doc.getPage(i), `第 ${i} 页加载`);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      if (opts.format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      await withTimeout(page.render({ canvas: null, canvasContext: ctx, viewport }).promise, `第 ${i} 页渲染`);
      const type = opts.format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await withTimeout(canvasToBlob(canvas, type, opts.quality), `第 ${i} 页导出`);
      results.push({ name: `第${i}页.${opts.format === 'png' ? 'png' : 'jpg'}`, blob });
      onProgress?.(i, doc.numPages);
    }
  } finally {
    await destroyPdfTask(task);
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
      const page = await withTimeout(doc.getPage(pageNum), `第 ${pageNum} 页加载`);
      const ops = await withTimeout(page.getOperatorList(), `第 ${pageNum} 页扫描`);
      let index = 0;
      let rendered = false;
      const ensureImagesDecoded = async () => {
        if (rendered) return;
        const viewport = page.getViewport({ scale: 1 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建画布上下文');
        await withTimeout(page.render({ canvas: null, canvasContext: ctx, viewport }).promise, `第 ${pageNum} 页图片解码`);
        rendered = true;
      };

      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        let img: PdfImageObject | null = null;

        if (fn === pdfjsLib.OPS.paintImageXObject) {
          const name = ops.argsArray[i][0] as string;
          // getOperatorList 只列出 XObject 名称；部分 WebView 不会在此阶段解析 page.objs。
          // 先渲染一次页面触发解析，再读取对象，避免 promise 永久 pending。
          if (!page.objs.has(name)) await ensureImagesDecoded();
          if (!page.objs.has(name)) continue;
          img = await withTimeout(
            new Promise<PdfImageObject>((resolve) => {
              page.objs.get(name, resolve as (value: unknown) => void);
            }),
            `第 ${pageNum} 页图片解码`
          );
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
    await destroyPdfTask(task);
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
      const page = await withTimeout(doc.getPage(i), `第 ${i} 页加载`);
      const baseViewport = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await withTimeout(page.render({ canvas: null, canvasContext: ctx, viewport }).promise, `第 ${i} 页渲染`);

      const jpeg = await withTimeout(canvasToBlob(canvas, 'image/jpeg', opts.quality), `第 ${i} 页导出`);
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
    await destroyPdfTask(task);
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
