import MarkdownIt from 'markdown-it';
import { getMermaid } from '@/lib/mermaid';

export interface MermaidImportCandidate {
  source: string;
  line: number | null;
}

const markdown = new MarkdownIt();

/** Extract Markdown fences before trying the complete document as raw Mermaid. */
export async function extractMermaidImport(contents: string): Promise<MermaidImportCandidate[]> {
  const text = contents.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('文件内容为空');

  const fences = markdown.parse(text, {}).filter((token) =>
    token.type === 'fence' && token.info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid',
  );
  if (fences.length > 0) {
    const candidates = fences
      .map((token) => ({ source: token.content.trim(), line: token.map ? token.map[0] + 1 : null }))
      .filter((candidate) => candidate.source.length > 0);
    if (candidates.length === 0) throw new Error('Mermaid 代码块内容为空');
    return candidates;
  }

  const source = text.trim();
  const mermaid = await getMermaid();
  if (!await mermaid.parse(source, { suppressErrors: true })) {
    throw new Error('未找到 Mermaid 代码块，也无法识别为有效的 Mermaid 源码');
  }
  return [{ source, line: null }];
}
