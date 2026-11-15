import { nanoid } from 'nanoid';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type JSZip from 'jszip';
import type { AiAttachment } from './types';

async function bounded<T>(promise: Promise<T>, milliseconds = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('文档处理超时，请减少页数或检查文件。 / Document processing timed out.')), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

export async function readPdfAttachment(file: File): Promise<AiAttachment> {
  if (file.size > 20 * 1024 * 1024) throw new Error('PDF 不能超过 20 MiB。 / PDF must not exceed 20 MiB.');
  const bytes = await fileBytes(file);
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

function fileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer().then(buffer => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('无法读取附件，请重新选择文件。')); reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer)); reader.readAsArrayBuffer(file);
  });
}

type OrderedNode = Record<string, unknown>;

const orderedXmlOptions = { preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', trimValues: false, parseTagValue: false, parseAttributeValue: false } as const;

function nodeChildren(node: OrderedNode, tag: string): OrderedNode[] {
  const value = node[tag];
  return Array.isArray(value) ? value as OrderedNode[] : [];
}

function nodeAttributes(node: OrderedNode): Record<string, string> {
  const value = node[':@'];
  return value && typeof value === 'object' ? value as Record<string, string> : {};
}

function plainText(node: OrderedNode): string {
  let text = '';
  for (const [key, value] of Object.entries(node)) {
    if (key === '#text') text += String(value);
    else if (Array.isArray(value)) for (const child of value as OrderedNode[]) text += plainText(child);
  }
  return text;
}

function paragraphText(node: OrderedNode, textTag: string, tabTag: string, breakTags: string[]): string {
  let text = '';
  const walk = (current: OrderedNode) => {
    for (const [key, value] of Object.entries(current)) {
      if (key === textTag) { for (const child of value as OrderedNode[]) text += plainText(child); }
      else if (key === tabTag) text += '\t';
      else if (breakTags.includes(key)) text += '\n';
      else if (Array.isArray(value)) { for (const child of value as OrderedNode[]) walk(child); }
    }
  };
  walk(node);
  return text;
}

function collectTagged(node: OrderedNode, tag: string, out: OrderedNode[]): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === tag) { for (const child of value as OrderedNode[]) out.push(child); }
    else if (Array.isArray(value)) { for (const child of value as OrderedNode[]) collectTagged(child, tag, out); }
  }
}

async function zipText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`文档结构无效，缺少 ${path}。 / Invalid document: missing ${path}.`);
  return entry.async('string');
}

async function extractDocx(xml: string): Promise<string[]> {
  const { XMLParser } = await import('fast-xml-parser');
  const root = new XMLParser(orderedXmlOptions).parse(xml) as OrderedNode[];
  const document = root.find(node => 'w:document' in node);
  const body = document ? nodeChildren(document, 'w:document').find(node => 'w:body' in node) : undefined;
  if (!body) throw new Error('Word 文档结构无效，缺少正文。 / Invalid Word document: missing body.');
  const lines: string[] = [];
  for (const block of nodeChildren(body, 'w:body')) {
    if ('w:p' in block) {
      const text = paragraphText(block, 'w:t', 'w:tab', ['w:br', 'w:cr']).trim();
      if (text) lines.push(text);
    } else if ('w:tbl' in block) {
      for (const row of nodeChildren(block, 'w:tbl').filter(node => 'w:tr' in node)) {
        const cells = nodeChildren(row, 'w:tr').filter(node => 'w:tc' in node)
          .map(cell => paragraphText(cell, 'w:t', 'w:tab', ['w:br', 'w:cr']).replace(/\s*\n\s*/g, ' ').trim());
        const line = cells.join(' | ');
        if (line.replace(/[| ]/g, '')) lines.push(line);
      }
    }
  }
  return lines;
}

function columnIndex(reference: string): number {
  const letters = reference.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) return -1;
  let index = 0;
  for (const character of letters) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

