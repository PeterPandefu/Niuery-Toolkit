import { nanoid } from 'nanoid';
import type { AiAttachment } from './types';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const TEXT_EXTENSIONS = new Set('txt text md markdown json jsonl log csv tsv xml yaml yml toml ini conf config env html htm css scss sass less js jsx ts tsx mjs cjs vue svelte astro py pyi rb php java kt kts c h cc cpp cxx hpp cs fs fsx go rs swift sh bash zsh ps1 psm1 bat cmd sql graphql gql r lua pl dart dockerfile makefile gitignore'.split(' '));
const IMAGE_EXTENSIONS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

export function validateAttachments(attachments: AiAttachment[]): void {
  const images = attachments.filter(file => file.kind === 'image');
  const texts = attachments.filter(file => file.kind === 'text');
  if (images.length > 4) throw new Error('每条消息最多 4 张图片。');
  if (texts.length > 5) throw new Error('每条消息最多 5 个文本文件。');
  for (const image of images) {
    if (!IMAGE_TYPES.has(image.mimeType)) throw new Error('图片仅支持 PNG、JPEG、WebP 格式。');
    if (image.size > 10 * 1024 * 1024) throw new Error('每张图片不能超过 10 MiB。');
  }
  if (texts.some(file => file.size > 1024 * 1024)) throw new Error('每个文本文件不能超过 1 MiB。');
  if (texts.reduce((sum, file) => sum + [...file.data].length, 0) > 200_000) throw new Error('文本附件总计不能超过 200,000 个字符。');
}

function readBytes(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('无法读取附件，请重新选择文件。'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

export async function readAttachment(file: File): Promise<AiAttachment> {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (extension === 'pdf') { const attachment = await (await import('./documents')).readPdfAttachment(file); validateAttachments([attachment]); return attachment; }
  const imageType = IMAGE_EXTENSIONS[extension] ?? (IMAGE_TYPES.has(file.type) ? file.type : undefined);
  const isText = !imageType && TEXT_EXTENSIONS.has(extension);
  if (!imageType && !isText) throw new Error('不支持此附件格式，请选择 PNG、JPEG、WebP 图片或纯文本／代码文件。');
  if (file.size > (imageType ? 10 : 1) * 1024 * 1024) throw new Error(imageType ? '每张图片不能超过 10 MiB。' : '每个文本文件不能超过 1 MiB。');
  const bytes = new Uint8Array(await readBytes(file));
  let data: string;
  if (imageType) {
    const valid = imageType === 'image/png' ? bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
      : imageType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!valid) throw new Error('图片内容与格式不匹配或已损坏。');
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
    data = btoa(chunks.join(''));
  } else {
    try { data = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('文本附件必须使用有效的 UTF-8 编码，请转换后重试。'); }
    if (bytes.some(byte => byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) throw new Error('附件包含二进制内容，不能作为纯文本发送。');
  }
  const attachment: AiAttachment = { id: nanoid(), name: file.name, kind: imageType ? 'image' : 'text', mimeType: imageType ?? 'text/plain', size: file.size, data };
  validateAttachments([attachment]);
  return attachment;
}
