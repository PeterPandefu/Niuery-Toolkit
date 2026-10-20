import { describe, expect, it } from 'vitest';
import { flowToSvg } from '@/tools/graphic/flow-board/export';
import { createDefaultFlowDocument } from '@/tools/graphic/flow-board/document';

describe('flow board export', () => {
  it('exports nodes and edges as an SVG document', () => {
    const document = createDefaultFlowDocument();
    const svg = flowToSvg(document.nodes, document.edges);
    expect(svg).toContain('<svg');
    expect(svg).toContain('marker-end');
    expect(svg).toContain('服务');
  });

  it('rejects an empty canvas', () => {
    expect(() => flowToSvg([], [])).toThrow('画布为空');
  });
});
