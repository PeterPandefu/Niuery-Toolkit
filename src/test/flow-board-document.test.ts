import { describe, expect, it } from 'vitest';
import { createDefaultFlowDocument, parseFlowDocument, serializeFlowDocument } from '@/tools/graphic/flow-board/document';

describe('flow board document', () => {
  it('serializes and restores the default graph', () => {
    const source = serializeFlowDocument(createDefaultFlowDocument());
    const restored = parseFlowDocument(source);
    expect(restored.schemaVersion).toBe(1);
    expect(restored.nodes).toHaveLength(3);
    expect(restored.edges).toHaveLength(2);
    expect(restored.viewport.zoom).toBe(1);
  });

  it('drops edges that point to missing nodes and normalizes unknown nodes', () => {
    const restored = parseFlowDocument(JSON.stringify({
      schemaVersion: 99,
      nodes: [{ id: 'custom', type: 'future-shape', position: { x: 12, y: 18 }, data: { label: '保留数据' } }],
      edges: [{ id: 'bad', source: 'custom', target: 'missing' }],
    }));
    expect(restored.schemaVersion).toBe(1);
    expect(restored.nodes[0].type).toBe('rectangle');
    expect(restored.nodes[0].data.label).toBe('保留数据');
    expect(restored.edges).toHaveLength(0);
  });
});
