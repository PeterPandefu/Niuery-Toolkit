import type { DiagramRenderResult } from './diagram-editor';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;
let renderSequence = 0;

async function getMermaid() {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  return mermaidPromise;
}

export async function renderMermaidDiagram(
  source: string,
  { scheme }: { scheme: 'light' | 'dark' },
): Promise<DiagramRenderResult> {
  const mermaid = await getMermaid();
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: scheme === 'dark' ? 'dark' : 'default',
    fontFamily: 'IBM Plex Sans, Noto Sans SC, sans-serif',
  });
  const { svg } = await mermaid.render(`niuery-mermaid-editor-${++renderSequence}`, source);
  return { svg };
}
