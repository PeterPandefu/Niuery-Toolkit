export type DiagramKind = 'mermaid' | 'plantuml';
export type DiagramExportFormat = 'source' | 'svg' | 'png' | 'pdf';

export const DIAGRAM_MIN_ZOOM = 0.25;
export const DIAGRAM_MAX_ZOOM = 4;
export const DIAGRAM_ZOOM_STEP = 0.25;

const DEFAULT_SOURCES: Record<DiagramKind, string> = {
  mermaid: `flowchart LR
  A[Start] --> B{Ready?}
  B -->|Yes| C[Finish]
  B -->|No| D[Try again]`,
  plantuml: `@startuml
Alice -> Bob: Hello
Bob --> Alice: Hi!
@enduml`,
};

export function getDiagramDefaultSource(kind: DiagramKind): string {
  return DEFAULT_SOURCES[kind];
}

export function clampDiagramZoom(zoom: number): number {
  return Math.min(DIAGRAM_MAX_ZOOM, Math.max(DIAGRAM_MIN_ZOOM, zoom));
}

export function getDiagramExportName(kind: DiagramKind, format: DiagramExportFormat): string {
  if (format === 'source') return `diagram.${kind === 'mermaid' ? 'mmd' : 'puml'}`;
  return `diagram.${format}`;
}

export function getDiagramSourceMimeType(kind: DiagramKind): string {
  return kind === 'mermaid' ? 'text/vnd.mermaid' : 'text/x-plantuml';
}

/** Makes the exported SVG opaque without changing the diagram's own colors. */
export function ensureWhiteDiagramBackground(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/i, (openingTag) => `${openingTag}<rect width="100%" height="100%" fill="#ffffff"/>`);
}

/**
 * 为图表 SVG 设置不透明的主题背景。
 *
 * PlantUML 的暗色主题默认输出透明 SVG，透明区域在 WebView 中会退化为黑色；
 * 同时 Mermaid/PlantUML 可能在根节点内嵌上一次主题的背景色。这里同时覆盖根
 * 节点背景样式并放置底层背景矩形，确保预览、SVG 和 PDF 导出都使用当前主题。
 */
export function ensureDiagramBackground(svg: string, background: string): string {
  const safeBackground = background.trim() || '#ffffff';
  return svg.replace(/<svg\b([^>]*)>/i, (openingTag) => {
    const styleMatch = openingTag.match(/\sstyle=(['"])(.*?)\1/i);
    let nextOpeningTag = openingTag;
    if (styleMatch) {
      const style = styleMatch[2]
        .replace(/background(?:-color)?\s*:[^;]+;?/gi, '')
        .trim()
        .replace(/;$/, '');
      const nextStyle = `${style}${style ? ';' : ''}background:${safeBackground};`;
      nextOpeningTag = openingTag.replace(styleMatch[0], ` style=${styleMatch[1]}${nextStyle}${styleMatch[1]}`);
    } else {
      nextOpeningTag = openingTag.replace(/>$/, ` style="background:${safeBackground};">`);
    }
    return `${nextOpeningTag}<rect width="100%" height="100%" fill="${safeBackground}"/>`;
  });
}
