import { describe, expect, it } from 'vitest';
import {
  clampDiagramZoom,
  ensureDiagramBackground,
  ensureWhiteDiagramBackground,
  getDiagramDefaultSource,
  getDiagramExportName,
  getDiagramSourceMimeType,
} from '@/tools/diagram/diagram-editor-utils';

describe('diagram editor helpers', () => {
  it('provides immediately renderable starter sources for both diagram formats', () => {
    expect(getDiagramDefaultSource('mermaid')).toContain('flowchart');
    expect(getDiagramDefaultSource('plantuml')).toContain('@startuml');
    expect(getDiagramDefaultSource('plantuml')).toContain('@enduml');
  });

  it('clamps preview zoom to the supported 25 to 400 percent range', () => {
    expect(clampDiagramZoom(0.1)).toBe(0.25);
    expect(clampDiagramZoom(1.5)).toBe(1.5);
    expect(clampDiagramZoom(8)).toBe(4);
  });

  it('uses the diagram-specific source extensions and MIME types', () => {
    expect(getDiagramExportName('mermaid', 'source')).toBe('diagram.mmd');
    expect(getDiagramExportName('plantuml', 'source')).toBe('diagram.puml');
    expect(getDiagramExportName('mermaid', 'svg')).toBe('diagram.svg');
    expect(getDiagramExportName('plantuml', 'png')).toBe('diagram.png');
    expect(getDiagramSourceMimeType('mermaid')).toBe('text/vnd.mermaid');
    expect(getDiagramSourceMimeType('plantuml')).toBe('text/x-plantuml');
  });

  it('adds an opaque white SVG background when follow-theme is disabled', () => {
    expect(ensureWhiteDiagramBackground('<svg viewBox="0 0 10 10"><path /></svg>')).toBe(
      '<svg viewBox="0 0 10 10"><rect width="100%" height="100%" fill="#ffffff"/><path /></svg>',
    );
  });

  it('replaces stale SVG backgrounds with the active theme background', () => {
    const svg = ensureDiagramBackground(
      '<svg style="width:100px;background:#202938"><path /></svg>',
      'hsl(48 58% 97%)',
    );

    expect(svg).toContain('style="width:100px;background:hsl(48 58% 97%);"');
    expect(svg).toContain('<rect width="100%" height="100%" fill="hsl(48 58% 97%)"/><path />');
    expect(svg).not.toContain('#202938');
  });
});
