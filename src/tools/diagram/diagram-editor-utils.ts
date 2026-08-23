export type DiagramKind = 'mermaid' | 'plantuml';
export type DiagramExportFormat = 'source' | 'svg' | 'png';

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