async function extractXlsx(zip: JSZip, name: string): Promise<{ sections: string[]; units: number }> {
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser(orderedXmlOptions);
  const workbookRoot = parser.parse(await zipText(zip, 'xl/workbook.xml')) as OrderedNode[];
  const workbook = workbookRoot.find(node => 'workbook' in node);
  const sheets = workbook ? nodeChildren(workbook, 'workbook').find(node => 'sheets' in node) : undefined;
  const targets = new Map<string, string>();
  const relsFile = zip.file('xl/_rels/workbook.xml.rels');
  if (relsFile) {
    for (const node of parser.parse(await relsFile.async('string')) as OrderedNode[]) {
      for (const rel of nodeChildren(node, 'Relationships')) {
        const attributes = nodeAttributes(rel);
        if (attributes.Id && attributes.Target) targets.set(attributes.Id, attributes.Target);
      }
    }
  }
  const shared: string[] = [];
  const sharedFile = zip.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const sst = (parser.parse(await sharedFile.async('string')) as OrderedNode[]).find(node => 'sst' in node);
    if (sst) for (const si of nodeChildren(sst, 'sst')) shared.push(plainText(si));
  }
  const sections: string[] = [];
  let units = 0;
  for (const sheet of sheets ? nodeChildren(sheets, 'sheets') : []) {
    const attributes = nodeAttributes(sheet);
    const target = targets.get(attributes['r:id'] ?? '');
    const path = !target ? undefined : target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const sheetFile = path ? zip.file(path) : undefined;
    if (!sheetFile) continue;
    units += 1;
    const worksheet = (parser.parse(await sheetFile.async('string')) as OrderedNode[]).find(node => 'worksheet' in node);
    const sheetData = worksheet ? nodeChildren(worksheet, 'worksheet').find(node => 'sheetData' in node) : undefined;
    const lines: string[] = [];
    for (const row of sheetData ? nodeChildren(sheetData, 'sheetData') : []) {
      const cells: string[] = [];
      for (const cell of nodeChildren(row, 'row')) {
        const cellAttributes = nodeAttributes(cell);
        const children = nodeChildren(cell, 'c');
        const valueNode = children.find(node => 'v' in node);
        const inlineNode = children.find(node => 'is' in node);
        let value = '';
        if (cellAttributes.t === 's' && valueNode) value = shared[Number(plainText(valueNode))] ?? '';
        else if (cellAttributes.t === 'inlineStr' && inlineNode) value = plainText(inlineNode);
        else if (cellAttributes.t === 'b' && valueNode) value = plainText(valueNode) === '1' ? 'TRUE' : 'FALSE';
        else if (valueNode) value = plainText(valueNode);
        const column = columnIndex(cellAttributes.r ?? '');
        // Excel's own column ceiling; a crafted reference must not allocate a huge row.
        if (column >= 0 && column < 16384) cells[column] = value; else cells.push(value);
      }
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.length) lines.push(cells.join('\t'));
    }
    if (lines.length) sections.push(`[${name} · ${attributes.name ?? `sheet${units}`}]`, ...lines);
  }
  return { sections, units };
}

async function extractPptx(zip: JSZip, name: string): Promise<{ sections: string[]; units: number }> {
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser(orderedXmlOptions);
  const slidePaths = Object.keys(zip.files).filter(path => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(/slide(\d+)/.exec(a)![1]) - Number(/slide(\d+)/.exec(b)![1]));
  const sections: string[] = [];
  for (const [index, path] of slidePaths.entries()) {
    const slideFile = zip.file(path);
    if (!slideFile) continue;
    const paragraphs: OrderedNode[] = [];
    for (const node of parser.parse(await slideFile.async('string')) as OrderedNode[]) collectTagged(node, 'a:p', paragraphs);
    const lines = paragraphs.map(paragraph => paragraphText(paragraph, 'a:t', 'a:tab', ['a:br']).trim()).filter(Boolean);
    if (lines.length) sections.push(`[${name} · slide ${index + 1}]`, ...lines);
  }
  return { sections, units: slidePaths.length };
}

export async function readOfficeAttachment(file: File): Promise<AiAttachment> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Office 文档不能超过 20 MiB。 / Office documents must not exceed 20 MiB.');
  const bytes = await fileBytes(file);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('旧版 .doc/.xls/.ppt 二进制格式无法在本机提取文本，请另存为 .docx/.xlsx/.pptx 后重试。 / Legacy binary Office formats cannot be extracted locally; save as .docx/.xlsx/.pptx.');
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) throw new Error('Office 文件内容无效或已损坏。 / Invalid or corrupted Office file.');
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  const { sections, units } = await bounded((async () => {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(bytes);
    if (extension === 'docx') {
      const lines = await extractDocx(await zipText(zip, 'word/document.xml'));
      return { sections: lines.length ? [`[${file.name}]`, ...lines] : [], units: 1 };
    }
    if (extension === 'xlsx') return extractXlsx(zip, file.name);
    if (extension === 'pptx') return extractPptx(zip, file.name);
    throw new Error('不支持的 Office 格式。 / Unsupported Office format.');
  })());
  const body = sections.join('\n');
  if (!body.trim()) throw new Error('文档没有可提取文本。 / No extractable text in the document.');
  if (body.length > 200_000) throw new Error('文档提取文本超过 200,000 字符，请精简后重试。');
  const data = `以下为本机提取的文档正文。回答文档问题时请引用相应的 [文件名 · 位置] 标记，没有依据时明确说明。\nDocument text extracted locally. Cite the matching [filename · location] marker; state when evidence is absent.\n\n${body}`;
  const size = new TextEncoder().encode(data).length;
  if (size > 1024 * 1024) throw new Error('文档提取文本超过 1 MiB。');
  return { id: nanoid(), name: `${file.name}.txt`, kind: 'text', mimeType: 'text/plain', data, size, sourceDocument: { name: file.name, pages: units } };
}
