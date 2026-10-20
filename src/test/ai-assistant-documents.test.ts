// @vitest-environment node
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { readPdfAttachment } from '@/tools/ai-assistant/documents';
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
// Node 22 predates Uint8Array.toHex, available in the desktop WebView runtime.
if (!('toHex' in Uint8Array.prototype)) Object.defineProperty(Uint8Array.prototype, 'toHex', { configurable: true, value(this: Uint8Array) { return Array.from(this, byte => byte.toString(16).padStart(2, '0')).join(''); } });

async function pdf(text?: string) {
  const document = await PDFDocument.create();
  const page = document.addPage();
  if (text) { const font = await document.embedFont(StandardFonts.Helvetica); page.drawText(text, { font }); }
  return new File([new Uint8Array(await document.save())], 'report.pdf', { type: 'application/pdf' });
}

describe('AI local PDF attachments', () => {
  it('extracts real PDF text with page citation markers without sending PDF binary', async () => {
    const attachment = await readPdfAttachment(await pdf('Invoice total: 123 dollars'));
    expect(attachment.kind).toBe('text');
    expect(attachment.name).toBe('report.pdf.txt');
    expect(attachment.data).toContain('[report.pdf · p.1]');
    expect(attachment.data).toContain('Invoice total: 123 dollars');
    expect(attachment.sourceDocument).toEqual({ name: 'report.pdf', pages: 1 });
  });
  it('reports scanned or blank PDFs instead of pretending extraction succeeded', async () => {
    await expect(readPdfAttachment(await pdf())).rejects.toThrow(/扫描|文本|text/i);
    await expect(readPdfAttachment(new File(['broken'], 'bad.pdf'))).rejects.toThrow();
  });
});
