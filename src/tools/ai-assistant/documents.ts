import { nanoid } from 'nanoid';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AiAttachment } from './types';

async function bounded<T>(promise: Promise<T>, milliseconds = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('PDF 处理超时，请减少页数或检查文件。 / PDF processing timed out.')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function readPdfAttachment(file: File): Promise<AiAttachment> {
  if (file.size > 20 * 1024 * 1024) throw new Error('PDF 不能超过 20 MiB。 / PDF must not exceed 20 MiB.');
  const bytes = typeof file.arrayBuffer === 'function' ? new Uint8Array(await file.arrayBuffer()) : await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取 PDF')); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.readAsArrayBuffer(file);
  });
  // Tauri sniffs asset content before checking .js; a literal PDF header near
  // the beginning of this compiled module would give the script a PDF MIME type.
  if (![37, 80, 68, 70, 45].every((byte, index) => bytes[index] === byte)) throw new Error('PDF 文件内容无效。 / Invalid PDF.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = typeof window === 'undefined' ? 'pdfjs-dist/build/pdf.worker.mjs' : new URL(workerUrl, window.location.href).href;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  let task;
  try {
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: undefined });
    task = pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
  } finally { if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor); else Reflect.deleteProperty(globalThis, 'Worker'); }
  try {
    const doc = await bounded(task.promise);
    if (doc.numPages > 200) throw new Error('PDF 最多支持 200 页，请拆分后重试。 / PDF supports at most 200 pages.');
    const pages: string[] = [];
    let characters = 0;
    for (let index = 1; index <= doc.numPages; index++) {
      const page = await bounded(doc.getPage(index));
      try {
        const content = await bounded(page.getTextContent());
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        if (text) pages.push(`[${file.name} · p.${index}]\n${text}`);
        characters += text.length;
        if (characters > 200_000) throw new Error('PDF 提取文本超过 200,000 字符，请减少页数。');
      } finally { page.cleanup(); }
    }
    if (!pages.length) throw new Error('PDF 没有可提取文本，可能为扫描件；暂不支持扫描件识别。 / No extractable PDF text; scanned PDFs are not supported.');
    const data = `以下为本机提取的文档正文。回答文档问题时请引用相应的 [文件名 · p.页码]，没有依据时明确说明。\nDocument text extracted locally. Cite the matching [filename · p.page] marker; state when evidence is absent.\n\n${pages.join('\n\n')}`;
    const size = new TextEncoder().encode(data).length;
    if (size > 1024 * 1024) throw new Error('PDF 提取文本超过 1 MiB。');
    return { id: nanoid(), name: `${file.name}.txt`, kind: 'text', mimeType: 'text/plain', data, size, sourceDocument: { name: file.name, pages: doc.numPages } };
  } finally { await bounded(task.destroy(), 2000).catch(() => {}); }
}
