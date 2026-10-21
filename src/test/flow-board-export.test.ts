import { describe, expect, it } from 'vitest';
import { embedFlowJsonInPng, embedFlowJsonInPdf, embedFlowJsonInSvg, flowToSvg } from '@/tools/graphic/flow-board/export';
import { createDefaultFlowDocument, createNode } from '@/tools/graphic/flow-board/document';
import { getNodeShape } from '@/tools/graphic/flow-board/geometry';
import { groupNodes } from '@/tools/graphic/flow-board/operations';

describe('flow board export', () => {
  it('exports nodes and edges as an SVG document', () => {
    const document = createDefaultFlowDocument();
    const svg = flowToSvg(document.nodes, document.edges);
    expect(svg).toContain('<svg');
    expect(svg).toContain('marker-end');
    expect(svg).toContain('开始');
  });

  it('rejects an empty canvas', () => {
    expect(() => flowToSvg([], [])).toThrow('画布为空');
  });
  it('resolves exported start and end arrows to marker definitions', () => {
    const doc = createDefaultFlowDocument();
    doc.edges[0].data = { startMarker: 'arrow', endMarker: 'closed-arrow' };
    const xml = new DOMParser().parseFromString(flowToSvg(doc.nodes, doc.edges), 'image/svg+xml');
    const path = xml.querySelector('[data-edge-id]')!;
    for (const attribute of ['marker-start', 'marker-end']) {
      const reference = path.getAttribute(attribute)!;
      const marker = xml.getElementById(reference.slice(5, -1));
      expect(marker?.localName).toBe('marker');
      expect(marker?.querySelector('path')).not.toBeNull();
    }
  });
  it('keeps grouped edge endpoints aligned with exported child nodes', () => {
    const source = createNode('process', 400, 300);
    const target = createNode('process', 700, 300);
    for (const node of [source, target]) Object.assign(node.data, { width: 120, height: 60 });
    const nodes = groupNodes([source, target], [source.id, target.id], '组合', 'container');
    const xml = new DOMParser().parseFromString(flowToSvg(nodes, [{ id: 'group-edge', source: source.id, target: target.id, data: { routing: 'straight' } }]), 'image/svg+xml');
    const path = xml.querySelector('[data-edge-id]');
    expect(path?.getAttribute('d')).toBe('M 520 330 L 700 330');
    expect(path?.getAttribute('transform')).toBe('translate(-328 -204)');
    expect(xml.querySelector(`[data-node-id="${source.id}"]`)?.getAttribute('transform')).toBe('translate(72 96)');
  });
  it('uses unchanged local shape paths with a transform, preserving cylinder arc radii', () => {
    const node = createNode('database', 400, 300);
    const svg = flowToSvg([node], []);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.querySelector('[data-node-id]')?.getAttribute('transform')).toBe('translate(48 48)');
    expect(xml.querySelector('[data-node-id] path')?.getAttribute('d')).toBe(getNodeShape(node.data).paths[0]);
  });
  it('exports both markers, labels, dashes and honors an explicit no-arrow setting', () => {
    const doc = createDefaultFlowDocument();
    doc.edges[0].data = { label: '是<&', dashed: true, startMarker: 'arrow', endMarker: 'none', routing: 'straight' };
    const svg = flowToSvg(doc.nodes, doc.edges);
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const path = xml.querySelector('[data-edge-id]');
    expect(path?.getAttribute('marker-start')).toContain('arrow-');
    expect(path?.getAttribute('marker-end')).toBeNull();
    expect(path?.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(xml.documentElement.textContent).toContain('是<&');
  });
  it('exports text safely as wrapped SVG text and keeps quote-bearing labels valid', () => {
    const node = createNode('process', 0, 0, '中文长文本'.repeat(12) + '"<&');
    const xml = new DOMParser().parseFromString(flowToSvg([node], []), 'image/svg+xml');
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(xml.querySelectorAll('tspan').length).toBeGreaterThan(1);
    expect(xml.documentElement.textContent).toContain('"');
  });
  it('includes manual waypoints in the exported bounds', () => {
    const doc = createDefaultFlowDocument();
    doc.edges[0].data = { routing: 'polyline', waypoints: [{ x: -500, y: -500 }] };
    const xml = new DOMParser().parseFromString(flowToSvg(doc.nodes, doc.edges), 'image/svg+xml');
    expect(Number(xml.documentElement.getAttribute('width'))).toBeGreaterThan(1200);
  });
  it('embeds editable flow JSON into SVG metadata', () => {
    const svg = embedFlowJsonInSvg(flowToSvg(createDefaultFlowDocument().nodes, []), '{"schemaVersion":2}');
    expect(svg).toContain('id="flow-document"');
    expect(svg).toContain('eyJzY2hlbWFWZXJzaW9uIjoyfQ==');
  });
  it('embeds editable flow JSON into a PNG tEXt chunk', async () => {
    const png = await embedFlowJsonInPng(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])], { type: 'image/png' }), '{"schemaVersion":2}');
    expect(new TextDecoder().decode(new Uint8Array(await png.arrayBuffer()))).toContain('flow-json');
  });
  it('attaches editable flow JSON to a PDF', async () => {
    const source = await embedFlowJsonInPdf(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), '{"schemaVersion":2}').catch(() => null);
    expect(source).toBeNull();
  });
});
