import { getMermaid } from '@/lib/mermaid';
import type { DiagramRenderResult } from './diagram-editor';

let renderSequence = 0;

/**
 * Mermaid emits `width="100%"` without a height. That is fine for inline SVG,
 * but an SVG loaded through an `<img>` Blob needs intrinsic dimensions so the
 * image viewer can calculate its fit size consistently in WebView2.
 */
function ensureIntrinsicSvgDimensions(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (openingTag) => {
    const viewBoxMatch = openingTag.match(/(?:^|\s)viewBox\s*=\s*(["'])(.*?)\1/i);
    if (!viewBoxMatch) return openingTag;

    const viewBox = viewBoxMatch[2].trim().split(/[\s,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
      return openingTag;
    }

    const readPixelDimension = (name: 'width' | 'height'): number | null => {
      const match = openingTag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
      const value = match?.[2].trim().match(/^((?:\d+(?:\.\d*)?|\.\d+))(?:px)?$/i)?.[1];
      if (!value) return null;
      const dimension = Number(value);
      return Number.isFinite(dimension) && dimension > 0 ? dimension : null;
    };

    const existingWidth = readPixelDimension('width');
    const existingHeight = readPixelDimension('height');
    if (existingWidth !== null && existingHeight !== null) return openingTag;

    const width = existingWidth ?? (existingHeight === null ? viewBox[2] : existingHeight * viewBox[2] / viewBox[3]);
    const height = existingHeight ?? (existingWidth === null ? viewBox[3] : existingWidth * viewBox[3] / viewBox[2]);
    const setDimension = (tag: string, name: 'width' | 'height', value: number) => {
      const attribute = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
      if (attribute.test(tag)) return tag.replace(attribute, ` ${name}="${value}"`);
      return tag.replace(/\/?\s*>$/, (ending) => ` ${name}="${value}"${ending}`);
    };

    return setDimension(setDimension(openingTag, 'width', width), 'height', height);
  });
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
  return { svg: ensureIntrinsicSvgDimensions(svg) };
}
