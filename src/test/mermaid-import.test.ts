import { describe, expect, it } from 'vitest';
import { extractMermaidImport } from '@/tools/diagram/mermaid-import';

describe('Mermaid document import', () => {
  it('extracts only Mermaid fences, preserving their document order and line numbers', async () => {
    const document = '# Diagrams\n\n```js\nconst a = 1;\n```\n\n```mermaid\nflowchart TD\nA --> B\n```\n\n~~~mermaid\nsequenceDiagram\nAlice->>Bob: Hi\n~~~';
    await expect(extractMermaidImport(document)).resolves.toEqual([
      { source: 'flowchart TD\nA --> B', line: 7 },
      { source: 'sequenceDiagram\nAlice->>Bob: Hi', line: 12 },
    ]);
  });

  it('handles BOM, Windows newlines, uppercase language names and fence metadata', async () => {
    await expect(extractMermaidImport('\uFEFFIntro\r\n\r\n~~~MERMAID title="Graph"\r\nflowchart LR\r\nA --> B\r\n~~~')).resolves.toEqual([
      { source: 'flowchart LR\nA --> B', line: 3 },
    ]);
  });

  it.each([
    ['> ```mermaid\n> flowchart LR\n> A --> B\n> ```', 1],
    ['- Diagram\n\n  ```mermaid\n  flowchart LR\n  A --> B\n  ```', 3],
  ])('extracts a diagram inside Markdown containers', async (document, line) => {
    await expect(extractMermaidImport(document)).resolves.toEqual([{ source: 'flowchart LR\nA --> B', line }]);
  });

  it('accepts raw source with Mermaid frontmatter and comments', async () => {
    const source = '---\ntitle: Sample\n---\n%% comment\nflowchart LR\nA --> B';
    await expect(extractMermaidImport(`\uFEFF${source.replace(/\n/g, '\r\n')}\r\n`)).resolves.toEqual([
      { source, line: null },
    ]);
  });

  it.each([
    '# Notes\n\nNo diagrams here.',
    'flowchart LR\nA -->',
    '````markdown\n```mermaid\nflowchart LR\nA --> B\n```\n````',
    '```mermaid-example\nflowchart LR\nA --> B\n```',
  ])('rejects text that contains no usable Mermaid source', async (source) => {
    await expect(extractMermaidImport(source)).rejects.toThrow('未找到 Mermaid 代码块，也无法识别为有效的 Mermaid 源码');
  });

  it.each(['', ' \r\n\t', '```mermaid\n\n```'])('rejects empty documents and empty Mermaid blocks', async (source) => {
    await expect(extractMermaidImport(source)).rejects.toThrow(/为空/);
  });
});
