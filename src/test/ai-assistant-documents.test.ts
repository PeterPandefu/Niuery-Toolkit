// @vitest-environment node
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { readOfficeAttachment, readPdfAttachment } from '@/tools/ai-assistant/documents';
import { readAttachment } from '@/tools/ai-assistant/attachments';
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

async function officeFile(entries: Record<string, string>, name: string) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return new File([await zip.generateAsync({ type: 'uint8array' })], name);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

describe('AI local Office attachments', () => {
  it('extracts Word paragraphs and tables with a citation marker', async () => {
    const file = await officeFile({
      'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:r><w:t>Middleware requirements</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Second </w:t></w:r><w:r><w:t>paragraph</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Field</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Timeout</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30s</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    }, 'spec.docx');
    const attachment = await readOfficeAttachment(file);
    expect(attachment.kind).toBe('text');
    expect(attachment.name).toBe('spec.docx.txt');
    expect(attachment.data).toContain('[spec.docx]');
    expect(attachment.data).toContain('Middleware requirements');
    expect(attachment.data).toContain('Second paragraph');
    expect(attachment.data).toContain('Field | Value');
    expect(attachment.data).toContain('Timeout | 30s');
    expect(attachment.sourceDocument).toEqual({ name: 'spec.docx', pages: 1 });
  });
  it('extracts Excel sheets with shared strings, numbers and inline strings', async () => {
    const file = await officeFile({
      'xl/workbook.xml': `<workbook ${R}><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': `<sst ${S} count="2" uniqueCount="2"><si><t>Item</t></si><si><t>Cost</t></si></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet ${S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>42</v></c><c r="B2" t="inlineStr"><is><t>paid</t></is></c></row></sheetData></worksheet>`,
    }, 'budget.xlsx');
    const attachment = await readOfficeAttachment(file);
    expect(attachment.data).toContain('[budget.xlsx · Budget]');
    expect(attachment.data).toContain('Item\tCost');
    expect(attachment.data).toContain('42\tpaid');
    expect(attachment.sourceDocument).toEqual({ name: 'budget.xlsx', pages: 1 });
  });
  it('extracts PowerPoint slides in numeric order', async () => {
    const slide = (text: string) => `<p:sld ${P} ${A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
    const file = await officeFile({
      'ppt/slides/slide2.xml': slide('Second slide'),
      'ppt/slides/slide1.xml': slide('Title slide'),
      'ppt/slides/slide10.xml': slide('Tenth slide'),
    }, 'deck.pptx');
    const attachment = await readOfficeAttachment(file);
    expect(attachment.data).toContain('[deck.pptx · slide 1]');
    expect(attachment.data).toContain('Title slide');
    expect(attachment.data.indexOf('Title slide')).toBeLessThan(attachment.data.indexOf('Second slide'));
    expect(attachment.data.indexOf('Second slide')).toBeLessThan(attachment.data.indexOf('Tenth slide'));
    expect(attachment.sourceDocument).toEqual({ name: 'deck.pptx', pages: 3 });
  });
  it('routes Office files through readAttachment and rejects legacy binary formats', async () => {
    const file = await officeFile({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:body></w:document>` }, 'note.docx');
    const attachment = await readAttachment(file);
    expect(attachment.kind).toBe('text');
    expect(attachment.data).toContain('hello');
    const legacy = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0])], 'old.doc');
    await expect(readAttachment(legacy)).rejects.toThrow(/另存为|docx/);
    await expect(readOfficeAttachment(new File(['not a zip'], 'fake.docx'))).rejects.toThrow(/无效|损坏/);
    await expect(readOfficeAttachment(await officeFile({ 'word/document.xml': `<w:document ${W}><w:body></w:body></w:document>` }, 'empty.docx'))).rejects.toThrow(/没有可提取文本/);
  });
});
